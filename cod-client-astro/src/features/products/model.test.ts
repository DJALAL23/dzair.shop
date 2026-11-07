import { describe, expect, it } from "vitest";
import {
  apiVariantOptions,
  calcMargin,
  filterProducts,
  generateCombinations,
  filterStockItems,
  formatStockDate,
  groupStockByProduct,
  movementIsStockIn,
  paginateProducts,
  parseProductRoute,
  productErrorMessage,
  productRemovalConsequences,
  sortProducts,
  sortStockItems,
  stockAlertTone,
  stockGroupInventory,
  stockGroupUpdatedAt,
  toSlug,
  variantLabel,
  searchListing,
} from "./model";
import type { Product, StockAlertItem } from "./types";

const product = (overrides: Partial<Product> = {}): Product => ({
  id: "prod-1",
  name: "Cotton T-Shirt",
  description: "Soft cotton",
  handle: "cotton-t-shirt-prod1",
  currency: "DZD",
  price: 1500,
  compareAtPrice: null,
  costPrice: null,
  type: "PHYSICAL",
  hasVariants: false,
  variantOptions: null,
  sku: "TS-001",
  inventory: 10,
  lowStockThreshold: 5,
  trackInventory: true,
  categoryId: "cat-1",
  shippingProfileId: null,
  tags: [],
  visibility: true,
  status: "ACTIVE",
  showInStore: true,
  publishedAt: null,
  category: null,
  variants: [],
  images: [],
  variantsCount: 0,
  totalInventory: 10,
  primaryImage: null,
  reviewCount: 0,
  avgRating: null,
  createdAt: "2026-08-26T00:00:00.000Z",
  updatedAt: "2026-08-26T00:00:00.000Z",
  ...overrides,
});

const alert = (overrides: Partial<StockAlertItem> = {}): StockAlertItem => ({
  productId: "prod-1",
  variantId: null,
  productName: "T-Shirt",
  variantLabel: null,
  sku: "TS-001",
  inventory: 0,
  lowStockThreshold: 5,
  isOutOfStock: true,
  updatedAt: "2026-01-10T00:00:00.000Z",
  ...overrides,
});

const t = (key: string) => key;

describe("products model", () => {
  it("filters by query, category, and status", () => {
    const rows = [product(), product({ id: "2", name: "Jeans", handle: "jeans-2", categoryId: "cat-2", status: "DRAFT" })];
    expect(filterProducts(rows, { query: "t-shirt", category: "all", status: "all" }).map((item) => item.id)).toEqual(["prod-1"]);
    expect(filterProducts(rows, { query: "", category: "cat-2", status: "all" }).map((item) => item.id)).toEqual(["2"]);
    expect(filterProducts(rows, { query: "", category: "all", status: "DRAFT" }).map((item) => item.id)).toEqual(["2"]);
  });

  it("sorts and paginates product collections", () => {
    const rows = [product({ id: "1", name: "Zed", price: 500 }), product({ id: "2", name: "Amel", price: 3000 }), product({ id: "3", name: "Meriem", price: 1000 })];
    expect(sortProducts(rows, "name", "asc").map((item) => item.id)).toEqual(["2", "3", "1"]);
    expect(sortProducts(rows, "price", "desc").map((item) => item.id)).toEqual(["2", "3", "1"]);
    expect(paginateProducts(rows, 2, 2).map((item) => item.id)).toEqual(["3"]);
  });

  it("parses only valid product routes", () => {
    expect(parseProductRoute("/products")).toEqual({ kind: "list" });
    expect(parseProductRoute("/products/new/")).toEqual({ kind: "new" });
    expect(parseProductRoute("/products/stock")).toEqual({ kind: "stock" });
    expect(parseProductRoute("/products/prod%2F1")).toEqual({ kind: "detail", id: "prod/1" });
    expect(parseProductRoute("/products/prod-1/edit")).toEqual({ kind: "edit", id: "prod-1" });
    expect(parseProductRoute("/products/new/edit")).toEqual({ kind: "unknown" });
    expect(parseProductRoute("/products/stock/edit")).toEqual({ kind: "unknown" });
  });

  it("generates variant combinations from options", () => {
    expect(generateCombinations([])).toEqual([]);
    const combos = generateCombinations([
      { id: "o1", name: "Color", values: [{ id: "v1", value: "Red", hexColor: "" }, { id: "v2", value: "Blue", hexColor: "" }] },
      { id: "o2", name: "Size", values: [{ id: "v3", value: "M", hexColor: "" }] },
    ]);
    expect(combos).toHaveLength(2);
    expect(combos[0].variations).toEqual({ Color: "Red", Size: "M" });
    expect(variantLabel(combos[0].variations)).toBe("Red / M");
  });

  it("maps business error codes, slugs, and margin", () => {
    expect(productErrorMessage({ code: "PRODUCT_NOT_FOUND" }, t)).toBe("error_not_found");
    expect(productErrorMessage({ code: "DUPLICATE_SKU" }, t)).toBe("error_duplicate_sku");
    expect(productErrorMessage(new Error("boom"), t)).toBe("error_generic");
    expect(toSlug("Cotton T-Shirt!")).toBe("cotton-t-shirt");
    expect(calcMargin("2000", "1200")).toBe(40);
    expect(calcMargin("1000", "2000")).toBeNull();
  });

  it("searches stock rows by product name, variant label and sku", () => {
    const rows = [
      alert({ productId: "p-1", productName: "Cotton T-Shirt", sku: "TS-001" }),
      alert({ productId: "p-2", productName: "Hoodie", variantId: "v-1", variantLabel: "Red / M", sku: "HD-RED-M" }),
      alert({ productId: "p-3", productName: "Cap", sku: null }),
    ];
    expect(filterStockItems(rows, "").length).toBe(3);
    expect(filterStockItems(rows, "   ").length).toBe(3);
    expect(filterStockItems(rows, "hoodie").map((item) => item.productId)).toEqual(["p-2"]);
    expect(filterStockItems(rows, "red / m").map((item) => item.productId)).toEqual(["p-2"]);
    expect(filterStockItems(rows, "ts-001").map((item) => item.productId)).toEqual(["p-1"]);
    expect(filterStockItems(rows, "TS-001").map((item) => item.productId)).toEqual(["p-1"]);
    expect(filterStockItems(rows, "cap").map((item) => item.productId)).toEqual(["p-3"]);
    expect(filterStockItems(rows, "nothing")).toEqual([]);
  });

  it("sorts stock rows by quantity, name and last update in both directions", () => {
    const rows = [
      alert({ productId: "b", productName: "Banana", inventory: 7, updatedAt: "2026-02-01T00:00:00.000Z" }),
      alert({ productId: "a", productName: "Apple", inventory: 2, updatedAt: "2026-03-01T00:00:00.000Z" }),
      alert({ productId: "c", productName: "Cherry", inventory: 40, updatedAt: "2026-01-01T00:00:00.000Z" }),
    ];
    expect(sortStockItems(rows, "inventory", "asc").map((item) => item.inventory)).toEqual([2, 7, 40]);
    expect(sortStockItems(rows, "inventory", "desc").map((item) => item.inventory)).toEqual([40, 7, 2]);
    expect(sortStockItems(rows, "name", "asc").map((item) => item.productId)).toEqual(["a", "b", "c"]);
    expect(sortStockItems(rows, "updatedAt", "desc").map((item) => item.productId)).toEqual(["a", "b", "c"]);
    expect(rows.map((item) => item.productId)).toEqual(["b", "a", "c"]);
  });

  it("formats a stock row date and rejects unusable values", () => {
    expect(formatStockDate("2026-08-26T00:00:00.000Z", "en")).toBe("Aug 26, 2026");
    expect(formatStockDate("", "en")).toBeNull();
    expect(formatStockDate("not-a-date", "en")).toBeNull();
  });
});

import { optionalDescription, optionalId, optionalMoney } from "./model";

describe("product update payload: a cleared field is sent as null", () => {
  it("sends null for an emptied money field when editing, so the server clears it", () => {
    expect(optionalMoney("", true)).toBeNull();
    expect(optionalMoney("   ", true)).toBeNull();
  });

  it("leaves an empty money field out when creating", () => {
    expect(optionalMoney("", false)).toBeUndefined();
  });

  it("rounds a filled money field in both modes", () => {
    expect(optionalMoney("7000", true)).toBe(7000);
    expect(optionalMoney("7000.6", false)).toBe(7001);
  });

  it("keeps a zero cost: zero is a value, not an empty field", () => {
    expect(optionalMoney("0", true)).toBe(0);
  });

  it("clears an unset id (product group, shipping profile) with null when editing only", () => {
    expect(optionalId("", true)).toBeNull();
    expect(optionalId("", false)).toBeUndefined();
    expect(optionalId("grp_1", true)).toBe("grp_1");
  });

  it("treats an empty editor's markup as no description", () => {
    expect(optionalDescription("<p></p>", true)).toBe("");
    expect(optionalDescription("<p><br></p>", true)).toBe("");
    expect(optionalDescription("<p>&nbsp;</p>", false)).toBeUndefined();
    expect(optionalDescription("", true)).toBe("");
    expect(optionalDescription("", false)).toBeUndefined();
  });

  it("never discards a description that holds content, even only an image", () => {
    expect(optionalDescription("<p>Hello</p>", true)).toBe("<p>Hello</p>");
    expect(optionalDescription('<p><img src="a.jpg"></p>', true)).toBe('<p><img src="a.jpg"></p>');
  });
});

describe("what removing a product does, in words", () => {
  const t = (key: string, values?: Record<string, unknown>) => (values ? `${key}:${values.count}` : key);
  const none = { id: "p", name: "Robe", variants: 0, images: 0, reviews: 0, offers: 0, landingPages: 0, landingPageOrders: 0, orderLines: 0, ordersToShip: 0 };

  it("says only what applies: a product nothing else uses goes alone", () => {
    expect(productRemovalConsequences(none, t)).toEqual([{ text: "removal.product" }]);
  });

  it("lists what goes, what stays and what to watch, in that order", () => {
    expect(productRemovalConsequences({ ...none, variants: 2, images: 3, reviews: 1, offers: 1, landingPages: 1, landingPageOrders: 4, orderLines: 5, ordersToShip: 2 }, t)).toEqual([
      { text: "removal.product" },
      { text: "removal.variants:2" },
      { text: "removal.images:3" },
      { text: "removal.reviews:1" },
      { text: "removal.offers:1" },
      { text: "removal.landing_pages:1" },
      { text: "removal.order_lines_kept:5", kept: true },
      { text: "removal.landing_orders_kept:4", kept: true },
      { text: "removal.orders_to_ship:2", warning: true },
    ]);
  });
});

describe("searchListing", () => {
  const product = { metaTitle: "", metaDescription: "", name: "Robe en coton", description: "<p>Une robe <strong>légère</strong>&nbsp;pour l'été.</p>" };

  it("shows what the merchant wrote for search engines", () => {
    expect(searchListing({ ...product, metaTitle: " Robe d'été ", metaDescription: " Livraison partout " })).toEqual({ title: "Robe d'été", description: "Livraison partout" });
  });

  it("falls back to the name and the description as text", () => {
    expect(searchListing(product)).toEqual({ title: "Robe en coton", description: "Une robe légère pour l'été." });
  });

  it("shortens a long description at a word, within what a search result shows", () => {
    const listing = searchListing({ ...product, description: `<p>${"cotons ".repeat(40)}</p>` });
    expect(listing.description.length).toBeLessThanOrEqual(160);
    expect(listing.description.endsWith(" cotons…")).toBe(true);
  });
});
