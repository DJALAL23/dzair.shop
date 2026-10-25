/**
 * What delivery costs on an order the merchant enters, through the real
 * routes on real D1 — decided exactly as the storefront checkout decides it.
 *
 * Proved: every product's shipping profile counts and the dearest wins; a
 * commune's own price; free at the store's "free delivery above" amount; free
 * by an offer only for a basket of its product alone, and never by an
 * expired one; refused where the store does not deliver; the order records
 * the offer that made it free; a fee the merchant typed is theirs; and the
 * quote the dashboard shows is the fee the order charges.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { signIn } from "@/test-utils/sign-in";
import { OpenAPIHono } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import type { AppContext } from "@/types";
import { errorHandler } from "@/middleware/error";
import { openApiValidationHook } from "@/openapi/validation-hook";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import * as schema from "@/db/schema";
import ordersRouter from "./routes";

const dbModule = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/db", () => dbModule);

const T = "2026-10-24T08:00:00.000Z";
let d1: TestD1;
let app: OpenAPIHono<AppContext>;
let commune16: string;
let otherCommune16: string;

beforeAll(async () => {
  d1 = await createTestD1();
  app = new OpenAPIHono<AppContext>({ defaultHook: openApiValidationHook });
  app.use("*", async (c, next) => {
    c.env = { DB: d1.raw } as never;
    signIn(c, { id: "u1", email: "s@example.com", name: "Staff", role: "admin", status: "active", apiKey: "k", scopes: [] } as never);
    await next();
  });
  app.onError(errorHandler);
  app.route("/api/orders", ordersRouter);
  const communes = (await d1.raw.prepare("select id from communes where wilaya_id = 16 order by id limit 2").all<{ id: string }>()).results;
  [commune16, otherCommune16] = communes.map((c) => c.id);
}, 120_000);

afterAll(async () => {
  await d1?.dispose();
});

beforeEach(async () => {
  dbModule.getDb.mockReturnValue(d1.db);
  const db = d1.db;
  for (const table of [schema.stockMovements, schema.orderStatusHistory, schema.orderProducts, schema.orders, schema.offers, schema.shippingRuleCommunes, schema.shippingRules, schema.products, schema.shippingProfiles, schema.customers, schema.activityLogs, schema.stores]) {
    await db.delete(table);
  }
  await db.insert(schema.stores).values({ id: "s1", name: "Store", freeShippingThreshold: 10000, createdAt: T, updatedAt: T });
  await db.insert(schema.customers).values({ id: "c1", name: "Karim", phone: "0551234567", wilaya: "Alger", createdAt: T });
  await db.insert(schema.shippingProfiles).values([
    { id: "standard", name: "Standard", isDefault: true, createdAt: T, updatedAt: T },
    { id: "heavy", name: "Heavy", isDefault: false, createdAt: T, updatedAt: T },
  ]);
  await db.insert(schema.shippingRules).values([
    { id: "r-std-16", profileId: "standard", wilayaId: 16, homePrice: 400, stopDeskPrice: 300, homeEnabled: true, stopDeskEnabled: true, createdAt: T },
    { id: "r-heavy-16", profileId: "heavy", wilayaId: 16, homePrice: 900, stopDeskPrice: 700, homeEnabled: true, stopDeskEnabled: true, createdAt: T },
  ]);
  await db.insert(schema.shippingRuleCommunes).values({ id: "rc-1", ruleId: "r-std-16", communeId: otherCommune16, homePrice: 250 });
  const product = { hasVariants: false, inventory: 100, trackInventory: false, status: "ACTIVE" as const, visibility: true, showInStore: true, createdAt: T, updatedAt: T };
  await db.insert(schema.products).values([
    { ...product, id: "robe", name: "Robe", handle: "robe", price: 2000 },
    { ...product, id: "foulard", name: "Foulard", handle: "foulard", price: 1500 },
    { ...product, id: "frigo", name: "Mini frigo", handle: "frigo", price: 5000, shippingProfileId: "heavy" },
  ]);
  await db.insert(schema.offers).values([
    { id: "of-ship", name: "Livraison offerte dès 2 foulards", triggerProductId: "foulard", triggerQuantity: 2, rewardQuantity: 0, discountType: "free_shipping", status: "active", createdAt: T, updatedAt: T },
    { id: "of-old", name: "Ancienne offre", triggerProductId: "robe", triggerQuantity: 1, rewardQuantity: 0, discountType: "free_shipping", status: "active", endsAt: "2026-01-01T00:00:00.000Z", createdAt: T, updatedAt: T },
  ]);
});

const prices: Record<string, number> = { robe: 2000, foulard: 1500, frigo: 5000 };
const lines = (...items: Array<[string, number]>) => items.map(([productId, quantity]) => ({ productId, quantity }));
const subtotalOf = (items: Array<{ productId: string; quantity: number }>) => items.reduce((sum, item) => sum + prices[item.productId] * item.quantity, 0);

async function quote(items: Array<{ productId: string; quantity: number }>, where: { wilayaId?: number; communeId?: string; deliveryType?: "home" | "stop_desk" } = {}) {
  const res = await app.request("/api/orders/delivery-quote", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lines: items, subtotal: subtotalOf(items), wilayaId: where.wilayaId ?? 16, communeId: where.communeId ?? commune16, deliveryType: where.deliveryType ?? "home" }),
  });
  return { status: res.status, body: (await res.json()) as any };
}

async function order(items: Array<{ productId: string; quantity: number }>, extra: Record<string, unknown> = {}) {
  const res = await app.request("/api/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      customerId: "c1", customerName: "Karim", phone: "0551234567", wilayaId: 16, communeId: commune16, address: "12 Rue Didouche", deliveryType: "home",
      orderType: "offline", price: subtotalOf(items),
      products: items.map((item) => ({ productId: item.productId, productName: item.productId, quantity: item.quantity, pricePerUnit: prices[item.productId], lineTotal: prices[item.productId] * item.quantity })),
      ...extra,
    }),
  });
  const body = (await res.json()) as any;
  const row = res.status === 201 ? await d1.db.select().from(schema.orders).where(eq(schema.orders.id, body.data.id)).get() : undefined;
  return { status: res.status, body, row };
}

describe("the delivery an order costs", () => {
  it("is the store's rate there, a commune's own price included", async () => {
    expect((await quote(lines(["robe", 1]))).body.data).toEqual({ available: true, rate: 400, fee: 400, free: null });
    expect((await quote(lines(["robe", 1]), { communeId: otherCommune16 })).body.data).toMatchObject({ rate: 250, fee: 250 });
    expect((await quote(lines(["robe", 1]), { deliveryType: "stop_desk" })).body.data).toMatchObject({ fee: 300 });
  });

  it("counts every product's shipping profile, the dearest winning", async () => {
    expect((await quote(lines(["robe", 1], ["frigo", 1]))).body.data).toMatchObject({ rate: 900, fee: 900, free: null });
  });

  it("is free at the store's free-delivery amount", async () => {
    expect((await quote(lines(["robe", 4], ["foulard", 1]))).body.data).toMatchObject({ rate: 400, fee: 400, free: null });
    expect((await quote(lines(["robe", 5]))).body.data).toEqual({ available: true, rate: 400, fee: 0, free: { by: "threshold", threshold: 10000 } });
  });

  it("is free by an offer for a basket of its product alone, never by an expired one", async () => {
    expect((await quote(lines(["foulard", 2]))).body.data).toEqual({ available: true, rate: 400, fee: 0, free: { by: "offer", offerId: "of-ship", offerName: "Livraison offerte dès 2 foulards" } });
    expect((await quote(lines(["foulard", 2], ["robe", 1]))).body.data).toMatchObject({ fee: 400, free: null });
    expect((await quote(lines(["foulard", 1]))).body.data).toMatchObject({ fee: 400, free: null });
    expect((await quote(lines(["robe", 1]))).body.data).toMatchObject({ fee: 400, free: null });
  });

  it("is unavailable where the store does not deliver", async () => {
    expect((await quote(lines(["robe", 1]), { wilayaId: 31, communeId: undefined })).body.data).toEqual({ available: false });
  });
});

describe("an order the merchant enters", () => {
  it("charges what the quote said, and records the offer that made delivery free", async () => {
    const byOffer = await order(lines(["foulard", 2]));
    expect(byOffer.status).toBe(201);
    expect(byOffer.row).toMatchObject({ deliveryFee: 0, codAmount: 3000, deliveryOfferId: "of-ship", deliveryOfferName: "Livraison offerte dès 2 foulards" });

    const byAmount = await order(lines(["robe", 5]));
    expect(byAmount.row).toMatchObject({ deliveryFee: 0, deliveryOfferId: null });

    const mixed = await order(lines(["robe", 1], ["frigo", 1]));
    expect(mixed.row).toMatchObject({ deliveryFee: 900, codAmount: 7900 });

    const expired = await order(lines(["robe", 1]));
    expect(expired.row).toMatchObject({ deliveryFee: 400, deliveryOfferId: null });
  });

  it("keeps a fee the merchant typed, even where delivery would be free", async () => {
    const typed = await order(lines(["foulard", 2]), { deliveryFee: 700 });
    expect(typed.row).toMatchObject({ deliveryFee: 700, codAmount: 3700, deliveryOfferId: null });
  });

  it("refuses an online order where the store does not deliver; an offline one takes the merchant's fee", async () => {
    const online = await order(lines(["robe", 1]), { orderType: "online", wilayaId: 31, communeId: (await d1.raw.prepare("select id from communes where wilaya_id = 31 limit 1").first<{ id: string }>())!.id });
    expect(online.status).toBe(422);
    expect(online.body.code).toBe("DELIVERY_NOT_AVAILABLE");
    const offline = await order(lines(["robe", 1]), { wilayaId: 31, communeId: (await d1.raw.prepare("select id from communes where wilaya_id = 31 limit 1").first<{ id: string }>())!.id, deliveryFee: 600 });
    expect(offline.row).toMatchObject({ deliveryFee: 600 });
  });
});
