/**
 * A product as the storefront receives it, built through the SDK's own schema
 * so a fixture cannot drift from the catalog contract.
 */
import { ProductSchema, type ProductDetail } from "@wocart/storefront";

export function productFixture(overrides: Partial<ProductDetail> = {}): ProductDetail {
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
    costPrice: null,
    type: "PHYSICAL",
    hasVariants: false,
    sku: null,
    inventory: 10,
    trackInventory: true,
    lowStockThreshold: 5,
    categoryId: null,
    visibility: true,
    status: "ACTIVE",
    showInStore: true,
    storeFeatured: false,
    deletedAt: null,
    publishedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    variantOptions: null,
    tags: [],
    category: null,
    variants: [],
    images: [],
    reviewStats: null,
    offers: [],
    ...overrides,
  });
}
