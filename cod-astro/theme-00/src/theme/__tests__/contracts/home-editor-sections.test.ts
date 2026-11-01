// @vitest-environment node
/// <reference types="vitest/globals" />
/**
 * The home sections built on the editor's richer fields — an image banner, a
 * rich-text block, a FAQ list and a featured product — proven through the
 * real renderer: what a merchant saves shows, an empty section disappears,
 * and a hostile value never reaches the markup. Then the editor's side: a
 * document composed with the SDK's operations from this theme's manifest
 * alone renders without a report.
 */
import { describe, expect, it, vi } from "vitest";
import type { RendererIssue } from "@wocart/theme/astro";
import {
  checkPageData,
  createInstance,
  insertInstance,
  manifestCatalog,
  setInstanceHidden,
  setInstanceProps,
  themeManifest,
  validatePageData,
} from "@wocart/theme";
import type { ComponentInstance, JsonObject, JsonValue, PageData } from "@wocart/theme";
import type { Product, ProductList } from "@wocart/storefront";
import type { StoreClient } from "@wocart/storefront/server";
import { en } from "@/theme/content/en";
import { ar } from "@/theme/content/ar";
import { theme00 } from "@/theme/theme";
import shippedHome from "@/theme/pages/home.page.json";
import { fakeStorefront, makeProduct, renderSections } from "../support/home-render";

vi.mock("astro:env/server", () => ({
  COD_SERVER_URL: "http://localhost:8787",
  STORE_API_KEY: "test-key",
}));

/** Text as Astro writes it into markup. */
const escaped = (value: string) => value.replace(/&/g, "&amp;").replace(/'/g, "&#39;").replace(/"/g, "&quot;");
const doc = (...content: JsonValue[]): JsonObject => ({ type: "doc", version: 1, content });
const paragraph = (...content: JsonValue[]): JsonObject => ({ type: "paragraph", content });
const text = (value: string, extra: JsonObject = {}): JsonObject => ({ type: "text", text: value, ...extra });

const robe: Product = {
  ...makeProduct({ id: "prod_robe", name: "Robe kabyle", handle: "robe-kabyle", price: 8900, compareAtPrice: 9900 }),
  images: [{ id: "img_1", key: "products/robe.webp", url: "https://media.boutique.test/products/robe.webp", width: null, height: null, altText: "Robe brodée", position: 1 }],
  variants: [],
  offers: [],
  category: null,
  tags: [],
  variantOptions: null,
  reviewStats: null,
} as unknown as Product;

/** A storefront that also reads single products, counting the reads. */
function storefront(products: Product[] = [robe]) {
  const reads: string[] = [];
  const base = fakeStorefront(products as unknown as ProductList[]);
  const client = {
    ...base,
    products: {
      ...base.products,
      get: async (handle: string) => {
        reads.push(handle);
        return products.find((product) => product.handle === handle) ?? null;
      },
    },
  } as unknown as StoreClient;
  return { client, reads };
}

async function render(sections: ComponentInstance[], options: { locale?: string; content?: Record<string, string> } = {}) {
  const issues: RendererIssue[] = [];
  const html = await renderSections(sections, storefront().client, { ...options, onIssue: (issue) => issues.push(issue) });
  return { html, issues };
}

describe("image banner", () => {
  const image = { key: "products/3f2a9c.webp", alt: { en: "Summer dresses", ar: "فساتين صيفية" }, width: 1600, height: 1200, focal: { x: 0.25, y: 0.75 } };

  it("shows the merchant's photo from the store's media, with its alt text and focal point", async () => {
    const { html, issues } = await render([{ id: "b", type: "image-banner", props: { image, body: doc(paragraph(text("Free delivery", { marks: ["bold"] }))) } }]);
    expect(issues).toEqual([]);
    expect(html).toContain("media.boutique.test");
    expect(html).toContain("products/3f2a9c.webp");
    expect(html).toContain('alt="Summer dresses"');
    expect(html).toContain("object-position: 25% 75%");
    expect(html).toContain("<strong>Free delivery</strong>");
    expect(html).toContain(escaped(en.bannerTitle));
    expect(html).toContain(escaped(en.bannerCta));
  });

  it("reads alt text in the shopper's language", async () => {
    const { html } = await render([{ id: "b", type: "image-banner", props: { image } }], { locale: "ar", content: ar });
    expect(html).toContain('alt="فساتين صيفية"');
    expect(html).toContain(ar.bannerTitle);
  });

  it("is a band of copy without a photo, and puts the photo at the start when asked", async () => {
    const without = (await render([{ id: "b", type: "image-banner" }])).html;
    expect(without).toContain("no-photo");
    expect(without).not.toContain("<img");
    expect((await render([{ id: "b", type: "image-banner", props: { image, imageSide: "start" } }])).html).toContain("photo-start");
  });

  it("never renders a URL stored instead of a media key, nor a script link", async () => {
    const { html, issues } = await render([
      {
        id: "b",
        type: "image-banner",
        props: {
          image: { key: "https://evil.example/x.png" },
          body: doc(paragraph(text("click", { link: "javascript:alert(1)" }), text("<script>alert(1)</script>"))),
          ctaHref: "javascript:alert(1)",
        },
      },
    ]);
    expect(html).not.toContain("evil.example");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("<script>alert");
    expect(issues.map((issue) => `${issue.path} ${issue.code}`)).toEqual([
      "props.image invalid-prop",
      "props.body invalid-prop",
      "props.ctaHref invalid-prop",
    ]);
  });
});

describe("rich-text block", () => {
  it("renders nothing until the merchant writes something", async () => {
    expect((await render([{ id: "r", type: "rich-text" }])).html.trim()).toBe("");
  });

  it("renders the merchant's text under the section title, escaped, links in the shopper's language", async () => {
    const body = doc(
      { type: "heading", level: 3, content: [text("Since 2019")] },
      paragraph(text("We deliver "), text("everywhere", { marks: ["italic"] }), text(" — see "), text("<terms>", { link: "/pages/terms" })),
      { type: "list", style: "bullet", items: [{ content: [text("Cash on delivery")] }] },
    );
    const { html, issues } = await render([{ id: "r", type: "rich-text", props: { body, alignment: "center" } }]);
    expect(issues).toEqual([]);
    expect(html).toContain(en.richTextTitle);
    expect(html).toContain("<h3>Since 2019</h3>");
    expect(html).toContain("<em>everywhere</em>");
    expect(html).toContain('<a href="/pages/terms">&lt;terms&gt;</a>');
    expect(html).toContain("<ul><li>Cash on delivery</li></ul>");
    expect(html).toContain("text-center");
  });

  it("takes each language's own document", async () => {
    const body = { en: doc(paragraph(text("Our story"))), ar: doc(paragraph(text("قصتنا الحقيقية"))) };
    expect((await render([{ id: "r", type: "rich-text", props: { body } }], { locale: "ar", content: ar })).html).toContain("قصتنا الحقيقية");
  });
});

describe("FAQ", () => {
  it("renders nothing without questions", async () => {
    expect((await render([{ id: "f", type: "faq" }])).html.trim()).toBe("");
  });

  it("renders each question as a disclosure row, in order, with its formatted answer", async () => {
    const questions: JsonValue[] = [
      { id: "delivery", props: { question: "When will it arrive?", answer: doc(paragraph(text("Within "), text("48 hours", { marks: ["bold"] }))) } },
      { id: "empty", props: { answer: doc(paragraph(text("no question, not shown"))) } },
      { id: "returns", props: { question: { en: "Can I return it?", ar: "هل يمكنني الإرجاع؟" } } },
    ];
    const { html, issues } = await render([{ id: "f", type: "faq", props: { questions } }]);
    expect(issues).toEqual([]);
    expect(html).toContain(en.faqTitle);
    expect(html.indexOf('data-question="delivery"')).toBeLessThan(html.indexOf('data-question="returns"'));
    expect(html).toContain("<strong>48 hours</strong>");
    expect(html).not.toContain("no question, not shown");
    expect(html.match(/<details/g)).toHaveLength(2);
  });

  it("refuses an answer format the field does not allow", async () => {
    const questions = [{ id: "q", props: { question: "Q", answer: doc({ type: "heading", level: 2, content: [text("H")] }) } }];
    const { html, issues } = await render([{ id: "f", type: "faq", props: { questions } }]);
    expect(html).not.toContain("<h2>H</h2>");
    expect(issues.map((issue) => issue.path)).toEqual(["props.questions[0].props.answer"]);
  });
});

describe("featured product", () => {
  it("renders nothing until a product is chosen, or when it is gone", async () => {
    expect((await render([{ id: "p", type: "featured-product" }])).html.trim()).toBe("");
    expect((await render([{ id: "p", type: "featured-product", props: { product: "deleted-product" } }])).html.trim()).toBe("");
  });

  it("shows the chosen product with its price and a link to its page", async () => {
    const { html, issues } = await render([{ id: "p", type: "featured-product", props: { product: "robe-kabyle" } }]);
    expect(issues).toEqual([]);
    expect(html).toContain("Robe kabyle");
    expect(html).toContain(en.featuredProductTitle);
    expect(html).toContain(en.featuredProductCta);
    expect(html).toContain('href="/products/robe-kabyle"');
    expect(html).toContain('alt="Robe brodée"');
    expect(html).toContain("price-was");
  });

  it("reads a product once per render, however many sections show it", async () => {
    const { client, reads } = storefront();
    await renderSections(
      [
        { id: "p1", type: "featured-product", props: { product: "robe-kabyle" } },
        { id: "p2", type: "featured-product", props: { product: "robe-kabyle" } },
      ],
      client,
    );
    expect(reads).toEqual(["robe-kabyle"]);
  });
});

describe("an editor composing the home page from the manifest alone", () => {
  it("builds a document the strict check accepts and the theme renders without a report", async () => {
    const catalog = manifestCatalog(JSON.parse(JSON.stringify(themeManifest(theme00))));
    const must = (edit: ReturnType<typeof insertInstance>): PageData => {
      if (!edit.ok) throw new Error(`${edit.issue.code}: ${edit.issue.message}`);
      return edit.page;
    };
    let page = shippedHome as PageData;
    page = must(insertInstance(catalog, page, createInstance(catalog.components["image-banner"], "banner"), { index: 1 }));
    page = must(setInstanceProps(catalog, page, "banner", { image: { key: "products/3f2a9c.webp", alt: { ar: "فساتين", fr: "Robes", en: "Dresses" } } }));
    page = must(insertInstance(catalog, page, createInstance(catalog.components.faq, "faq", { questions: [{ id: "q1", props: { question: "COD?" } }] })));
    page = must(insertInstance(catalog, page, createInstance(catalog.components["featured-product"], "spotlight", { product: "robe-kabyle" })));
    page = must(setInstanceHidden(catalog, page, "cmp_h6feat", true));

    expect(checkPageData(catalog, page)).toEqual([]);
    expect(validatePageData(theme00, page, { content: en, locales: ["en"] }).issues).toEqual([]);

    const { html, issues } = await render(page.sections);
    expect(issues).toEqual([]);
    expect(html).toContain("products/3f2a9c.webp");
    expect(html).toContain("COD?");
    expect(html).toContain("Robe kabyle");
    // The hidden features bar is gone (its first title is also the marquee's first message).
    expect(html).not.toContain(en.feature1Sub);
  });
});
