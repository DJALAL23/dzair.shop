/**
 * The product page-data bridge — ONE definition of the SSR→browser contract.
 *
 * Product surfaces render server-computed values into a hidden element
 * (`#page-data`) and the browser scripts read them back. Before this module
 * that contract existed three times: twice as hand-written attribute lists
 * (`product-page/ProductMain.astro` and `lp/[slug].astro`, kept in sync by
 * discipline) and once as a set of `dataset.*` reads with `!` assertions in
 * `product.ts`. Adding an attribute was a three-file change; missing one of
 * the writers failed silently at runtime.
 *
 * Now the writer calls `buildProductPageData` and the reader calls
 * `readProductPageData`; the attribute names exist only here
 * (`product-zero.test.ts` pins that). The bridge carries what the scripts
 * *use* — the nine attributes nobody read were dropped rather than
 * perpetuated.
 *
 * Trust: this is our own server-rendered markup, not user input, so the reader
 * parses tolerantly (malformed JSON degrades to empty collections) without
 * pulling a schema runtime into the browser bundle. Nothing here is money-
 * bearing: the server re-prices every order.
 *
 * Label fields are `string | null`: a missing label means the markup did not
 * carry it, and the UI keeps its server-rendered text instead of inventing a
 * fallback in a language the shopper may not read.
 */
import { messageData } from "../content/messages";
import type { ProductDetail } from "@wocart/storefront";
import type { PageDataCopy } from "./island-props";

/** The hidden element the product surfaces render the bridge into. */
export const PRODUCT_PAGE_DATA_ID = "page-data";

/** The variant fields the scripts use (a subset of the SDK's `ProductVariant`), in the merchant's order. */
export interface ProductPageVariant {
  id: string;
  price: number;
  compareAtPrice: number | null;
  inventory: number;
  variations: Record<string, string>;
  isDefault: boolean;
  imageId: string | null;
}

/** An option the buttons choose a value of, as the product names it. */
export interface ProductPageOption {
  name: string;
  values: { value: string }[];
}

/** The offer fields the scripts use (a subset of the SDK's `Offer`). */
export interface ProductPageOffer {
  id: string;
  discountType: "free" | "free_shipping";
  triggerQuantity: number;
  triggerVariantId: string | null;
  rewardQuantity: number;
  rewardProductName: string;
  rewardVariantLabel: string | null;
  /** What one gift unit is worth; null: the product's own price stands in. */
  rewardUnitPrice: number | null;
}

/** What `readProductPageData` returns — the scripts' whole view of the page. */
export interface ProductPageData {
  productId: string;
  productName: string;
  currencySymbol: string;
  isRTL: boolean;
  basePrice: number;
  trackInventory: boolean;
  inventory: number;
  variants: ProductPageVariant[];
  variantOptions: ProductPageOption[];
  offers: ProductPageOffer[];
  /** Priced by quantity tiers: only the server's quote says what a quantity costs. */
  quantityPriced: boolean;
  phoneInvalid: string | null;
  outOfStock: string | null;
  qtyMaxStock: string | null;
  shippingCalculated: string | null;
  shippingFree: string | null;
  shippingUnavailable: string | null;
  communePlaceholder: string | null;
  communeLoading: string | null;
  communeDisabled: string | null;
}

export interface ProductPageDataInput {
  product: Pick<
    ProductDetail,
    "id" | "name" | "trackInventory" | "inventory" | "variants" | "variantOptions" | "offers" | "quantityPricing"
  >;
  currencySymbol: string;
  isRTL: boolean;
  basePrice: number;
  copy: PageDataCopy;
}

/**
 * The writer: the `data-*` attributes for the bridge element, spread into it:
 *
 * ```astro
 * <div id={PRODUCT_PAGE_DATA_ID} class="sr-only" {...buildProductPageData({ … })} />
 * ```
 */
export function buildProductPageData(input: ProductPageDataInput): Record<string, string> {
  const { product, currencySymbol, isRTL, basePrice, copy } = input;

  return {
    "data-product-id": product.id,
    "data-product-name": product.name,
    "data-cur": currencySymbol,
    "data-is-rtl": isRTL ? "1" : "0",
    "data-base-price": String(basePrice),
    "data-track-inventory": product.trackInventory ? "1" : "0",
    "data-inventory": String(product.inventory),
    "data-variants": JSON.stringify(product.variants),
    "data-variant-options": JSON.stringify((product.variantOptions ?? []).map((option) => ({ name: option.name, values: option.values.map(({ value }) => ({ value })) }))),
    "data-offers": JSON.stringify(product.offers),
    "data-quantity-priced": product.quantityPricing ? "1" : "0",
    "data-phone-invalid": copy.formPhoneInvalid,
    "data-out-of-stock-label": copy.outOfStock,
    "data-qty-max-stock": messageData(copy, "qtyMaxStock"),
    "data-shipping-calc": copy.shippingCalculated,
    "data-shipping-free": copy.shippingFree,
    "data-shipping-unavailable": copy.shippingUnavailable,
    "data-commune-placeholder": copy.formCommunePlaceholder,
    "data-commune-loading": copy.formCommuneLoading,
    "data-commune-disabled": copy.formCommuneDisabled,
  };
}

/**
 * The reader: the bridge as a typed object, or `null` when the page carries no
 * bridge (listings, the cart page, 404s). Malformed JSON degrades to empty
 * collections, a missing label stays `null`, and a missing number falls back
 * instead of leaking `NaN` into the UI.
 */
export function readProductPageData(root: ParentNode = document): ProductPageData | null {
  const el = root.querySelector<HTMLElement>(`#${PRODUCT_PAGE_DATA_ID}`);
  if (!el) return null;
  const d = el.dataset;

  return {
    productId: d.productId ?? "",
    productName: d.productName ?? "",
    currencySymbol: d.cur ?? "",
    isRTL: d.isRtl === "1",
    basePrice: finiteNumber(d.basePrice) ?? 0,
    trackInventory: d.trackInventory === "1",
    inventory: finiteNumber(d.inventory) ?? 0,
    variants: toVariants(parseJsonArray(d.variants)),
    variantOptions: toOptions(parseJsonArray(d.variantOptions)),
    offers: toOffers(parseJsonArray(d.offers)),
    quantityPriced: d.quantityPriced === "1",
    phoneInvalid: d.phoneInvalid ?? null,
    outOfStock: d.outOfStockLabel ?? null,
    qtyMaxStock: d.qtyMaxStock ?? null,
    shippingCalculated: d.shippingCalc ?? null,
    shippingFree: d.shippingFree ?? null,
    shippingUnavailable: d.shippingUnavailable ?? null,
    communePlaceholder: d.communePlaceholder ?? null,
    communeLoading: d.communeLoading ?? null,
    communeDisabled: d.communeDisabled ?? null,
  };
}

function finiteNumber(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function parseJsonArray(raw: string | undefined): unknown[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function stringRecord(raw: unknown): Record<string, string> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

function toVariants(rows: unknown[]): ProductPageVariant[] {
  const out: ProductPageVariant[] = [];
  for (const row of rows) {
    if (typeof row !== "object" || row === null) continue;
    const r = row as Record<string, unknown>;
    if (typeof r.id !== "string") continue;
    out.push({
      id: r.id,
      price: finiteNumber(r.price) ?? 0,
      compareAtPrice: finiteNumber(r.compareAtPrice),
      inventory: finiteNumber(r.inventory) ?? 0,
      variations: stringRecord(r.variations),
      isDefault: r.isDefault === true,
      imageId: typeof r.imageId === "string" ? r.imageId : null,
    });
  }
  return out;
}

function toOptions(rows: unknown[]): ProductPageOption[] {
  const out: ProductPageOption[] = [];
  for (const row of rows) {
    if (typeof row !== "object" || row === null) continue;
    const r = row as Record<string, unknown>;
    if (typeof r.name !== "string" || !Array.isArray(r.values)) continue;
    const values = r.values.flatMap((entry: unknown) =>
      typeof entry === "object" && entry !== null && typeof (entry as Record<string, unknown>).value === "string" ? [{ value: (entry as { value: string }).value }] : [],
    );
    out.push({ name: r.name, values });
  }
  return out;
}

function toOffers(rows: unknown[]): ProductPageOffer[] {
  const out: ProductPageOffer[] = [];
  for (const row of rows) {
    if (typeof row !== "object" || row === null) continue;
    const r = row as Record<string, unknown>;
    if (typeof r.id !== "string") continue;
    out.push({
      id: r.id,
      discountType: r.discountType === "free_shipping" ? "free_shipping" : "free",
      triggerQuantity: finiteNumber(r.triggerQuantity) ?? 1,
      triggerVariantId: typeof r.triggerVariantId === "string" ? r.triggerVariantId : null,
      rewardQuantity: finiteNumber(r.rewardQuantity) ?? 1,
      rewardProductName: typeof r.rewardProductName === "string" ? r.rewardProductName : "",
      rewardVariantLabel: typeof r.rewardVariantLabel === "string" ? r.rewardVariantLabel : null,
      rewardUnitPrice: finiteNumber(r.rewardUnitPrice),
    });
  }
  return out;
}
