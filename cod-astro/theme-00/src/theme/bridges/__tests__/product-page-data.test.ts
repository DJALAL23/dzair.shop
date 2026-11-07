/**
 * The bridge writer and reader are ONE contract — these tests cross it.
 *
 * The value of the module is the round trip: whatever
 * `buildProductPageData` writes, `readProductPageData` must read back with the
 * same meaning; and a page without the bridge, or with malformed values, must
 * degrade instead of throwing or inventing copy.
 */
import { describe, expect, it } from "vitest";
import { ProductSchema, type ProductDetail } from "@wocart/storefront";
import { ar } from "../../content/ar";
import { pageDataCopy } from "../island-props";
import {
  PRODUCT_PAGE_DATA_ID,
  buildProductPageData,
  readProductPageData,
} from "../product-page-data";

const NOW = "2026-01-01T00:00:00.000Z";

function product(overrides: Partial<ProductDetail> = {}): ProductDetail {
  return ProductSchema.parse({
    id: "prod_1",
    name: "Casque Bluetooth",
    description: null,
    descriptionFormat: "text",
    descriptionPlain: null,
    handle: "casque-bluetooth",
    currency: "DZD",
    price: 4500,
    compareAtPrice: null,
    type: "PHYSICAL",
    hasVariants: true,
    sku: null,
    inventory: 7,
    trackInventory: true,
    lowStockThreshold: 5,
    categoryId: null,
    variantOptions: null,
    tags: [],
    metaTitle: null,
    metaDescription: null,
    category: null,
    variants: [
      {
        id: "var_1",
        variations: { Color: "Red" },
        price: 4000,
        compareAtPrice: null,
        sku: null,
        inventory: 7,
        lowStockThreshold: 5,
        imageId: null,
        isDefault: true,
      },
    ],
    images: [],
    reviewStats: null,
    quantityPricing: null,
    offers: [
      {
        id: "off_1",
        name: "Buy 2 get 1",
        discountType: "free",
        triggerQuantity: 2,
        triggerVariantId: null,
        rewardQuantity: 1,
        rewardProductId: null,
        rewardProductName: "Cadeau",
        rewardVariantId: null,
        rewardVariantLabel: null,
        rewardUnitPrice: null,
      },
    ],
    ...overrides,
  });
}

function mount(attrs: Record<string, string>): void {
  document.body.innerHTML = "";
  const el = document.createElement("div");
  el.id = PRODUCT_PAGE_DATA_ID;
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  document.body.appendChild(el);
}

const build = (overrides: Partial<ProductDetail> = {}) =>
  buildProductPageData({
    product: product(overrides),
    currencySymbol: "دج",
    isRTL: true,
    basePrice: 4000,
    copy: pageDataCopy(ar),
  });

describe("product page-data bridge", () => {
  it("says whether the product is priced by quantity tiers", () => {
    mount(build({ quantityPricing: { offerId: "packs", name: "Packs", triggerVariantId: null, tiers: [{ quantity: 2, price: 3500, freeShipping: false }] } }));
    expect(readProductPageData()?.quantityPriced).toBe(true);
    document.body.innerHTML = "";
    mount(build({ quantityPricing: null }));
    expect(readProductPageData()?.quantityPriced).toBe(false);
  });

  it("round-trips what the writer writes", () => {
    mount(build());

    const data = readProductPageData();

    expect(data).not.toBeNull();
    expect(data?.productId).toBe("prod_1");
    expect(data?.productName).toBe("Casque Bluetooth");
    expect(data?.currencySymbol).toBe("دج");
    expect(data?.isRTL).toBe(true);
    expect(data?.basePrice).toBe(4000);
    expect(data?.trackInventory).toBe(true);
    expect(data?.inventory).toBe(7);
    expect(data?.variants).toHaveLength(1);
    expect(data?.variants[0]).toMatchObject({ id: "var_1", price: 4000, isDefault: true });
    expect(data?.offers).toHaveLength(1);
    expect(data?.offers[0]).toMatchObject({ id: "off_1", discountType: "free", triggerQuantity: 2 });
    // Labels come from the copy pick, verbatim.
    expect(data?.outOfStock).toBe(ar.outOfStock);
    expect(data?.phoneInvalid).toBe(ar.formPhoneInvalid);
    expect(data?.shippingCalculated).toBe(ar.shippingCalculated);
    expect(data?.communeDisabled).toBe(ar.formCommuneDisabled);
  });

  it("carries what the option buttons need: the variants in the merchant's order, and the options' values", () => {
    const [first] = product().variants;
    mount(
      build({
        variantOptions: [{ name: "Color", values: [{ value: "Red", hexColor: "#ff0000" }, { value: "Blue", hexColor: null }] }],
        variants: [{ ...first!, id: "var_2", variations: { Color: "Blue" }, isDefault: false }, first!],
      }),
    );
    const data = readProductPageData();
    expect(data?.variants.map(({ id, isDefault }) => ({ id, isDefault }))).toEqual([
      { id: "var_2", isDefault: false },
      { id: "var_1", isDefault: true },
    ]);
    expect(data?.variantOptions).toEqual([{ name: "Color", values: [{ value: "Red" }, { value: "Blue" }] }]);
    mount(build({ variantOptions: null }));
    expect(readProductPageData()?.variantOptions).toEqual([]);
  });

  it("returns null when the page carries no bridge", () => {
    document.body.innerHTML = "";

    expect(readProductPageData()).toBeNull();
  });

  it("degrades malformed collections instead of throwing", () => {
    mount({ "data-variants": "{not json", "data-offers": '{"not":"an array"}' });

    const data = readProductPageData();

    expect(data?.variants).toEqual([]);
    expect(data?.offers).toEqual([]);
  });

  it("a missing label stays null — the UI keeps its server-rendered text", () => {
    mount({ "data-product-id": "prod_1" });

    const data = readProductPageData();

    expect(data?.outOfStock).toBeNull();
    expect(data?.qtyMaxStock).toBeNull();
    expect(data?.phoneInvalid).toBeNull();
    expect(data?.shippingCalculated).toBeNull();
    expect(data?.communePlaceholder).toBeNull();
  });

  it("keeps the numeric and flag fallbacks the scripts relied on", () => {
    mount({ "data-product-id": "prod_1" });

    const data = readProductPageData();

    expect(data?.basePrice).toBe(0);
    expect(data?.inventory).toBe(0);
    expect(data?.trackInventory).toBe(false);
    expect(data?.isRTL).toBe(false);
  });

  it("drops variant rows without an id — a half-parsed row must not reach the picker", () => {
    mount({
      "data-variants": JSON.stringify([
        { id: "ok", price: 10, variations: { Size: "M" } },
        { price: 20 },
        "not-an-object",
      ]),
    });

    const data = readProductPageData();

    expect(data?.variants).toHaveLength(1);
    expect(data?.variants[0]).toMatchObject({ id: "ok", price: 10, variations: { Size: "M" } });
  });
});
