/**
 * A storefront reads a product field by field: what the merchant keeps to
 * themselves — what they paid, the shipping profile, the listing gates —
 * never reaches a shopper, in the list or on the product page.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import { getStoreProductByHandle, getStoreProducts } from "../../../../cod-shared/queries/store";
import { TEST_DELIVERY } from "@/test-utils/media";

let harness: TestD1;
const NOW = "2026-10-01T10:00:00.000Z";

const PRODUCT_FIELDS = [
  "categoryId",
  "compareAtPrice",
  "currency",
  "description",
  "descriptionFormat",
  "descriptionPlain",
  "handle",
  "hasVariants",
  "id",
  "inventory",
  "lowStockThreshold",
  "metaDescription",
  "metaTitle",
  "name",
  "price",
  "sku",
  "tags",
  "trackInventory",
  "type",
  "variantOptions",
];

beforeAll(async () => {
  harness = await createTestD1();
  await harness.db.insert(schema.products).values({ id: "p-cost", name: "Romper", handle: "romper", price: 2400, costPrice: 900, tags: '["bébé"]', createdAt: NOW, updatedAt: NOW });
}, 120_000);

afterAll(async () => {
  await harness?.dispose();
});

describe("a storefront product", () => {
  it("keeps the cost price stored for the merchant", async () => {
    const [row] = await harness.db.select().from(schema.products);
    expect(row?.costPrice).toBe(900);
  });

  it("is listed with exactly its public fields, its tags parsed", async () => {
    const [product] = await getStoreProducts(harness.db, { limit: 10 }, null, TEST_DELIVERY);
    expect(Object.keys(product!).sort()).toEqual([...PRODUCT_FIELDS, "coverImage", "reviewStats"].sort());
    expect(product?.tags).toEqual(["bébé"]);
  });

  it("has exactly its public fields on its page", async () => {
    const product = await getStoreProductByHandle(harness.db, "romper", { delivery: TEST_DELIVERY });
    expect(Object.keys(product!).sort()).toEqual([...PRODUCT_FIELDS, "category", "images", "offers", "quantityPricing", "reviewStats", "variants"].sort());
    expect(JSON.stringify(product)).not.toContain("900");
  });
});
