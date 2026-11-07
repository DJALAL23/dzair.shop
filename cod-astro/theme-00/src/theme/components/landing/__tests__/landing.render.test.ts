// @vitest-environment node
/**
 * A landing page is composed like any page, each with its own document
 * (`lp:<id>`): the page's images in their saved order with the saved gap —
 * all, or ranges with sections between them — and its one order form, never
 * the product page. It leaves out the header and footer by default, and holds
 * the sections that help a shopper decide.
 */
/// <reference types="vitest/globals" />

import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { createReadCache } from "@wocart/theme/astro";
import { isAreaShown, landingSurface, resolveSurfaceDocument } from "@wocart/theme";
import type { LandingPage, Review } from "@wocart/storefront";
import { describe, expect, it } from "vitest";
import Sections from "@/theme/components/surface/Sections.astro";
import { landingCatalog } from "@/theme/catalog/families/landing";
import { theme00 } from "@/theme/theme";
import { landingRead } from "@/theme/catalog/product/shared";
import { testLocals } from "@/theme/__tests__/support/locals";
import { productFixture } from "@/theme/__tests__/support/product";

const image = (id: string, position: number) => ({ id, key: `landing/${id}.webp`, url: `https://media.boutique.test/landing/${id}.webp`, width: 1080, height: 1350, altText: `alt ${id}`, position });

const landing = (overrides: Partial<LandingPage> = {}): LandingPage => ({
  id: "7f3a",
  slug: "lp-robe",
  name: "Robe ad",
  status: "published",
  imageGap: 24,
  metaTitle: null,
  metaDescription: null,
  publishedAt: "2026-10-01T00:00:00.000Z",
  images: [image("third", 3), image("first", 1), image("second", 2), image("fourth", 4)],
  product: productFixture({ name: "Robe kabyle", reviewStats: { avgRating: 4.8, reviewCount: 12 } }),
  document: null,
  tracking: { pixelId: "1234567890" },
  ...overrides,
});

const own = (sections: unknown[], extra: Record<string, unknown> = {}) => ({ version: 1, surface: "lp:7f3a", sections, ...extra });

async function render(page: LandingPage, options: { reviews?: Review[] } = {}) {
  const container = await AstroContainer.create();
  const reads = createReadCache();
  reads.get(landingRead(page.slug), async () => page);
  const client = { products: { reviews: { list: async () => ({ rows: options.reviews ?? [], total: options.reviews?.length ?? 0 }) } }, shipping: { rates: async () => ({}) } };
  return container.renderToString(Sections, {
    props: { theme: landingCatalog, surface: landingSurface(page.id), document: page.document, params: { slug: page.slug, surface: "landing", preview: "true" }, reads },
    locals: testLocals({ client: client as never }),
  });
}

const at = (html: string, id: string) => html.indexOf(`landing/${id}.webp`);

describe("a landing page with no layout of its own", () => {
  it("is its images, then its order form, and none of the product page", async () => {
    const html = await render(landing());
    expect(html).not.toMatch(/product-gallery|product-description|related-products|data-add-to-cart/);
    expect(html.match(/<form[^>]*class="order-form"/g)).toHaveLength(1);
    expect(html).toMatch(/name="landingPageSlug"[^>]*value="lp-robe"/);
    const order = ["first", "second", "third", "fourth"].map((id) => at(html, id));
    expect(order.every((index) => index > 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("puts the page's saved gap between its images, whatever it is", async () => {
    for (const gap of [0, 17, 64]) expect(await render(landing({ imageGap: gap }))).toContain(`--landing-gap: ${gap}px`);
  });

  it("leaves out the header and footer, until the merchant shows them", () => {
    const start = resolveSurfaceDocument(landingCatalog, "lp:7f3a", null).page;
    expect(["header", "footer"].map((key) => isAreaShown(theme00, start, key))).toEqual([false, false]);
    const shown = resolveSurfaceDocument(landingCatalog, "lp:7f3a", own([{ id: "order", type: "landing-order" }])).page;
    expect(["header", "footer"].map((key) => isAreaShown(theme00, shown, key))).toEqual([true, true]);
  });
});

describe("a landing page's own layout", () => {
  it("splits the images into ranges with sections between them", async () => {
    const html = await render(
      landing({
        document: own([
          { id: "top", type: "landing-images", props: { first: 1, count: 2 } },
          { id: "how", type: "how-it-works" },
          { id: "rest", type: "landing-images", props: { first: 3 } },
          { id: "order", type: "landing-order" },
        ]),
      }),
    );
    const steps = html.indexOf('class="steps"');
    expect(steps).toBeGreaterThan(0);
    expect(at(html, "second")).toBeLessThan(steps);
    expect(steps).toBeLessThan(at(html, "third"));
  });

  it("always keeps its order form, even when its document lost it", async () => {
    const html = await render(landing({ document: own([{ id: "faq", type: "faq" }]) }));
    expect(html).toMatch(/name="landingPageSlug"[^>]*value="lp-robe"/);
  });

  it("shows the reviews of the product it sells, without the write button when the merchant hides it", async () => {
    const review: Review = { id: "r1", customerName: "Amina", rating: 5, title: null, body: "Tissu doux, taille parfaite.", createdAt: "2026-10-20T10:00:00.000Z", verified: true, media: [] };
    const html = await render(landing({ document: own([{ id: "reviews", type: "product-reviews", props: { showForm: false } }, { id: "order", type: "landing-order" }]) }), { reviews: [review] });
    expect(html).toContain("Tissu doux, taille parfaite.");
    expect(html).not.toContain("data-review-open");
  });

  it("counts the offer down to the merchant's end, and shows nothing once it ended", async () => {
    const ahead = await render(landing({ document: own([{ id: "cd", type: "offer-countdown", props: { countdown: "date", endsOn: "2099-01-01", endsAt: "18:30" } }, { id: "order", type: "landing-order" }]) }));
    expect(ahead).toContain('data-countdown="2099-01-01T18:30"');
    const ended = await render(landing({ document: own([{ id: "cd", type: "offer-countdown", props: { countdown: "date", endsOn: "2020-01-01" } }, { id: "order", type: "landing-order" }]) }));
    expect(ended).not.toContain("data-countdown");
  });

  it("names its product, its price and its stars for a page whose images do not", async () => {
    const html = await render(landing({ document: own([{ id: "name", type: "landing-product" }, { id: "order", type: "landing-order" }]) }));
    expect(html).toMatch(/<h1 class="landing-product-name"[^>]*>Robe kabyle<\/h1>/);
    expect(html).toContain("landing-product-stars");
  });
});
