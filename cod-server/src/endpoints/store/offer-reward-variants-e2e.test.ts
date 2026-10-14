/**
 * A product page's offers and their reward variants — real-D1 E2E.
 *
 * Each offer whose reward is a specific variant of another product needs that
 * variant's label on the page. The reward variants of all the product's offers
 * are read in ONE query, not one per offer: a product page is the most-read
 * page of the storefront, and its cost grows with every offer added to it.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import * as schema from "@/db/schema";
import type { AppDb } from "@/db";
import { getStoreProductByHandle } from "../../../../cod-shared/queries/store";

let harness: TestD1;
let db: AppDb;
let sqlLog: string[] = [];
const NOW = () => new Date().toISOString();
const STORE_ID = "store-offer-rewards";

function recordingD1(d1: D1Database): D1Database {
  return new Proxy(d1, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (prop === "prepare") {
        return (query: string) => {
          sqlLog.push(query);
          return (value as D1Database["prepare"]).call(target, query);
        };
      }
      return typeof value === "function" ? (value as Function).bind(target) : value;
    },
  }) as D1Database;
}

beforeAll(async () => {
  harness = await createTestD1();
  db = drizzle(recordingD1(harness.raw) as unknown as D1Database, { schema }) as unknown as AppDb;
}, 120_000);

afterAll(async () => {
  await harness?.dispose();
});

beforeEach(async () => {
  sqlLog = [];
  await harness.db.delete(schema.offers);
  await harness.db.delete(schema.productVariants);
  await harness.db.delete(schema.products);
  await harness.db.delete(schema.stores);
  await harness.db.insert(schema.stores).values({ id: STORE_ID, name: "Offers", lang: "en", createdAt: NOW(), updatedAt: NOW() });
});

async function product(id: string, opts: { hasVariants: boolean }) {
  await harness.db.insert(schema.products).values({
    id,
    name: `Product ${id}`,
    handle: `handle-${id}`,
    price: 1000,
    sku: `SKU-${id}`,
    status: "ACTIVE",
    visibility: true,
    showInStore: true,
    hasVariants: opts.hasVariants,
    trackInventory: false,
    createdAt: NOW(),
    updatedAt: NOW(),
  });
}

async function variant(id: string, productId: string, colour: string) {
  await harness.db.insert(schema.productVariants).values({
    id,
    productId,
    variations: JSON.stringify({ colour }),
    currency: "DZD",
    price: 1000,
    sku: `SKU-${id}`,
    inventory: 10,
    isDefault: false,
    active: true,
    position: 1,
    createdAt: NOW(),
    updatedAt: NOW(),
  });
}

async function offer(id: string, trigger: string, reward: string, rewardVariantId: string) {
  await harness.db.insert(schema.offers).values({
    id,
    name: `Offer ${id}`,
    triggerProductId: trigger,
    triggerQuantity: 2,
    rewardProductId: reward,
    rewardVariantId,
    rewardQuantity: 1,
    discountType: "free",
    status: "active",
    createdAt: NOW(),
    updatedAt: NOW(),
  });
}

// The reward lookups select the few columns a reward needs; the page's own
// variant list selects every column, so it is not counted here.
const variantReads = () =>
  sqlLog.filter((q) => /^\s*select "id", "product_id", "variations"(, "price")? from "product_variants"/i.test(q));

describe("a product page's offer reward variants", () => {
  it("labels each offer's reward variant, from one read for all of them", async () => {
    await product("trigger", { hasVariants: false });
    await product("gift-a", { hasVariants: true });
    await product("gift-b", { hasVariants: true });
    await variant("gift-a-red", "gift-a", "Red");
    await variant("gift-b-blue", "gift-b", "Blue");
    await offer("offer-a", "trigger", "gift-a", "gift-a-red");
    await offer("offer-b", "trigger", "gift-b", "gift-b-blue");

    sqlLog = [];
    const page = await getStoreProductByHandle(db, "handle-trigger");

    const labels = Object.fromEntries(page!.offers.map((o) => [o.id, o.rewardVariantLabel]));
    expect(labels).toEqual({ "offer-a": "Red", "offer-b": "Blue" });
    expect(variantReads()).toHaveLength(1);
  });

  it("says what each gift is worth: the gift variant's price, or the gift product's", async () => {
    await product("trigger", { hasVariants: false });
    await product("gift-a", { hasVariants: true });
    await product("gift-b", { hasVariants: false });
    await variant("gift-a-red", "gift-a", "Red");
    await harness.db.update(schema.productVariants).set({ price: 650 }).where(eq(schema.productVariants.id, "gift-a-red")).run();
    await harness.db.update(schema.products).set({ price: 400 }).where(eq(schema.products.id, "gift-b")).run();
    await offer("offer-a", "trigger", "gift-a", "gift-a-red");
    await harness.db.insert(schema.offers).values({
      id: "offer-b",
      name: "Gift B",
      triggerProductId: "trigger",
      triggerQuantity: 2,
      rewardProductId: "gift-b",
      rewardVariantId: null,
      rewardQuantity: 1,
      discountType: "free",
      status: "active",
      createdAt: NOW(),
      updatedAt: NOW(),
    });

    const page = await getStoreProductByHandle(db, "handle-trigger");

    const worth = Object.fromEntries(page!.offers.map((o) => [o.id, o.rewardUnitPrice]));
    expect(worth).toEqual({ "offer-a": 650, "offer-b": 400 });
  });

  it("answers no label for an offer whose reward has no variant", async () => {
    await product("trigger", { hasVariants: false });
    await product("gift", { hasVariants: false });
    await harness.db.insert(schema.offers).values({
      id: "offer-plain",
      name: "Plain",
      triggerProductId: "trigger",
      triggerQuantity: 2,
      rewardProductId: "gift",
      rewardVariantId: null,
      rewardQuantity: 1,
      discountType: "free",
      status: "active",
      createdAt: NOW(),
      updatedAt: NOW(),
    });

    const page = await getStoreProductByHandle(db, "handle-trigger");

    expect(page!.offers[0]!.rewardVariantLabel).toBeNull();
    expect(variantReads()).toHaveLength(0);
  });
});
