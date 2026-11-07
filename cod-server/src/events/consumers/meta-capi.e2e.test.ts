/**
 * Meta conversions as a Consumer (plan, Phase 7), on real D1: the real
 * writers record their events, the real drain delivers them to the built-in
 * Consumer, and Meta's API is answered at the network edge. Every stage of
 * every tracking mode, from every surface, sent once — and every reason not to.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { asc, eq } from "drizzle-orm";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import { SYSTEM, staff } from "@/test-utils/events";
import * as schema from "@/db/schema";
import type { Env } from "@/types";
import { drain } from "../drain";
import { createStoreOrder } from "../../../../cod-shared/queries/store";
import { updateOrderStatus } from "../../../../cod-shared/queries/orders";
import { handOffToDriver } from "../../../../cod-shared/shipments/handoff";
import { recordShipmentEvents } from "../../../../cod-shared/shipments/record-events";

let d1: TestD1;
const env = () => ({ DB: d1.raw, EVENTS_QUEUE: { send: vi.fn() } }) as unknown as Env;
const realFetch = globalThis.fetch;
let meta: { status: number; body: unknown };
let sent: Array<{ url: string; event: Record<string, any>; body: Record<string, any> }>;
const T0 = "2026-10-25T08:00:00.000Z";
const AGENT = { actor: { kind: "agent" as const, id: "u-ada", name: "Ada" }, origin: "agent" as const };

beforeAll(async () => {
  d1 = await createTestD1();
}, 120_000);

afterAll(async () => d1?.dispose());

beforeEach(async () => {
  for (const table of [
    schema.eventDeliveryAttempts, schema.eventDeliveries, schema.businessEvents, schema.capiEventLog, schema.shipmentEvents, schema.shipments,
    schema.stockMovements, schema.orderProducts, schema.orderStatusHistory, schema.orders, schema.landingPagePixelConfig, schema.landingPages,
    schema.storePixelConfig, schema.products, schema.customers, schema.drivers, schema.stores,
  ]) {
    await d1.db.delete(table);
  }
  await d1.db.insert(schema.stores).values({ id: "store", name: "Maysa", domain: "maysa.example", createdAt: T0, updatedAt: T0 });
  await d1.db.insert(schema.customers).values({ id: "c1", name: "Amina Benali", phone: "0551234567", wilaya: "Alger", createdAt: T0 });
  await d1.db.insert(schema.products).values({
    id: "robe", name: "Robe", handle: "robe", sku: "ROBE", price: 2500, hasVariants: false, inventory: 10, lowStockThreshold: 1,
    trackInventory: false, status: "ACTIVE", visibility: true, showInStore: true, createdAt: T0, updatedAt: T0,
  });
  await d1.db.insert(schema.drivers).values({ id: "dr1", firstName: "Amine", lastName: "B", phone: "0661111111", createdAt: T0, updatedAt: T0 });
  meta = { status: 200, body: { events_received: 1, fbtrace_id: "TRACE" } };
  sent = [];
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init!.body));
    sent.push({ url: String(url), event: body.data[0], body });
    return new Response(JSON.stringify(meta.body), { status: meta.status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

async function tracking(conversionEvent: "Lead" | "Purchase" | "Purchase_Confirmed" | "Purchase_Delivered", extra: Partial<typeof schema.storePixelConfig.$inferInsert> = {}) {
  await d1.db.insert(schema.storePixelConfig).values({ id: "px", storeId: "store", pixelId: "111111", accessToken: "EAAG-token", conversionEvent, createdAt: T0, updatedAt: T0, ...extra });
}

/** A shopper's order at the storefront, with the ad click's cookies. */
async function checkout(extra: { wilayaId?: number; communeId?: string; landingPageId?: string | null } = {}) {
  const order = await createStoreOrder(d1.db, {
    customerName: "Amina Benali", phone: "0551234567", wilayaId: extra.wilayaId ?? 16, communeId: extra.communeId ?? "c-16-001", deliveryType: "home",
    productId: "robe", productName: "Robe", quantity: 2, pricePerUnit: 2500, customerId: "c1", deliveryFee: 400, locale: "ar",
    fbc: "fb.1.123.abc", fbp: "fb.1.456.def", ipAddress: "41.100.1.2", userAgent: "Mozilla/5.0", landingPageId: extra.landingPageId ?? null,
  });
  await d1.db.update(schema.orders).set({ address: "12 rue Didouche" }).where(eq(schema.orders.id, order.id));
  return order.id;
}

async function delivered(orderId: string, at = new Date().toISOString(), milestones: Array<"out_for_delivery" | "delivered"> = ["delivered"]) {
  await d1.db.update(schema.orders).set({ status: "ready" }).where(eq(schema.orders.id, orderId));
  const [handed] = await handOffToDriver(d1.db, { orderIds: [orderId], driverId: "dr1", author: staff() });
  if (!handed.ok) throw new Error(handed.reason);
  for (const [i, milestone] of milestones.entries()) {
    await recordShipmentEvents(d1.db, handed.shipmentId, [
      { source: "merchant", status: { vocabulary: "driver", value: milestone }, interpretation: { kind: "milestone", milestone }, occurredAt: new Date(Date.parse(at) + i * 60_000).toISOString() },
    ], staff());
  }
}

const deliveriesOfMeta = () =>
  d1.db
    .select({ state: schema.eventDeliveries.state, type: schema.businessEvents.type, lastError: schema.eventDeliveries.lastError })
    .from(schema.eventDeliveries)
    .innerJoin(schema.businessEvents, eq(schema.businessEvents.seq, schema.eventDeliveries.eventSeq))
    .where(eq(schema.eventDeliveries.consumerId, "meta-conversions"))
    .orderBy(asc(schema.businessEvents.seq))
    .all();
const skipReasons = async () =>
  (await d1.db.select({ outcome: schema.eventDeliveryAttempts.outcome, error: schema.eventDeliveryAttempts.error }).from(schema.eventDeliveryAttempts).all())
    .filter((a) => a.outcome === "skipped")
    .map((a) => a.error);

describe("the built-in Consumer", () => {
  it("exists in every store, subscribed to the events a conversion can follow", async () => {
    const [consumer] = await d1.db.select().from(schema.eventConsumers).where(eq(schema.eventConsumers.id, "meta-conversions")).all();
    expect(consumer).toMatchObject({ kind: "meta_capi", enabled: true });
    expect(JSON.parse(consumer!.subscription)).toEqual(["order.created", "order.confirmed", "shipment.out_for_delivery", "shipment.delivered"]);
  });
});

describe("the checkout stage", () => {
  it("sends Purchase at checkout, once, with the order's facts, the click's cookies and the time the order was placed", async () => {
    await tracking("Purchase");
    const orderId = await checkout();
    await drain(env());
    await drain(env());

    expect(sent).toHaveLength(1);
    const [{ url, event }] = sent;
    expect(url).toContain("/111111/events?access_token=EAAG-token");
    const [placed] = await d1.db.select({ createdAt: schema.orders.createdAt }).from(schema.orders).where(eq(schema.orders.id, orderId)).all();
    expect(event).toMatchObject({
      event_name: "Purchase",
      event_id: orderId,
      event_time: Math.floor(Date.parse(placed!.createdAt) / 1000),
      action_source: "website",
      event_source_url: "https://maysa.example/thank-you",
      custom_data: { value: 5400, currency: "DZD", content_ids: ["robe"], content_type: "product" },
    });
    expect(event.user_data).toMatchObject({ fbc: "fb.1.123.abc", fbp: "fb.1.456.def", client_ip_address: "41.100.1.2", client_user_agent: "Mozilla/5.0" });
    expect(event.user_data.ph).toMatch(/^[0-9a-f]{64}$/);
    expect(await deliveriesOfMeta()).toEqual([{ state: "delivered", type: "order.created", lastError: null }]);
    expect(await d1.db.select({ stage: schema.capiEventLog.stage, status: schema.capiEventLog.status, metaEventId: schema.capiEventLog.metaEventId }).from(schema.capiEventLog).all()).toEqual([
      { stage: "checkout", status: "sent", metaEventId: "TRACE" },
    ]);
  });

  it("sends Lead, without a value, when the merchant optimises for leads", async () => {
    await tracking("Lead");
    await checkout();
    await drain(env());
    expect(sent.map((s) => s.event.event_name)).toEqual(["Lead"]);
    expect(sent[0]!.event.custom_data).toBeUndefined();
  });

  it("is never sent for an order the merchant entered", async () => {
    await tracking("Purchase");
    const { createOrder } = await import("../../../../cod-shared/queries/orders");
    await createOrder(d1.db, {
      id: "manual", orderNumber: "ORD-MANUAL", customerId: "c1", customerName: "Amina", phone: "0551234567", wilayaId: 16, communeId: "c-16-001",
      price: 2500, deliveryFee: 400, codAmount: 2900, createdAt: T0, updatedAt: T0,
    }, [], staff());
    await drain(env());
    expect(sent).toEqual([]);
    expect(await skipReasons()).toEqual(["order.created is not a conversion here"]);
  });

  it("names the landing page the ad pointed at, and sends to that page's own pixel", async () => {
    await tracking("Purchase", { perPageTrackingEnabled: true });
    await d1.db.insert(schema.landingPages).values({ id: "lp", slug: "robe-promo", name: "Robe", productId: "robe", status: "published", createdAt: T0, updatedAt: T0 });
    await d1.db.insert(schema.landingPagePixelConfig).values({ id: "lppx", landingPageId: "lp", pixelId: "999999", accessToken: "EAAG-page", conversionEvent: "Purchase", createdAt: T0, updatedAt: T0 });
    await checkout({ landingPageId: "lp" });
    await drain(env());
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toContain("/999999/events?access_token=EAAG-page");
    expect(sent[0]!.event.event_source_url).toBe("https://maysa.example/lp/robe-promo");
  });
});

describe("the confirmation stage", () => {
  it("sends Purchase when an AI agent confirms the order, which it never did before", async () => {
    await tracking("Purchase_Confirmed");
    const orderId = await checkout();
    expect(await updateOrderStatus(d1.db, orderId, "confirmed", AGENT)).toEqual({ ok: true });
    await drain(env());

    expect(sent.map((s) => [s.event.event_name, s.event.event_id])).toEqual([["Purchase", orderId]]);
    expect((await deliveriesOfMeta()).map((d) => [d.type, d.state])).toEqual([["order.created", "skipped"], ["order.confirmed", "delivered"]]);
  });
});

describe("the delivered stage", () => {
  it("sends Purchase at delivery, at the time the parcel was delivered", async () => {
    await tracking("Purchase_Delivered");
    const orderId = await checkout();
    const at = new Date(Date.now() - 2 * 24 * 3600_000).toISOString();
    await delivered(orderId, at);
    await drain(env());
    expect(sent).toHaveLength(1);
    expect(sent[0]!.event).toMatchObject({ event_name: "Purchase", event_time: Math.floor(Date.parse(at) / 1000) });
  });

  it("sends it on the way out for a long-haul wilaya, then never again at delivery", async () => {
    await tracking("Purchase_Delivered");
    const [adrar] = await d1.db.select({ id: schema.communes.id }).from(schema.communes).where(eq(schema.communes.wilayaId, 1)).limit(1).all();
    const orderId = await checkout({ wilayaId: 1, communeId: adrar!.id });
    await delivered(orderId, new Date().toISOString(), ["out_for_delivery", "delivered"]);
    await drain(env());
    expect(sent).toHaveLength(1);
    expect(await skipReasons()).toContain("This order's delivered Purchase was already sent to Meta");
  });

  it("waits for the delivery itself in Algiers", async () => {
    await tracking("Purchase_Delivered");
    const orderId = await checkout();
    await delivered(orderId, new Date().toISOString(), ["out_for_delivery"]);
    await drain(env());
    expect(sent).toEqual([]);
    expect(await skipReasons()).toContain("shipment.out_for_delivery is not a conversion here");
  });

  it("is refused by Meta's 7-day rule when the delivery happened longer ago, measured from when it happened", async () => {
    await tracking("Purchase_Delivered");
    const orderId = await checkout();
    await delivered(orderId, new Date(Date.now() - 8 * 24 * 3600_000).toISOString());
    await drain(env());
    expect(sent).toEqual([]);
    expect((await skipReasons()).some((r) => r?.includes("outside Meta's 7-day window"))).toBe(true);
  });

  it("is not sent twice when the old Workflow already sent it", async () => {
    await tracking("Purchase_Delivered");
    const orderId = await checkout();
    await d1.db.insert(schema.capiEventLog).values({ id: `claim-${orderId}-delivered-Purchase`, orderId, eventName: "Purchase", stage: "delivered", status: "sent", sentAt: T0 });
    await delivered(orderId);
    await drain(env());
    expect(sent).toEqual([]);
    expect(await skipReasons()).toContain("This order's delivered Purchase was already sent to Meta");
  });
});

describe("what Meta answers", () => {
  it("a refusal is final: the Delivery dies and the log says why", async () => {
    await tracking("Purchase");
    meta = { status: 400, body: { error: { message: "Invalid OAuth access token" } } };
    await checkout();
    await drain(env());
    expect(await deliveriesOfMeta()).toEqual([{ state: "dead", type: "order.created", lastError: "Meta refused the event: Invalid OAuth access token" }]);
    expect((await d1.db.select().from(schema.capiEventLog).all())[0]).toMatchObject({ status: "failed", error: "Invalid OAuth access token" });
  });

  it("an outage is retried by the same Delivery, which then sends it once", async () => {
    await tracking("Purchase");
    meta = { status: 503, body: { error: { message: "Service unavailable" } } };
    await checkout();
    await drain(env());
    expect((await deliveriesOfMeta())[0]).toMatchObject({ state: "due" });
    meta = { status: 200, body: { events_received: 1, fbtrace_id: "LATER" } };
    await drain(env(), { now: () => new Date(Date.now() + 6 * 60_000) });
    expect(await deliveriesOfMeta()).toEqual([{ state: "delivered", type: "order.created", lastError: null }]);
    expect(sent).toHaveLength(2);
    expect(await d1.db.select({ status: schema.capiEventLog.status, metaEventId: schema.capiEventLog.metaEventId }).from(schema.capiEventLog).all()).toEqual([{ status: "sent", metaEventId: "LATER" }]);
  });
});

describe("what the merchant's settings say", () => {
  it("nothing is sent while tracking is off, or with no token, or at a stage the mode does not use", async () => {
    await tracking("Purchase_Delivered", { enabled: false });
    const off = await checkout();
    await delivered(off);
    await drain(env());
    await d1.db.update(schema.storePixelConfig).set({ enabled: true, accessToken: "" });
    const tokenless = await checkout();
    await delivered(tokenless);
    await drain(env());
    expect(sent).toEqual([]);
    expect(await skipReasons()).toEqual(expect.arrayContaining([
      "Tracking disabled in store settings",
      "No CAPI access token — set up the Meta App",
      expect.stringContaining("checkout stage does not fire"),
    ]));
  });

  it("a test event code goes with every event while testing", async () => {
    await tracking("Purchase", { testMode: true, testEventCode: "TEST123" });
    await checkout();
    await drain(env());
    expect(sent[0]!.body.test_event_code).toBe("TEST123");
  });

  it("an order deleted before its conversion is delivered sends nothing", async () => {
    await tracking("Purchase");
    const orderId = await checkout();
    const { deleteOrder } = await import("../../../../cod-shared/queries/orders");
    expect(await deleteOrder(d1.db, orderId, SYSTEM)).toEqual({ ok: true });
    await drain(env());
    expect(sent).toEqual([]);
    expect(await skipReasons()).toContain("The order no longer exists");
  });
});
