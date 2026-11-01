/**
 * SEO metadata — the rule that markup never reaches a meta description or
 * structured data. The product page reads the SDK's `productMeta` and
 * `productStructuredData`, which must:
 *   • prefer what the merchant wrote for search engines, then the platform's
 *     plain-text derivation (`descriptionPlain`),
 *   • fall back to the stored text for legacy `text` rows (plain by definition),
 *   • yield no description — never markup — for an `html` row without plain text.
 *
 * The third case is the one that matters: a missing `descriptionPlain` must
 * never cause sanitised HTML to be embedded in JSON-LD.
 */
/// <reference types="vitest/globals" />

import { ProductSchema, jsonLd, productMeta, productStructuredData, type ProductDetail } from "@wocart/storefront";
import { openGraphLocale } from "../seo";

const productMetaDescription = (p: ProductDetail) => productMeta(p).description ?? undefined;
const getProductJsonLd = (p: ProductDetail) => productStructuredData(p, { url: "https://shop.dz/products/casque-bluetooth", storeName: "Boutique" });

/** Built through the SDK's own schema, so the fixture cannot drift from the catalog contract. */
function product(overrides: Partial<ProductDetail> = {}): ProductDetail {
  return ProductSchema.parse({
    id: "prod_1",
    name: "Casque Bluetooth",
    description: "<p>Son <strong>excellent</strong></p>",
    descriptionFormat: "html",
    descriptionPlain: "Son excellent",
    handle: "casque-bluetooth",
    currency: "DZD",
    price: 4500,
    compareAtPrice: null,
    type: "PHYSICAL",
    hasVariants: false,
    sku: null,
    inventory: 10,
    trackInventory: true,
    lowStockThreshold: 5,
    categoryId: null,
    variantOptions: null,
    tags: [],
    metaTitle: null,
    metaDescription: null,
    category: null,
    variants: [],
    images: [],
    reviewStats: null,
    quantityPricing: null,
    offers: [],
    ...overrides,
  });
}

describe("the product's meta description", () => {
  it("prefers descriptionPlain for a rich description", () => {
    expect(productMetaDescription(product())).toBe("Son excellent");
  });

  it("never returns markup for a rich description", () => {
    const meta = productMetaDescription(product())!;
    expect(meta).not.toMatch(/[<>]/);
    expect(meta).not.toContain("strong");
  });

  it("returns undefined for an html row that has no plain text (never leaks markup)", () => {
    const p = product({ descriptionPlain: null });
    expect(productMetaDescription(p)).toBeUndefined();
    expect(JSON.stringify(getProductJsonLd(p))).not.toContain("<p>");
  });

  it("falls back to the stored text for a legacy text row", () => {
    const p = product({
      description: "Son excellent",
      descriptionFormat: "text",
      descriptionPlain: null,
    });
    expect(productMetaDescription(p)).toBe("Son excellent");
  });

  it("accepts a legacy row whose description contains a literal '<' (not markup)", () => {
    // Regression guard: legacy prose like "Size < 10cm" is text, not HTML.
    const p = product({
      description: "Size < 10cm",
      descriptionFormat: "text",
      descriptionPlain: null,
    });
    expect(productMetaDescription(p)).toBe("Size < 10cm");
    expect(productMetaDescription(p)).not.toContain("&lt;");
  });

  it("returns undefined when there is no description at all", () => {
    const p = product({ description: null, descriptionPlain: null, descriptionFormat: "text" });
    expect(productMetaDescription(p)).toBeUndefined();
  });

  it("treats an empty plain string as absent and falls back for text rows", () => {
    const p = product({ description: "Texte", descriptionFormat: "text", descriptionPlain: "" });
    expect(productMetaDescription(p)).toBe("Texte");
  });
});

describe("the product's structured data", () => {
  it("carries the plain description and no tags anywhere in the payload", () => {
    const p = product();
    const jsonLd = JSON.stringify(getProductJsonLd(p));
    expect(jsonLd).toContain("Son excellent");
    expect(jsonLd).not.toContain("<p>");
    expect(jsonLd).not.toContain("<strong>");
  });

  it("keeps the offer/availability contract intact", () => {
    const p = product({ trackInventory: true, inventory: 0 });
    const jsonLd = getProductJsonLd(p) as Record<string, any>;
    expect(jsonLd.name).toBe("Casque Bluetooth");
    expect(jsonLd.offers.availability).toBe("https://schema.org/OutOfStock");
    expect(jsonLd.offers.priceCurrency).toBe("DZD");
  });

  it("prefers what the merchant wrote for search engines", () => {
    const p = product({ metaTitle: "Casque sans fil", metaDescription: "Le casque des trajets." });
    expect(productMeta(p)).toEqual({ title: "Casque sans fil", description: "Le casque des trajets." });
  });

  it("can never end its script: a name holding </script> is escaped", () => {
    const text = jsonLd(getProductJsonLd(product({ name: "Casque </script><script>alert(1)</script>" })));
    expect(text).not.toContain("</script>");
    expect(JSON.parse(text).name).toBe("Casque </script><script>alert(1)</script>");
  });

  it("omits description entirely (JSON.stringify drops undefined) when unavailable", () => {
    const p = product({ descriptionPlain: null });
    const jsonLd = JSON.stringify(getProductJsonLd(p));
    expect(jsonLd).not.toContain("\"description\"");
  });
});

describe("openGraphLocale", () => {
  it("advertises the territory this theme's shoppers are in", () => {
    expect(openGraphLocale("ar")).toBe("ar_DZ");
    expect(openGraphLocale("fr")).toBe("fr_DZ");
    expect(openGraphLocale("en")).toBe("en_US");
  });

  it("keeps any other language's own tag, never a prototype member", () => {
    expect(openGraphLocale("zgh")).toBe("zgh");
    expect(openGraphLocale("pt-BR")).toBe("pt_BR");
    expect(openGraphLocale("constructor")).toBe("constructor");
  });
});
