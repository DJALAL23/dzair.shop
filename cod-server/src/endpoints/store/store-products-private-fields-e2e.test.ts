/**
 * What a merchant keeps to themselves never reaches a shopper: a product's
 * cost price is stored for the dashboard, and both storefront reads — the
 * list and the product page — answer it as null.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import { getStoreProductByHandle, getStoreProducts } from "../../../../cod-shared/queries/store";
import { TEST_DELIVERY } from "@/test-utils/media";

let harness: TestD1;
const NOW = "2026-10-01T10:00:00.000Z";

beforeAll(async () => {
  harness = await createTestD1();
  await harness.db.insert(schema.products).values({ id: "p-cost", name: "Romper", handle: "romper", price: 2400, costPrice: 900, createdAt: NOW, updatedAt: NOW });
}, 120_000);

afterAll(async () => {
  await harness?.dispose();
});

describe("a product's cost price", () => {
  it("is stored for the merchant", async () => {
    const [row] = await harness.db.select().from(schema.products);
    expect(row?.costPrice).toBe(900);
  });

  it("is never in the storefront's product list", async () => {
    const [product] = await getStoreProducts(harness.db, { limit: 10 }, null, TEST_DELIVERY);
    expect(product?.handle).toBe("romper");
    expect(product?.costPrice).toBeNull();
  });

  it("is never on the storefront's product page", async () => {
    const product = await getStoreProductByHandle(harness.db, "romper", { delivery: TEST_DELIVERY });
    expect(product?.price).toBe(2400);
    expect(product?.costPrice).toBeNull();
  });
});
