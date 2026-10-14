/**
 * The delivery quote — real-D1 E2E.
 *
 * POST /store/cart/validate with a `destination` answers what the basket costs
 * delivered there: the fee and the total. It is worth something only if it is
 * the number the order then charges, so each case asks the cart for its quote
 * and then places the same order through POST /store/orders, and the two must
 * agree — across the store default rate, stop-desk delivery, a commune
 * override, a basket spanning two profiles, the free-delivery threshold, a
 * free-shipping offer, and a destination the store does not serve.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { OpenAPIHono } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import type { AppContext } from "@/types";
import { errorHandler } from "@/middleware/error";
import { openApiValidationHook } from "@/openapi/validation-hook";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import * as schema from "@/db/schema";
import storeRouter from "./routes";

let harness: TestD1;
let app: OpenAPIHono<AppContext>;
const NOW = () => new Date().toISOString();
const STORE_ID = "store-delivery-quote";
const WILAYA = 16;
// Real communes from the migrations — orders.commune_id is a foreign key.
const COMMUNE = "c-16-001";
const OTHER_COMMUNE = "c-16-002";
const UNSERVED = { wilayaId: 31, communeId: "c-31-001" };
let seq = 0;
const uid = (p: string) => `${p}-${++seq}`;

beforeAll(async () => {
  harness = await createTestD1();
  app = new OpenAPIHono<AppContext>({ defaultHook: openApiValidationHook });
  app.use("*", async (c, next) => {
    c.env = { DB: harness.raw } as never;
    c.set("storeId", STORE_ID);
    await next();
  });
  app.onError(errorHandler);
  app.route("/store", storeRouter);
}, 120_000);

afterAll(async () => {
  await harness?.dispose();
});

beforeEach(async () => {
  await harness.db.delete(schema.orderProducts);
  await harness.db.delete(schema.orderStatusHistory);
  await harness.db.delete(schema.stockMovements);
  await harness.db.delete(schema.orders);
  await harness.db.delete(schema.customers);
  await harness.db.delete(schema.offers);
  await harness.db.delete(schema.products);
  await harness.db.delete(schema.shippingRuleCommunes);
  await harness.db.delete(schema.shippingRules);
  await harness.db.delete(schema.shippingProfiles);
  await harness.db.delete(schema.stores);
  await harness.db.insert(schema.stores).values({
    id: STORE_ID,
    name: "Quote Store",
    lang: "en",
    createdAt: NOW(),
    updatedAt: NOW(),
  });
});

async function seedProfile(isDefault: boolean, homePrice: number, stopDeskPrice: number) {
  const profileId = uid("prof");
  const ruleId = uid("rule");
  await harness.db.insert(schema.shippingProfiles).values({
    id: profileId,
    name: profileId,
    isDefault,
    createdAt: NOW(),
    updatedAt: NOW(),
  });
  await harness.db.insert(schema.shippingRules).values({
    id: ruleId,
    profileId,
    wilayaId: WILAYA,
    homePrice,
    stopDeskPrice,
    homeEnabled: true,
    stopDeskEnabled: true,
    createdAt: NOW(),
  });
  return { profileId, ruleId };
}

async function seedProduct(price: number, shippingProfileId: string | null = null) {
  const id = uid("prod");
  await harness.db.insert(schema.products).values({
    id,
    name: `Product ${id}`,
    handle: `handle-${id}`,
    price,
    sku: `SKU-${id}`,
    status: "ACTIVE",
    trackInventory: false,
    shippingProfileId,
    createdAt: NOW(),
    updatedAt: NOW(),
  });
  return id;
}

type Line = { productId: string; quantity: number };
type Destination = { wilayaId: number; communeId?: string; deliveryType: "home" | "stop_desk" };

const asItems = (lines: Line[]) => lines.map((l) => ({ ...l, productName: "Product" }));

async function quote(lines: Line[], destination?: Destination) {
  const items = asItems(lines);
  const res = await app.request("/store/cart/validate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(destination ? { items, destination } : { items }),
  });
  return { status: res.status, json: (await res.json()) as any };
}

async function order(lines: Line[], destination: Destination) {
  const res = await app.request("/store/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      customerName: "Ahmed Benali",
      phone: "0551234567",
      wilayaId: destination.wilayaId,
      communeId: destination.communeId ?? COMMUNE,
      deliveryType: destination.deliveryType,
      items: asItems(lines),
    }),
  });
  return { status: res.status, json: (await res.json()) as any };
}

/** The quote, then the order it describes: both name the same fee and total. */
async function expectQuoteIsCharged(lines: Line[], destination: Destination, fee: number) {
  const quoted = await quote(lines, destination);
  expect(quoted.status).toBe(200);
  expect(quoted.json.data.delivery).toEqual({
    available: true,
    fee,
    total: quoted.json.data.subtotal + fee,
  });

  const placed = await order(lines, destination);
  expect(placed.status).toBe(201);
  expect(placed.json.data.deliveryFee).toBe(fee);
  expect(placed.json.data.total).toBe(quoted.json.data.delivery.total);
}

const HOME: Destination = { wilayaId: WILAYA, communeId: COMMUNE, deliveryType: "home" };

describe("POST /store/cart/validate — the delivery quote is what the order charges", () => {
  it("at the store's default rate", async () => {
    await seedProfile(true, 600, 300);
    const p = await seedProduct(2500);

    await expectQuoteIsCharged([{ productId: p, quantity: 2 }], HOME, 600);
  });

  it("for stop-desk delivery", async () => {
    await seedProfile(true, 600, 300);
    const p = await seedProduct(2500);

    await expectQuoteIsCharged([{ productId: p, quantity: 1 }], { ...HOME, deliveryType: "stop_desk" }, 300);
  });

  it("with the commune's own override", async () => {
    const { ruleId } = await seedProfile(true, 600, 300);
    await harness.db.insert(schema.shippingRuleCommunes).values({
      id: uid("src"),
      ruleId,
      communeId: OTHER_COMMUNE,
      homePrice: 900,
      stopDeskPrice: null,
      homeEnabled: null,
      stopDeskEnabled: null,
    });
    const p = await seedProduct(2500);

    await expectQuoteIsCharged([{ productId: p, quantity: 1 }], { ...HOME, communeId: OTHER_COMMUNE }, 900);
  });

  it("at the dearest rate of a basket spanning two profiles", async () => {
    await seedProfile(true, 600, 300);
    const { profileId: bulky } = await seedProfile(false, 1200, 800);
    const light = await seedProduct(1000);
    const heavy = await seedProduct(4000, bulky);

    await expectQuoteIsCharged(
      [{ productId: light, quantity: 1 }, { productId: heavy, quantity: 1 }],
      HOME,
      1200,
    );
  });

  it("free once the basket reaches the store's threshold", async () => {
    await harness.db
      .update(schema.stores)
      .set({ freeShippingThreshold: 5000 })
      .where(eq(schema.stores.id, STORE_ID))
      .run();
    await seedProfile(true, 600, 300);
    const p = await seedProduct(2500);

    await expectQuoteIsCharged([{ productId: p, quantity: 2 }], HOME, 0);
  });

  it("free when a single-product offer gives free shipping", async () => {
    await seedProfile(true, 600, 300);
    const p = await seedProduct(2500);
    await harness.db.insert(schema.offers).values({
      id: uid("offer"),
      name: "Two ship free",
      triggerProductId: p,
      triggerQuantity: 2,
      rewardProductId: null,
      rewardQuantity: 0,
      discountType: "free_shipping",
      status: "active",
      createdAt: NOW(),
      updatedAt: NOW(),
    });

    await expectQuoteIsCharged([{ productId: p, quantity: 2 }], HOME, 0);
  });

  it("unavailable where the store does not deliver — and the order is refused", async () => {
    await seedProfile(true, 600, 300);
    const p = await seedProduct(2500);
    const destination: Destination = { ...UNSERVED, deliveryType: "home" };

    const quoted = await quote([{ productId: p, quantity: 1 }], destination);
    expect(quoted.status).toBe(200);
    expect(quoted.json.data.delivery).toEqual({ available: false, fee: null, total: null });

    const placed = await order([{ productId: p, quantity: 1 }], destination);
    expect(placed.status).toBe(422);
    expect(placed.json.code).toBe("DELIVERY_NOT_AVAILABLE");
  });

  it("answers no quote when no destination is asked for", async () => {
    await seedProfile(true, 600, 300);
    const p = await seedProduct(2500);

    const quoted = await quote([{ productId: p, quantity: 1 }]);

    expect(quoted.status).toBe(200);
    expect(quoted.json.data).not.toHaveProperty("delivery");
  });

  it("refuses a destination outside the 58 wilayas", async () => {
    const p = await seedProduct(2500);

    const quoted = await quote([{ productId: p, quantity: 1 }], { wilayaId: 59, deliveryType: "home" });

    expect(quoted.status).toBe(400);
  });
});
