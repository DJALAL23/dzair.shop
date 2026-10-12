// @vitest-environment node
/// <reference types="vitest/globals" />
/**
 * Home document persistence — Phase 6 (slices 19/20).
 *
 * Proves the decision function that picks what the home surface renders:
 * the store's saved document when it is usable, the shipped default otherwise
 * (absent, unparseable/wrong version, or zero type overlap after a theme
 * change) — and that an empty saved document is honored, not "recovered".
 *
 * Plus one container render: a saved override reaches real HTML through the
 * real renderer, with the shipped default providing everything else.
 */
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { describe, expect, it } from "vitest";
import type { ProductList } from "@codflow/storefront";
import type { StoreClient } from "@codflow/storefront/server";
import InstanceView from "@codflow/theme/astro/InstanceView.astro";
import { createReadCache } from "@codflow/theme/astro";
import type { ComponentInstance, ThemeRenderContext } from "@codflow/theme";
import { theme00 } from "@/theme/theme";
import { DEFAULT_CONFIG } from "@/theme/runtime/store";
import { en as enContent } from "@/theme/content/en";
import { resolveHomeDocument } from "@/theme/pages/home-document";
import shippedHome from "@/theme/pages/home.page.json";

const SAVED_OVERRIDE = {
  version: 1,
  surface: "home",
  sections: [
    { id: "cmp_saved_hero", type: "hero", props: { heroTitle: "Saved by the store" } },
    { id: "cmp_saved_feat", type: "features-bar", props: {} },
  ],
};

describe("resolveHomeDocument — what the home surface renders", () => {
  it("absent (null): the shipped default wins", () => {
    const decision = resolveHomeDocument(null, theme00);

    expect(decision.source).toBe("default");
    expect(decision.reason).toBe("absent");
    expect(decision.result.page?.sections.map((s) => s.type)).toEqual(
      shippedHome.sections.map((s) => s.type),
    );
  });

  it("a usable saved document wins, instances intact", () => {
    const decision = resolveHomeDocument(SAVED_OVERRIDE, theme00);

    expect(decision.source).toBe("saved");
    expect(decision.reason).toBeNull();
    expect(decision.issues).toEqual([]);
    expect(decision.result.page?.sections.map((s) => s.id)).toEqual([
      "cmp_saved_hero",
      "cmp_saved_feat",
    ]);
  });

  it("unparseable / wrong-version saved document: default wins, issues reported", () => {
    const decision = resolveHomeDocument(
      { version: 2, surface: "home", sections: [] },
      theme00,
    );

    expect(decision.source).toBe("default");
    expect(decision.reason).toBe("invalid");
    expect(decision.issues.length).toBeGreaterThan(0);
  });

  it("zero overlap with the catalog (theme changed): default wins once", () => {
    const decision = resolveHomeDocument(
      { version: 1, surface: "home", sections: [{ id: "x", type: "not-in-this-catalog" }] },
      theme00,
    );

    expect(decision.source).toBe("default");
    expect(decision.reason).toBe("no-overlap");
  });

  it("a type named like an Object.prototype member is not in the catalog", () => {
    const decision = resolveHomeDocument(
      { version: 1, surface: "home", sections: [{ id: "x", type: "constructor" }] },
      theme00,
    );

    expect(decision.source).toBe("default");
    expect(decision.reason).toBe("no-overlap");
  });

  it("partial overlap renders what maps (the designed degrade, not a fallback)", () => {
    const decision = resolveHomeDocument(
      {
        version: 1,
        surface: "home",
        sections: [
          { id: "known", type: "hero", props: {} },
          { id: "unknown", type: "not-in-this-catalog" },
        ],
      },
      theme00,
    );

    expect(decision.source).toBe("saved");
    expect(decision.reason).toBeNull();
  });

  it("an empty saved document is honored, never 'recovered' to the default", () => {
    const decision = resolveHomeDocument(
      { version: 1, surface: "home", sections: [] },
      theme00,
    );

    expect(decision.source).toBe("saved");
    expect(decision.result.page?.sections).toEqual([]);
  });
});

// ── The report is the catalog's, not a hand-rolled yes/no ───────────────────

describe("resolveHomeDocument — the degradation report names what is wrong", () => {
  it("names the unknown section by path and code", () => {
    const decision = resolveHomeDocument(
      {
        version: 1,
        surface: "home",
        sections: [
          { id: "known", type: "hero", props: {} },
          { id: "renamed", type: "hero-v2" },
        ],
      },
      theme00,
    );

    expect(decision.issues).toEqual([
      expect.objectContaining({ path: "sections[1].type", code: "unknown-type" }),
    ]);
  });

  it("names an undeclared prop — which a type-existence check could never see", () => {
    const decision = resolveHomeDocument(
      {
        version: 1,
        surface: "home",
        sections: [{ id: "h", type: "hero", props: { heroTitel: "typo" } }],
      },
      theme00,
    );

    expect(decision.issues).toEqual([
      expect.objectContaining({
        path: "sections[0].props.heroTitel",
        code: "unknown-prop",
      }),
    ]);
  });

  it("reports nothing for a clean document", () => {
    expect(resolveHomeDocument(SAVED_OVERRIDE, theme00).issues).toEqual([]);
  });

  it("keeps the saved reasons when it falls back (no-overlap)", () => {
    const decision = resolveHomeDocument(
      { version: 1, surface: "home", sections: [{ id: "x", type: "hero-v2" }] },
      theme00,
    );

    expect(decision.reason).toBe("no-overlap");
    expect(decision.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "unknown-type" })]),
    );
  });
});

// ── One container render: the saved document reaches real HTML ──────────────

function makeProduct(overrides: Partial<ProductList>): ProductList {
  return {
    id: "prod_x", name: "Fixture Product", description: null, descriptionFormat: "text",
    descriptionPlain: null, handle: "fixture-product", currency: "DZD", price: 4500,
    compareAtPrice: null, costPrice: null, type: "PHYSICAL", hasVariants: false,
    variantOptions: null, sku: null, inventory: 12, trackInventory: true,
    lowStockThreshold: 5, categoryId: null, tags: null, visibility: true,
    status: "ACTIVE", showInStore: true, storeFeatured: false, deletedAt: null,
    publishedAt: null, createdAt: "2026-08-03T09:58:12.000Z",
    updatedAt: "2026-09-19T14:21:44.000Z", coverImage: null, reviewStats: null,
    ...overrides,
  };
}

describe("home persistence — the saved document through the real renderer", () => {
  it("renders the saved override, and only the saved sections", async () => {
    const storefront = {
      products: { list: async () => [makeProduct({})] },
      categories: { list: async () => [] },
    } as unknown as StoreClient;

    const decision = resolveHomeDocument(SAVED_OVERRIDE, theme00);
    const context: ThemeRenderContext = {
      store: DEFAULT_CONFIG, content: enContent, isRTL: false, url: "/",
    };
    const reads = createReadCache();
    const container = await AstroContainer.create();

    let html = "";
    for (const section of decision.result.page?.sections ?? []) {
      html += await container.renderToString(InstanceView, {
        props: { instance: section as ComponentInstance, theme: theme00, context, storefront, reads },
      });
    }

    expect(html).toContain("Saved by the store");
    expect(html).not.toContain(enContent.heroTitle);
    expect(html).toContain(enContent.feature1Title);
    // The shipped default's other sections are absent — the saved document is
    // the whole page.
    expect(html).not.toContain(enContent.howItWorksTitle);
    expect(html).not.toContain(enContent.promoTitle);
  });
});