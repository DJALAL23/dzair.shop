// @vitest-environment node
/// <reference types="vitest/globals" />
/**
 * Home adsorption — Phase 5 (slice 15).
 *
 * Runs the REAL pipeline on the REAL artifacts: the shipped document
 * (`src/theme/pages/home.page.json`), the real definitions (`@/theme/theme`),
 * the real renderer (`@wocart/theme/astro`) and the real Home components.
 * Only `@wocart/storefront` is stubbed, at its usual seam, with product shapes
 * captured from a live cod-server.
 */
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { describe, expect, it, vi } from "vitest";
import type { Category, ProductList } from "@wocart/storefront";
import type { StoreClient } from "@wocart/storefront/server";
import InstanceView from "@wocart/theme/astro/InstanceView.astro";
import { createReadCache } from "@wocart/theme/astro";
import { parsePageData, validateThemeDefinition } from "@wocart/theme";
import type {
  ComponentDefinition,
  ComponentInstance,
  ReadCache,
  ThemeRenderContext,
} from "@wocart/theme";
import { theme00 } from "@/theme/theme";
import { makeProduct } from "../support/home-render";
import { testLocals, TEST_CONFIG } from "../support/locals";
import { en } from "@/theme/content/en";
import homePage from "@/theme/pages/home.page.json";

// Every section reads through the `storefront` the renderer hands to its
// `load` — CustomerTestimonials' reviews included — so one stub serves them all.

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
  reviewStats: { avgRating: 4.8, reviewCount: 4 },
});
const PLAIN = makeProduct({
  id: "prod_plain",
  name: "Plain Mug",
  handle: "plain-mug",
});

function makeCategory(overrides: Partial<Category>): Category {
  return {
    id: "cat_x",
    name: "Fixture Category",
    slug: "fixture-category",
    description: null,
    parentId: null,
    image: null,
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

/**
 * The catalog, and each collection's products as the merchant ordered them:
 * `products.list({ collection })` answers the collection, and
 * `products.list({ onSale: true })` the products on sale, capped at `limit`,
 * as the server does; an unknown collection answers nothing.
 */
function createStorefrontStub(products: ProductList[] = [], collections: Record<string, ProductList[]> = {}, onSale: ProductList[] = []) {
  const productsList = vi.fn(async (filters?: { collection?: string; onSale?: boolean; limit?: number }) => {
    const listed = filters?.onSale ? onSale : filters?.collection === undefined ? products : collections[filters.collection] ?? [];
    return listed.slice(0, filters?.limit ?? listed.length);
  });
  const categoriesList = vi.fn(async () => CATEGORIES);
  const reviewsList = vi.fn(async () => ({ rows: REVIEW_ROWS, total: REVIEW_ROWS.length }));
  const collectionsGet = vi.fn(async (handle: string) => (handle in collections ? { handle, title: handle } : null));
  const client = {
    products: { list: productsList, reviews: { list: reviewsList } },
    categories: { list: categoriesList },
    collections: { get: collectionsGet },
  } as unknown as StoreClient;
  return { client, productsList, categoriesList, reviewsList, collectionsGet };
}

const containerPromise = AstroContainer.create();

function createHarness(
  storefront: StoreClient,
  store = TEST_CONFIG,
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
        locals: testLocals({ client: storefront }),
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

/** A section the merchant inserts, as the editor would: its type and no props. */
const inserted = (type: string): ComponentInstance => ({ id: `cmp_${type}`, type, props: {} });

// ── Tests ────────────────────────────────────────────────────────────────────

describe("home adsorption — the shipped document", () => {
  it("parses clean and lists the shipped home's sections, in order", () => {
    expect(shipped.issues).toEqual([]);
    expect(shipped.page?.sections.map((s) => s.type)).toEqual([
      "hero",
      "marquee",
      "category-cards",
      "product-tabs",
      "image-banner",
      "how-it-works",
      "customer-testimonials",
      "features-bar",
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
    const promo = await render(inserted("whatsapp-cta"));
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
  it("each section reads the collection it names once; the catalog and categories once", async () => {
    const stub = createStorefrontStub([FEATURED, PLAIN], { "best-sellers": [FEATURED], "new-arrivals": [PLAIN] });
    const { render } = createHarness(stub.client);
    const best = await render(inserted("best-sellers"));
    const again = await render(inserted("best-sellers"));
    const arrivals = await render(inserted("new-arrivals"));
    const cards = await render(shippedSection("category-cards"));

    expect(stub.productsList.mock.calls.map(([filters]) => filters?.collection ?? "catalog").sort()).toEqual(["best-sellers", "catalog", "new-arrivals"]);
    expect(stub.categoriesList).toHaveBeenCalledTimes(1);

    // What a list shows is the merchant's: each section, its own collection.
    expect(best).toContain("Featured Watch");
    expect(best).not.toContain("Plain Mug");
    expect(again).toBe(best);
    expect(arrivals).toContain("Plain Mug");
    expect(arrivals).not.toContain("Featured Watch");

    // CategoryCards owns sort-by-position; the page-level read stays unsorted.
    expect(cards).toContain("Watches");
    expect(cards.indexOf("Watches")).toBeLessThan(cards.indexOf("Home"));
    expect(cards).toContain("/category/watches");
  });
});

describe("home adsorption — collections are the merchant's", () => {
  it("an empty collection shows no section and no slip — never the catalog in its place", async () => {
    const stub = createStorefrontStub([FEATURED, PLAIN], {});
    const { render } = createHarness(stub.client);
    expect(await render(inserted("best-sellers"))).not.toContain('id="best-sellers"');
    expect(await render(inserted("new-arrivals"))).not.toContain('id="new-arrivals"');
    const hero = await render(shippedSection("hero"));
    expect(hero).toContain(en.heroTitle);
    expect(hero).not.toContain("Featured Watch");
    expect(hero).not.toContain("Plain Mug");
  });

  it("a section shows the collection the merchant picked for it", async () => {
    const stub = createStorefrontStub([FEATURED, PLAIN], { ramadan: [PLAIN] });
    const { render } = createHarness(stub.client);
    const html = await render({ id: "b", type: "best-sellers", props: { collection: "ramadan" } });
    expect(html).toContain("Plain Mug");
    expect(html).not.toContain("Featured Watch");
  });
});

describe("home adsorption — reviews (config default, override, in-section read)", () => {
  it("config off, no override: the section is absent and no review read happens", async () => {
    const stub = createStorefrontStub([FEATURED]);
    const { render } = createHarness(stub.client, { ...TEST_CONFIG, reviewsEnabled: false });
    const html = await render(shippedSection("customer-testimonials"));
    expect(decode(html)).not.toContain(en.testimonialsTitle);
    expect(stub.reviewsList).not.toHaveBeenCalled();
  });

  it("config on: the section renders reviews fetched by the section itself", async () => {
    const stub = createStorefrontStub([FEATURED]);
    const { render } = createHarness(stub.client, { ...TEST_CONFIG, reviewsEnabled: true });
    const html = await render(shippedSection("customer-testimonials"));
    expect(decode(html)).toContain(en.testimonialsTitle);
    expect(html).toContain("Fast and honest");
    expect(stub.reviewsList).toHaveBeenCalledTimes(1);
  });

  it("a stored `enabled` beats the config (boolean field, no default)", async () => {
    const stub = createStorefrontStub([FEATURED]);
    const { render } = createHarness(stub.client, { ...TEST_CONFIG, reviewsEnabled: false });
    const html = await render({
      id: "cmp_reviews_on",
      type: "customer-testimonials",
      props: { enabled: true },
    });
    expect(html).toContain("Fast and honest");
  });
});

describe("home adsorption — the full page", () => {
  it("renders every shipped section in order through one renderer cache", async () => {
    const stub = createStorefrontStub([FEATURED, PLAIN], { "best-sellers": [FEATURED], "new-arrivals": [PLAIN] }, [PLAIN]);
    const { render } = createHarness(stub.client, { ...TEST_CONFIG, reviewsEnabled: true });
    let html = "";
    for (const section of shipped.page?.sections ?? []) {
      html += await render(section);
    }
    const text = decode(html);

    const order = [
      en.heroTitle,
      en.trust1Title,
      "/category/watches",
      en.productTabsTitle,
      en.bannerTitle,
      en.howItWorksTitle,
      en.testimonialsTitle,
      en.feature1Title,
    ];
    let cursor = -1;
    for (const marker of order) {
      const at = text.indexOf(marker, cursor + 1);
      expect(at, `"${marker}" missing or out of order`).toBeGreaterThan(cursor);
      cursor = at;
    }

    // The whole page reads each list once — the banner shares the tabs' sale
    // read, the hero its photo collection — and the categories once.
    expect(stub.productsList.mock.calls.map(([filters]) => (filters?.onSale ? "on-sale" : filters?.collection ?? "catalog")).sort()).toEqual([
      "best-sellers",
      "catalog",
      "featured",
      "new-arrivals",
      "on-sale",
    ]);
    expect(stub.categoriesList).toHaveBeenCalledTimes(1);
    expect(text).toContain("Featured Watch");
    expect(text).toContain("Plain Mug");
  });
});
