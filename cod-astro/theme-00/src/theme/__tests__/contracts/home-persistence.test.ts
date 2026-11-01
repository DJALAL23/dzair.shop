// @vitest-environment node
/// <reference types="vitest/globals" />
/**
 * Home document persistence — Phase 6 (slices 19/20).
 *
 * Proves what the home surface renders (`resolveSurfaceDocument`, as
 * `components/surface/Sections.astro` calls it):
 * the store's saved document when it is usable, the shipped default otherwise
 * (absent, unparseable/wrong version, or zero type overlap after a theme
 * change) — and that an empty saved document is honored, not "recovered".
 *
 * Plus one container render: a saved override reaches real HTML through the
 * real renderer, with the shipped default providing everything else.
 */
import { testLocals, TEST_CONFIG } from "../support/locals";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { describe, expect, it, vi } from "vitest";
import type { ProductList } from "@wocart/storefront";
import type { StoreClient } from "@wocart/storefront/server";
import InstanceView from "@wocart/theme/astro/InstanceView.astro";
import { createReadCache } from "@wocart/theme/astro";
import type { ComponentInstance, ThemeRenderContext } from "@wocart/theme";
import { theme00 } from "@/theme/theme";
import { makeProduct } from "../support/home-render";
import { en as enContent } from "@/theme/content/en";
import { resolveSurfaceDocument } from "@wocart/theme";
import { reportSurface } from "@/theme/pages/surface-report";
import shippedHome from "@/theme/pages/home.page.json";

/** What the home surface renders for a saved document, as the page resolves it. */
const resolveHome = (saved: unknown) => resolveSurfaceDocument(theme00, "home", saved, { content: enContent, locales: ["en"] });

const SAVED_OVERRIDE = {
  version: 1,
  surface: "home",
  sections: [
    { id: "cmp_saved_hero", type: "hero", props: { heroTitle: "Saved by the store" } },
    { id: "cmp_saved_feat", type: "features-bar", props: {} },
  ],
};

describe("the home surface — what the home surface renders", () => {
  it("absent (null): the shipped default wins", () => {
    const decision = resolveHome(null);

    expect(decision.source).toBe("default");
    expect(decision.reason).toBe("absent");
    expect(decision.page?.sections.map((s) => s.type)).toEqual(
      shippedHome.sections.map((s) => s.type),
    );
  });

  it("a usable saved document wins, instances intact", () => {
    const decision = resolveHome(SAVED_OVERRIDE);

    expect(decision.source).toBe("saved");
    expect(decision.reason).toBeNull();
    expect(decision.issues).toEqual([]);
    expect(decision.page?.sections.map((s) => s.id)).toEqual([
      "cmp_saved_hero",
      "cmp_saved_feat",
    ]);
  });

  it("unparseable / wrong-version saved document: default wins, issues reported", () => {
    const decision = resolveHome({ version: 2, surface: "home", sections: [] });

    expect(decision.source).toBe("default");
    expect(decision.reason).toBe("invalid");
    expect(decision.issues.length).toBeGreaterThan(0);
  });

  it("zero overlap with the catalog (theme changed): default wins once", () => {
    const decision = resolveHome({ version: 1, surface: "home", sections: [{ id: "x", type: "not-in-this-catalog" }] });

    expect(decision.source).toBe("default");
    expect(decision.reason).toBe("no-overlap");
  });

  it("a document another theme wrote: default wins, even when its sections overlap", () => {
    const decision = resolveHome({ version: 1, surface: "home", theme: { key: "another-theme", version: "2.0.0" }, sections: [{ id: "h", type: "hero" }] });

    expect(decision.source).toBe("default");
    expect(decision.reason).toBe("other-theme");
    expect(decision.issues.map((issue) => issue.code)).toContain("theme-mismatch");
  });

  it("a document this theme wrote, at any of its versions, is the saved one", () => {
    const decision = resolveHome({ version: 1, surface: "home", theme: { key: "theme-00", version: "0.9.0" }, sections: [{ id: "h", type: "hero" }] });

    expect(decision.source).toBe("saved");
    expect(decision.reason).toBeNull();
  });

  it("a type named like an Object.prototype member is not in the catalog", () => {
    const decision = resolveHome({ version: 1, surface: "home", sections: [{ id: "x", type: "constructor" }] });

    expect(decision.source).toBe("default");
    expect(decision.reason).toBe("no-overlap");
  });

  it("partial overlap renders what maps (the designed degrade, not a fallback)", () => {
    const decision = resolveHome({
        version: 1,
        surface: "home",
        sections: [
          { id: "known", type: "hero", props: {} },
          { id: "unknown", type: "not-in-this-catalog" },
        ],
      });

    expect(decision.source).toBe("saved");
    expect(decision.reason).toBeNull();
  });

  it("an empty saved document is honored, never 'recovered' to the default", () => {
    const decision = resolveHome({ version: 1, surface: "home", sections: [] });

    expect(decision.source).toBe("saved");
    expect(decision.page?.sections).toEqual([]);
  });
});

describe("reportSurface — what the operator sees", () => {
  it("says nothing when the saved document rendered cleanly", () => {
    const warn = vi.fn();
    reportSurface("home", resolveHome({ version: 1, surface: "home", sections: [] }), warn);
    expect(warn).not.toHaveBeenCalled();
  });

  it("names why the default won and each section-level reason", () => {
    const warn = vi.fn();
    reportSurface("home", 
      resolveHome({ version: 1, surface: "home", sections: [{ id: "x", type: "not-in-this-catalog" }] }),
      warn,
    );
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("default (no-overlap)"));
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("home: 1 issue(s)"),
      [expect.stringContaining("sections[0].type unknown-type")],
    );
  });
});

// ── The report is the catalog's, not a hand-rolled yes/no ───────────────────

describe("the home surface — the degradation report names what is wrong", () => {
  it("names the unknown section by path and code", () => {
    const decision = resolveHome({
        version: 1,
        surface: "home",
        sections: [
          { id: "known", type: "hero", props: {} },
          { id: "renamed", type: "hero-v2" },
        ],
      });

    expect(decision.issues).toEqual([
      expect.objectContaining({ path: "sections[1].type", code: "unknown-type" }),
    ]);
  });

  it("names an undeclared prop — which a type-existence check could never see", () => {
    const decision = resolveHome({
        version: 1,
        surface: "home",
        sections: [{ id: "h", type: "hero", props: { heroTitel: "typo" } }],
      });

    expect(decision.issues).toEqual([
      expect.objectContaining({
        path: "sections[0].props.heroTitel",
        code: "unknown-prop",
      }),
    ]);
  });

  it("reports nothing for a clean document", () => {
    expect(resolveHome(SAVED_OVERRIDE).issues).toEqual([]);
  });

  it("keeps the saved reasons when it falls back (no-overlap)", () => {
    const decision = resolveHome({ version: 1, surface: "home", sections: [{ id: "x", type: "hero-v2" }] });

    expect(decision.reason).toBe("no-overlap");
    expect(decision.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "unknown-type" })]),
    );
  });
});

// ── One container render: the saved document reaches real HTML ──────────────


describe("home persistence — the saved document through the real renderer", () => {
  it("renders the saved override, and only the saved sections", async () => {
    const storefront = {
      products: { list: async () => [makeProduct({})] },
      categories: { list: async () => [] },
    } as unknown as StoreClient;

    const decision = resolveHome(SAVED_OVERRIDE);
    const context: ThemeRenderContext = {
      store: TEST_CONFIG, content: enContent, locale: "en", isRTL: false, url: "/",
    };
    const reads = createReadCache();
    const container = await AstroContainer.create();

    let html = "";
    for (const section of decision.page?.sections ?? []) {
      html += await container.renderToString(InstanceView, {
        props: { instance: section as ComponentInstance, theme: theme00, context, storefront, reads },
        locals: testLocals({ client: storefront }),
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