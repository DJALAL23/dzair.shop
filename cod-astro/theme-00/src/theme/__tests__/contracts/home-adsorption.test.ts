// @vitest-environment node
/// <reference types="vitest/globals" />
/**
 * Home adsorption — Phase 5 (slice 15).
 *
 * Runs the REAL pipeline on the REAL artifacts: the shipped document
 * (`src/theme/pages/home.page.json`), the real definitions (`@/theme/theme`),
 * the real renderer (`@codflow/theme/astro`) and the real Home components.
 * Only `@codflow/storefront` is stubbed, at its usual seam, with the shapes
 * `cod-sdk/storefront/fixtures/cod-server/products-list.json` captured live.
 */
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { describe, expect, it, vi } from "vitest";
import type { Category, ProductList } from "@codflow/storefront";
import type { StoreClient } from "@codflow/storefront/server";
import InstanceView from "@codflow/theme/astro/InstanceView.astro";
import { createReadCache } from "@codflow/theme/astro";
import { parsePageData, validateThemeDefinition } from "@codflow/theme";
import type {
  ComponentDefinition,
  ComponentInstance,
  ReadCache,
  ThemeRenderContext,
} from "@codflow/theme";
import { theme00 } from "@/theme/theme";
import { makeProduct } from "../support/home-render";
import { DEFAULT_CONFIG } from "@/theme/runtime/store";
import { en } from "@/theme/content/en";
import homePage from "@/theme/pages/home.page.json";

// CustomerTestimonials fetches its reviews through the theme's ONE adapter
// seam (`@/theme/sdk`) — the documented in-section read. The same stub serves
// both sides: `getStoreClient()` for the section's own read, and the
// `storefront` prop the renderer hands to `load`.
const { mockStore } = vi.hoisted(() => ({ mockStore: { current: null as unknown } }));
vi.mock("@/theme/sdk", () => ({ getStoreClient: () => mockStore.current }));

/** Decoded text for copy assertions (Astro escapes `&` etc. in markup). */
function decode(html: string): string {
  return html
    .replace(/&#39;|&#x27;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

// ── Fixtures (shape-faithful; see ProductListSchema / CategorySchema) ────────


const FEATURED = makeProduct({
  id: "prod_featured",
  name: "Featured Watch",
  handle: "featured-watch",
  storeFeatured: true,
  reviewStats: { avgRating: 4.8, reviewCount: 4 },
});
const PLAIN = makeProduct({
  id: "prod_plain",
  name: "Plain Mug",
  handle: "plain-mug",
  storeFeatured: false,
});

function makeCategory(overrides: Partial<Category>): Category {
  return {
    id: "cat_x",
    name: "Fixture Category",
    slug: "fixture-category",
    description: null,
    parentId: null,
    imageUrl: null,
    metaTitle: null,
    metaDescription: null,
    metaKeywords: null,
    position: 0,
    createdAt: "2026-08-03T09:58:12.000Z",
    updatedAt: "2026-09-19T14:21:44.000Z",
    ...overrides,
  };
}

const CATEGORIES: Category[] = [
  makeCategory({ id: "cat_first", name: "Watches", slug: "watches", position: 0 }),
  makeCategory({ id: "cat_second", name: "Home", slug: "home", position: 1 }),
];

const REVIEW_ROWS = [
  { id: "rev_1", body: "Fast and honest", rating: 5, customerName: "Amina" },
];

// ── Harness ──────────────────────────────────────────────────────────────────

function createStorefrontStub(products: ProductList[] = []) {
  const productsList = vi.fn(async () => products);
  const categoriesList = vi.fn(async () => CATEGORIES);
  const reviewsList = vi.fn(async () => ({ rows: REVIEW_ROWS, total: REVIEW_ROWS.length }));
  const client = {
    products: { list: productsList, reviews: { list: reviewsList } },
    categories: { list: categoriesList },
  } as unknown as StoreClient;
  mockStore.current = client;
  return { client, productsList, categoriesList, reviewsList };
}

const containerPromise = AstroContainer.create();

function createHarness(
  storefront: StoreClient,
  store = DEFAULT_CONFIG,
): { render: (instance: ComponentInstance) => Promise<string>; reads: ReadCache } {
  const reads = createReadCache();
  const context: ThemeRenderContext = {
    store,
    content: en,
    locale: "en",
    isRTL: false,
    url: "/",
  };
  return {
    reads,
    render: async (instance) => {
      const container = await containerPromise;
      return container.renderToString(InstanceView, {
        props: { instance, theme: theme00, context, storefront, reads },
      });
    },
  };
}

const shipped = parsePageData(homePage);

function shippedSection(type: string): ComponentInstance {
  const section = shipped.page?.sections.find((s) => s.type === type);
  if (!section) throw new Error(`shipped document has no "${type}" section`);
  return section;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("home adsorption — the shipped document", () => {
  it("parses clean and matches the pre-adsorption section list, in order", () => {
    expect(shipped.issues).toEqual([]);
    expect(shipped.page?.sections.map((s) => s.type)).toEqual([
      "hero",
      "category-cards",
      "best-sellers",
      "how-it-works",
      "new-arrivals",
      "features-bar",
      "whatsapp-cta",
      "customer-testimonials",
    ]);
  });

  it("every referenced type exists, insertable, in a valid catalog", () => {
    expect(validateThemeDefinition(theme00)).toEqual([]);
    const catalog: Record<string, ComponentDefinition> = theme00.components;
    for (const section of shipped.page?.sections ?? []) {
      const definition = catalog[section.type];
      expect(definition, section.type).toBeDefined();
      expect(definition?.capabilities?.insertable, section.type).toBe(true);
    }
  });
});

describe("home adsorption — copy (contentKey bridge)", () => {
  it("empty props render the pack exactly (parity)", async () => {
    const { client } = createStorefrontStub();
    const { render } = createHarness(client);
    const hero = await render(shippedSection("hero"));
    const how = await render(shippedSection("how-it-works"));
    const features = await render(shippedSection("features-bar"));
    const promo = await render(shippedSection("whatsapp-cta"));
    expect(decode(hero)).toContain(en.heroTitle);
    expect(decode(hero)).toContain(en.heroCtaPrimary);
    expect(decode(how)).toContain(en.howItWorksTitle);
    expect(decode(how)).toContain(en.howStep1Title);
    expect(decode(features)).toContain(en.feature1Title);
    expect(decode(promo)).toContain(en.promoTitle);
  });

  it("a stored prop overrides the pack through the real component", async () => {
    const { client } = createStorefrontStub();
    const { render } = createHarness(client);
    const html = await render({
      id: "cmp_override",
      type: "hero",
      props: { heroTitle: "Same-day delivery, everywhere" },
    });
    expect(html).toContain("Same-day delivery, everywhere");
    expect(html).not.toContain(en.heroTitle);
    expect(decode(html)).toContain(en.heroSubtitle); // untouched fields keep the pack
  });
});

describe("home adsorption — data graph (one read per resource per render)", () => {
  it("three catalog consumers share one products read; categories read once", async () => {
    const stub = createStorefrontStub([FEATURED, PLAIN]);
    const { render } = createHarness(stub.client);
    const best = await render(shippedSection("best-sellers"));
    const arrivals = await render(shippedSection("new-arrivals"));
    const cards = await render(shippedSection("category-cards"));

    expect(stub.productsList).toHaveBeenCalledTimes(1);
    expect(stub.categoriesList).toHaveBeenCalledTimes(1);

    // Merchandising rules stay in the components: featured-first vs non-featured.
    expect(best).toContain("Featured Watch");
    expect(best).not.toContain("Plain Mug");
    expect(arrivals).toContain("Plain Mug");
    expect(arrivals).not.toContain("Featured Watch");

    // CategoryCards owns sort-by-position; the page-level read stays unsorted.
    expect(cards).toContain("Watches");
    expect(cards.indexOf("Watches")).toBeLessThan(cards.indexOf("Home"));
    expect(cards).toContain("/category/watches");
  });
});

describe("home adsorption — reviews (config default, override, in-section read)", () => {
  it("config off, no override: the section is absent and no review read happens", async () => {
    const stub = createStorefrontStub([FEATURED]);
    const { render } = createHarness(stub.client, { ...DEFAULT_CONFIG, reviewsEnabled: false });
    const html = await render(shippedSection("customer-testimonials"));
    expect(decode(html)).not.toContain(en.testimonialsTitle);
    expect(stub.reviewsList).not.toHaveBeenCalled();
  });

  it("config on: the section renders reviews fetched by the section itself", async () => {
    const stub = createStorefrontStub([FEATURED]);
    const { render } = createHarness(stub.client, { ...DEFAULT_CONFIG, reviewsEnabled: true });
    const html = await render(shippedSection("customer-testimonials"));
    expect(decode(html)).toContain(en.testimonialsTitle);
    expect(html).toContain("Fast and honest");
    expect(stub.reviewsList).toHaveBeenCalledTimes(1);
  });

  it("a stored `enabled` beats the config (boolean field, no default)", async () => {
    const stub = createStorefrontStub([FEATURED]);
    const { render } = createHarness(stub.client, { ...DEFAULT_CONFIG, reviewsEnabled: false });
    const html = await render({
      id: "cmp_reviews_on",
      type: "customer-testimonials",
      props: { enabled: true },
    });
    expect(html).toContain("Fast and honest");
  });
});

describe("home adsorption — the full page", () => {
  it("renders all eight shipped sections in order through one renderer cache", async () => {
    const stub = createStorefrontStub([FEATURED, PLAIN]);
    const { render } = createHarness(stub.client);
    let html = "";
    for (const section of shipped.page?.sections ?? []) {
      html += await render(section);
    }
    const text = decode(html);

    // Section anchors + unique copy, in the order the page rendered before
    // adsorption. (`id=` markers: "Best Sellers" alone collides with the hero's
    // "View Best Sellers" CTA copy.)
    const order = [
      en.heroTitle,
      "/category/watches",
      'id="best-sellers"',
      'id="how-it-works"',
      'id="new-arrivals"',
      en.feature1Title,
      en.promoTitle,
      en.testimonialsTitle,
    ];
    let cursor = -1;
    for (const marker of order) {
      const at = text.indexOf(marker);
      expect(at, `"${marker}" missing`).toBeGreaterThan(-1);
      expect(at, `"${marker}" out of order`).toBeGreaterThan(cursor);
      cursor = at;
    }

    // The whole page still costs exactly one products + one categories read.
    expect(stub.productsList).toHaveBeenCalledTimes(1);
    expect(stub.categoriesList).toHaveBeenCalledTimes(1);
  });
});

