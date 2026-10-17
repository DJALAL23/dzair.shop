/**
 * Paging the storefront catalog (`limit` + `offset`) visits every product
 * exactly once — the contract a sitemap relies on — including products created
 * in the same instant, which a creation-time order alone would shuffle.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import { getStoreProducts } from "../../../../cod-shared/queries/store";

let harness: TestD1;
const SAME_INSTANT = "2026-10-01T10:00:00.000Z";

beforeAll(async () => {
  harness = await createTestD1();
  // One row per insert: D1 caps a statement at 100 bound parameters.
  for (let i = 0; i < 7; i++) {
    await harness.db.insert(schema.products).values({
      id: `p-${String.fromCharCode(103 - i)}`,
      name: `Product ${i}`,
      handle: `product-${i}`,
      price: 1000,
      createdAt: i < 5 ? SAME_INSTANT : `2026-10-0${i}T10:00:00.000Z`,
      updatedAt: SAME_INSTANT,
    });
  }
}, 120_000);

afterAll(async () => {
  await harness?.dispose();
});

describe("paging the storefront catalog", () => {
  it.each([1, 2, 3, 7, 10])("with pages of %i, visits every product exactly once, in one stable order", async (size) => {
    const seen: string[] = [];
    for (let offset = 0; ; offset += size) {
      const page = await getStoreProducts(harness.db, { limit: size, offset });
      seen.push(...page.map((product) => product.id));
      if (page.length < size) break;
    }
    expect(seen).toHaveLength(7);
    expect(new Set(seen).size).toBe(7);
    const whole = (await getStoreProducts(harness.db, { limit: 100 })).map((product) => product.id);
    expect(seen).toEqual(whole);
  });

  it("pages a collection in the merchant's order, across pages", async () => {
    await harness.db.insert(schema.stores).values({ id: "s1", name: "S", createdAt: SAME_INSTANT, updatedAt: SAME_INSTANT });
    await harness.db.insert(schema.collections).values({ id: "c1", storeId: "s1", handle: "best-sellers", title: "Best", createdAt: SAME_INSTANT, updatedAt: SAME_INSTANT });
    const order = ["p-d", "p-a", "p-g", "p-b"];
    for (const [position, productId] of order.entries()) {
      await harness.db.insert(schema.collectionProducts).values({ collectionId: "c1", productId, position, addedAt: SAME_INSTANT });
    }
    const seen: string[] = [];
    for (let offset = 0; offset < 6; offset += 2) {
      seen.push(...(await getStoreProducts(harness.db, { collection: "best-sellers", limit: 2, offset })).map((product) => product.id));
    }
    expect(seen).toEqual(order);
    expect(await getStoreProducts(harness.db, { collection: "nope" })).toEqual([]);
  });
});
