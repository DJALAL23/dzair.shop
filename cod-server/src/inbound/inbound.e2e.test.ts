/**
 * Carrier webhooks end to end on real D1: received through the real routes
 * with real signatures, stored, answered, processed into shipment events, and
 * turned into conversions — plus what happens when processing fails.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { OpenAPIHono } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import type { AppContext } from "@/types";
import { errorHandler } from "@/middleware/error";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import * as schema from "@/db/schema";
import { getCapiWorkflowId } from "@/workflows/capi-helpers";
import { deleteOrder } from "../../../cod-shared/queries/orders";
import { acceptCarrierHandoff, markHandoffUnknown, reserveCarrierShipment } from "../../../cod-shared/shipments/handoff";
import { getShipmentWithEvents } from "../../../cod-shared/shipments/queries";
import { MAX_ATTEMPTS } from "../../../cod-shared/inbound/inbox";
import webhooksRouter from "@/endpoints/webhooks/routes";
import { processInboxEvent } from "./process";

const dbModule = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/db", () => dbModule);

let d1: TestD1;
let app: OpenAPIHono<AppContext>;
const T0 = "2026-10-14T08:00:00.000Z";
const SECRET_A = "yal-secret-company-a";
const SECRET_B = "yal-secret-company-b";
const ZR_SECRET = `whsec_${btoa("zr-secret-bytes-0123456789")}`;
const created = vi.fn(async (_: unknown) => ({ id: "wf" }));
let pending: Promise<unknown>[] = [];

beforeAll(async () => {
  d1 = await createTestD1();
  app = new OpenAPIHono<AppContext>();
  app.onError(errorHandler);
  app.route("/webhooks", webhooksRouter);
}, 120_000);

afterAll(async () => {
  await d1?.dispose();
});

beforeEach(async () => {
  dbModule.getDb.mockReturnValue(d1.db);
  created.mockClear();
  pending = [];
  const db = d1.db;
  for (const table of [schema.shipmentEvents, schema.webhookEvents, schema.shipments, schema.orderProducts, schema.orderStatusHistory, schema.orders, schema.customers, schema.deliveryCompanies]) {
    await db.delete(table);
  }
  await db.insert(schema.customers).values({ id: "c1", name: "Karim", phone: "0551234567", wilaya: "Alger", createdAt: T0 });
  const company = { nameAr: "-", active: true, createdAt: T0, updatedAt: T0 };
  for (const row of [
    { ...company, id: "yal-a", name: "Yalidine A", code: "yalidine", provider: "yalidine" as const, apiToken: "t", apiUserGuid: "a", webhookSecret: SECRET_A },
    { ...company, id: "yal-b", name: "Yalidine B", code: "yalidine_b", provider: "yalidine" as const, apiToken: "t", apiUserGuid: "b", webhookSecret: SECRET_B },
    { ...company, id: "guepex", name: "Guepex", code: "guepex", provider: "yalidine" as const, apiToken: "t", apiUserGuid: "g", providerConfig: JSON.stringify({ platform: "guepex" }) },
    { ...company, id: "zr", name: "ZR", code: "zr_express", provider: "zr_express" as const, apiToken: "k", apiUserGuid: "tenant", webhookSecret: ZR_SECRET },
  ]) {
    await db.insert(schema.deliveryCompanies).values(row);
  }
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function hmacHex(body: string, secret: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function svixHeaders(id: string, body: string, secret = ZR_SECRET) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const keyBytes = Uint8Array.from(atob(secret.slice(6)), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${timestamp}.${body}`)))));
  return { "svix-id": id, "svix-timestamp": timestamp, "svix-signature": `v1,${signature}` };
}

const env = () => ({ DB: d1.raw, CAPI_WORKFLOW: { create: created } }) as never;
const ctx = () => ({ waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException() {} }) as never;
/** Every background job the request started, including the ones those start. */
async function settled() {
  while (pending.length) await Promise.all(pending.splice(0));
}

async function yalidine(type: string, events: Array<{ event_id: string; occurred_at: string; data: Record<string, unknown> }>, secret: string | null = SECRET_A) {
  const body = JSON.stringify({ type, events });
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (secret) headers["X-Yalidine-Signature"] = await hmacHex(body, secret);
  const res = await app.request("/webhooks/yalidine", { method: "POST", body, headers }, env(), ctx());
  await settled();
  return res;
}

async function zr(eventType: string, data: Record<string, unknown>, occurredAt = "2026-10-14T09:00:00Z", id = crypto.randomUUID()) {
  const body = JSON.stringify({ eventType, occurredAt, data });
  const res = await app.request("/webhooks/zr_express", { method: "POST", body, headers: { "Content-Type": "application/json", ...(await svixHeaders(id, body)) } }, env(), ctx());
  await settled();
  return res;
}

async function shipmentAt(orderId: string, companyId: string, parcel: { carrierParcelId: string; trackingNumber: string | null } | "unknown", wilayaId = 16) {
  await d1.db.insert(schema.orders).values({
    id: orderId, orderNumber: `ORD-${orderId}`, customerId: "c1", customerName: "Karim", phone: "0551234567", wilayaId, address: "Rue 1",
    price: 1500, deliveryFee: 400, status: "ready", createdAt: T0, updatedAt: T0,
  });
  const reserved = await reserveCarrierShipment(d1.db, { orderId, companyId, deliveryType: "home", stationCode: null, weight: null, isFragile: null, createdBy: null });
  if (!reserved.ok) throw new Error("reservation failed");
  if (parcel === "unknown") await markHandoffUnknown(d1.db, reserved.shipmentId, "timeout");
  else await acceptCarrierHandoff(d1.db, reserved.shipmentId, { ...parcel, carrierData: null, labelUrl: null }, { validated: true });
  return reserved.shipmentId;
}

const inbox = () => d1.db.select().from(schema.webhookEvents).all();
const shipment = (id: string) => d1.db.select().from(schema.shipments).where(eq(schema.shipments.id, id)).get();
/** What webhooks recorded on the shipment (its own handoff steps aside). */
const events = async (id: string) => (await getShipmentWithEvents(d1.db, id))!.events.filter((e) => e.source === "webhook");
const status = (tracking: string, value: string, at = "2026-10-14 10:00:00", reason: string | null = null) => ({ event_id: `${tracking}-${value}-${at}`, occurred_at: at, data: { tracking, status: value, reason } });

// ─── Receiving ───────────────────────────────────────────────────────────────

describe("receiving", () => {
  it("answers Yalidine's challenge with its token, before anything else", async () => {
    const res = await app.request("/webhooks/yalidine?subscribe=1&crc_token=abc123", {}, env(), ctx());
    expect(await res.text()).toBe("abc123");
  });

  it("stores each event, answers, then records it on the shipment of the company whose secret signed it", async () => {
    const a = await shipmentAt("oa", "yal-a", { carrierParcelId: "yal-1", trackingNumber: "yal-1" });
    const b = await shipmentAt("ob", "yal-b", { carrierParcelId: "yal-1", trackingNumber: "yal-1" });
    const res = await yalidine("parcel_status_updated", [status("yal-1", "Sorti en livraison")], SECRET_B);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });

    expect((await shipment(b))!.providerStatus).toBe("Sorti en livraison");
    expect((await shipment(a))!.providerStatus).toBeNull();
    const [row] = await inbox();
    expect(row).toMatchObject({ companyId: "yal-b", provider: "yalidine", result: "ok", shipmentId: b, tracking: "yal-1", attempts: 1, nextAttemptAt: null });
    expect(row).not.toHaveProperty("orderId");
    const [event] = await events(b);
    expect(event).toMatchObject({ source: "webhook", vocabulary: "status", providerStatus: "Sorti en livraison", webhookEventId: row.id });
    expect(event.occurredAt).toBe("2026-10-14T09:00:00.000Z");
  });

  it("a signature no company's secret verifies is refused, and nothing is stored", async () => {
    await shipmentAt("oa", "yal-a", { carrierParcelId: "yal-1", trackingNumber: "yal-1" });
    expect((await yalidine("parcel_status_updated", [status("yal-1", "Livré")], "some-other-secret")).status).toBe(401);
    expect((await yalidine("parcel_status_updated", [status("yal-1", "Livré")], null)).status).toBe(401);
    expect(await inbox()).toHaveLength(0);
  });

  it("a single company without a secret takes unsigned deliveries; with a secret it does not", async () => {
    await d1.db.delete(schema.deliveryCompanies).where(eq(schema.deliveryCompanies.id, "yal-b"));
    await d1.db.update(schema.deliveryCompanies).set({ webhookSecret: null }).where(eq(schema.deliveryCompanies.id, "yal-a"));
    expect((await yalidine("parcel_status_updated", [status("yal-9", "Livré")], null)).status).toBe(200);
    expect(await inbox()).toHaveLength(1);

    await d1.db.update(schema.deliveryCompanies).set({ webhookSecret: SECRET_A }).where(eq(schema.deliveryCompanies.id, "yal-a"));
    expect((await yalidine("parcel_status_updated", [status("yal-9", "Livré", "2026-10-14 11:00:00")], null)).status).toBe(401);
  });

  it("several companies with no secret: an unsigned delivery could be anyone's, so it is refused", async () => {
    await d1.db.update(schema.deliveryCompanies).set({ webhookSecret: null });
    expect((await yalidine("parcel_status_updated", [status("yal-9", "Livré")], null)).status).toBe(401);
    expect(await inbox()).toHaveLength(0);
  });

  it("Guepex takes no webhooks, so it never makes a single unsigned Yalidine company ambiguous", async () => {
    await d1.db.delete(schema.deliveryCompanies).where(eq(schema.deliveryCompanies.id, "yal-b"));
    await d1.db.update(schema.deliveryCompanies).set({ webhookSecret: null }).where(eq(schema.deliveryCompanies.id, "yal-a"));
    expect((await yalidine("parcel_status_updated", [status("yal-9", "Livré")], null)).status).toBe(200);
    expect((await inbox())[0].companyId).toBe("yal-a");
  });

  it("an inactive company, or one that takes no webhooks (Guepex), is never the target", async () => {
    await d1.db.update(schema.deliveryCompanies).set({ active: false }).where(eq(schema.deliveryCompanies.id, "yal-a"));
    expect((await yalidine("parcel_status_updated", [status("yal-1", "Livré")], SECRET_A)).status).toBe(401);
    expect(await inbox()).toHaveLength(0);
  });

  it("a delivery sent again is stored and recorded once", async () => {
    const id = await shipmentAt("oa", "yal-a", { carrierParcelId: "yal-1", trackingNumber: "yal-1" });
    const batch = [status("yal-1", "Sorti en livraison"), status("yal-1", "Sorti en livraison")];
    await yalidine("parcel_status_updated", batch);
    await yalidine("parcel_status_updated", batch);
    expect(await inbox()).toHaveLength(1);
    expect(await events(id)).toHaveLength(1);
  });

  it("an unreadable body is refused", async () => {
    const body = "{not json";
    const res = await app.request("/webhooks/yalidine", { method: "POST", body, headers: { "X-Yalidine-Signature": await hmacHex(body, SECRET_A) } }, env(), ctx());
    expect(res.status).toBe(400);
  });

  it("answers at once even when processing fails — the event waits for a retry", async () => {
    const id = await shipmentAt("oa", "yal-a", { carrierParcelId: "yal-1", trackingNumber: "yal-1" });
    await d1.db.update(schema.deliveryCompanies).set({ providerConfig: "{\"platform\":\"nowhere\"}" }).where(eq(schema.deliveryCompanies.id, "yal-a"));
    const res = await yalidine("parcel_status_updated", [status("yal-1", "Livré")]);
    expect(res.status).toBe(200);
    const [row] = await inbox();
    expect(row).toMatchObject({ result: "error", attempts: 1 });
    expect(row.errorMsg).toMatch(/Invalid yalidine settings/);
    expect(new Date(row.nextAttemptAt!).getTime()).toBeGreaterThan(Date.now() + 30_000);
    expect(await events(id)).toHaveLength(0);
  });
});

// ─── What an event means ─────────────────────────────────────────────────────

describe("what an event means", () => {
  it("a batch out of order: the latest status wins and each milestone keeps its own time", async () => {
    const id = await shipmentAt("oa", "yal-a", { carrierParcelId: "yal-1", trackingNumber: "yal-1" });
    await yalidine("parcel_status_updated", [status("yal-1", "Livré", "2026-10-14 15:00:00"), status("yal-1", "Sorti en livraison", "2026-10-14 10:00:00")]);
    expect(await shipment(id)).toMatchObject({ providerStatus: "Livré", outForDeliveryAt: "2026-10-14T09:00:00.000Z", deliveredAt: "2026-10-14T14:00:00.000Z" });
  });

  it("a parcel deleted at the carrier is a cancelled shipment", async () => {
    const id = await shipmentAt("oa", "yal-a", { carrierParcelId: "yal-1", trackingNumber: "yal-1" });
    await yalidine("parcel_deleted", [{ event_id: "del-1", occurred_at: "2026-10-14 10:00:00", data: { tracking: "yal-1" } }]);
    expect((await shipment(id))!.cancelledAt).toBe("2026-10-14T09:00:00.000Z");
  });

  it("a money event is kept for settlement and moves nothing", async () => {
    const id = await shipmentAt("oa", "yal-a", { carrierParcelId: "yal-1", trackingNumber: "yal-1" });
    await yalidine("parcel_payment_updated", [{ event_id: "pay-1", occurred_at: "2026-10-14 10:00:00", data: { tracking: "yal-1", status: "ready" } }]);
    expect((await inbox())[0].result).toBe("deferred_settlement");
    expect(await events(id)).toHaveLength(0);
  });

  it("a parcel CodFlow does not know is kept as unmatched", async () => {
    await yalidine("parcel_status_updated", [status("yal-404", "Livré")]);
    expect((await inbox())[0]).toMatchObject({ result: "unmatched", tracking: "yal-404", shipmentId: null });
  });

  it("a status the carrier never documented is recorded as it is, and flagged", async () => {
    const id = await shipmentAt("oa", "yal-a", { carrierParcelId: "yal-1", trackingNumber: "yal-1" });
    await yalidine("parcel_status_updated", [status("yal-1", "Statut tout nouveau")]);
    expect((await inbox())[0].result).toBe("unknown_status");
    expect((await events(id))[0]).toMatchObject({ providerStatus: "Statut tout nouveau", interpretation: "unknown" });
  });

  it("Yalidine's creation event settles a handoff whose outcome was unknown, with its label", async () => {
    const id = await shipmentAt("oa", "yal-a", "unknown");
    await yalidine("parcel_created", [{ event_id: "cr-1", occurred_at: "2026-10-14 10:00:00", data: { order_id: "ORD-oa", tracking: "yal-77", label: "https://yalidine.app/b?t=77" } }]);
    expect(await shipment(id)).toMatchObject({ handoffState: "accepted", carrierParcelId: "yal-77", trackingNumber: "yal-77", labelUrl: "https://yalidine.app/b?t=77" });
    expect((await inbox())[0]).toMatchObject({ result: "ok", shipmentId: id });

    await yalidine("parcel_created", [{ event_id: "cr-2", occurred_at: "2026-10-14 10:00:00", data: { order_id: "ORD-oa", tracking: "yal-77" } }]);
    expect((await inbox()).find((r) => r.eventId === "cr-2")!.result).toBe("ignored");
  });

  it("a status for a parcel still being handed off waits and is retried", async () => {
    await d1.db.insert(schema.orders).values({ id: "os", orderNumber: "ORD-os", customerId: "c1", customerName: "K", phone: "0551234567", price: 1, deliveryFee: 0, status: "ready", createdAt: T0, updatedAt: T0 });
    await reserveCarrierShipment(d1.db, { orderId: "os", companyId: "zr", deliveryType: "home", stationCode: null, weight: null, isFragile: null, createdBy: null });
    await zr("parcel.state.updated", { id: "uuid-s", externalId: "ORD-os", state: { name: "en_preparation" } });
    expect((await inbox())[0]).toMatchObject({ result: "error" });
    expect((await d1.db.select().from(schema.shipmentEvents).all()).filter((e) => e.source === "webhook")).toHaveLength(0);
  });

  it("a creation for a parcel still being handed off waits and is retried", async () => {
    await d1.db.insert(schema.orders).values({ id: "os", orderNumber: "ORD-os", customerId: "c1", customerName: "K", phone: "0551234567", price: 1, deliveryFee: 0, status: "ready", createdAt: T0, updatedAt: T0 });
    await reserveCarrierShipment(d1.db, { orderId: "os", companyId: "yal-a", deliveryType: "home", stationCode: null, weight: null, isFragile: null, createdBy: null });
    await yalidine("parcel_created", [{ event_id: "cr-3", occurred_at: "2026-10-14 10:00:00", data: { order_id: "ORD-os", tracking: "yal-88" } }]);
    expect((await inbox())[0]).toMatchObject({ result: "error" });
  });
});

describe("ZR Express", () => {
  it("a state update is recorded on the parcel by its id, signed with Svix", async () => {
    const id = await shipmentAt("oz", "zr", { carrierParcelId: "uuid-1", trackingNumber: "ZR-1" });
    expect((await zr("parcel.state.updated", { id: "uuid-1", trackingNumber: "ZR-1", state: { name: "livre", description: "Livré" } })).status).toBe(200);
    const [event] = await events(id);
    expect(event).toMatchObject({ vocabulary: "state", providerStatus: "livre", providerStatusLabel: "Livré" });
    expect((await inbox())[0]).toMatchObject({ provider: "zr_express", companyId: "zr", result: expect.stringMatching(/ok|unknown_status/) });
  });

  it("an update for an unknown handoff, found by our order number, settles it", async () => {
    const id = await shipmentAt("oz", "zr", "unknown");
    await zr("parcel.state.updated", { id: "uuid-9", trackingNumber: "ZR-9", externalId: "ORD-oz", state: { name: "en_preparation" } });
    expect(await shipment(id)).toMatchObject({ handoffState: "accepted", carrierParcelId: "uuid-9", trackingNumber: "ZR-9" });
  });

  it("a parcel attached by its tracking number takes the carrier's real id from its first update", async () => {
    const id = await shipmentAt("oz", "zr", { carrierParcelId: "ZR-5", trackingNumber: "ZR-5" });
    await zr("parcel.state.updated", { id: "uuid-5", trackingNumber: "ZR-5", state: { name: "en_preparation" } });
    expect((await shipment(id))!.carrierParcelId).toBe("uuid-5");
  });

  it("a parcel created before its tracking number was known adopts it, keeping the carrier's own id", async () => {
    const id = await shipmentAt("oz", "zr", { carrierParcelId: "uuid-1", trackingNumber: null });
    await zr("parcel.state.updated", { id: "uuid-other", trackingNumber: "ZR-1", externalId: "ORD-oz", state: { name: "en_preparation" } });
    expect(await shipment(id)).toMatchObject({ carrierParcelId: "uuid-1", trackingNumber: "ZR-1" });
  });

  it("a delivery not signed with the company's secret is refused", async () => {
    const body = JSON.stringify({ eventType: "parcel.state.updated", occurredAt: "2026-10-14T09:00:00Z", data: {} });
    const res = await app.request("/webhooks/zr_express", { method: "POST", body, headers: await svixHeaders("x1", body, `whsec_${btoa("wrong")}`) }, env(), ctx());
    expect(res.status).toBe(401);
  });
});

// ─── Conversions ─────────────────────────────────────────────────────────────

describe("conversions", () => {
  it("a delivery starts the delivered-stage conversion, once", async () => {
    await shipmentAt("oa", "yal-a", { carrierParcelId: "yal-1", trackingNumber: "yal-1" });
    await yalidine("parcel_status_updated", [status("yal-1", "Livré")]);
    await yalidine("parcel_status_updated", [status("yal-1", "Livré")]);
    expect(created).toHaveBeenCalledTimes(1);
    expect(created.mock.calls[0][0]).toMatchObject({ id: getCapiWorkflowId("oa", "delivered", "Purchase"), params: { orderId: "oa", stage: "delivered", eventName: "Purchase", triggerStatus: "delivered" } });
  });

  it("the final mile starts it for a long-haul wilaya (Adrar), not for Algiers", async () => {
    await shipmentAt("far", "yal-a", { carrierParcelId: "yal-far", trackingNumber: "yal-far" }, 1);
    await shipmentAt("near", "yal-a", { carrierParcelId: "yal-near", trackingNumber: "yal-near" }, 16);
    await yalidine("parcel_status_updated", [status("yal-far", "Sorti en livraison"), status("yal-near", "Sorti en livraison")]);
    expect(created.mock.calls.map(([call]) => (call as { params: { orderId: string } }).params.orderId)).toEqual(["far"]);
  });

  it("a return starting is not a conversion", async () => {
    await shipmentAt("oa", "yal-a", { carrierParcelId: "yal-1", trackingNumber: "yal-1" });
    await yalidine("parcel_status_updated", [status("yal-1", "Retour vers vendeur")]);
    expect(created).not.toHaveBeenCalled();
  });
});

// ─── Retries and dead letters ────────────────────────────────────────────────

describe("retries", () => {
  it("an event that keeps failing is retried with growing waits, then kept as a dead letter", async () => {
    await shipmentAt("oa", "yal-a", { carrierParcelId: "yal-1", trackingNumber: "yal-1" });
    await d1.db.update(schema.deliveryCompanies).set({ providerConfig: "{\"platform\":\"nowhere\"}" }).where(eq(schema.deliveryCompanies.id, "yal-a"));
    await yalidine("parcel_status_updated", [status("yal-1", "Livré")]);
    const waits: number[] = [];
    for (let attempt = 2; attempt <= MAX_ATTEMPTS; attempt++) {
      const before = (await inbox())[0];
      const due = new Date(before.nextAttemptAt!);
      waits.push(due.getTime() - new Date(before.processedAt!).getTime());
      expect((await processInboxEvent(d1.db, before.id, new Date(due.getTime() - 1000))).result).toBe("skipped");
      expect((await processInboxEvent(d1.db, before.id, due)).result).toBe(attempt === MAX_ATTEMPTS ? "dead" : "error");
    }
    const [row] = await inbox();
    expect(row).toMatchObject({ result: "dead", attempts: MAX_ATTEMPTS, nextAttemptAt: null });
    expect(waits.map((ms) => ms / 60_000)).toEqual([1, 5, 15, 60, 180, 360, 720]);
    expect((await processInboxEvent(d1.db, row.id, new Date("2030-01-01T00:00:00Z"))).result).toBe("skipped");
  });

  it("an error then a success: the event is recorded once its cause is fixed", async () => {
    const id = await shipmentAt("oa", "yal-a", { carrierParcelId: "yal-1", trackingNumber: "yal-1" });
    await d1.db.update(schema.deliveryCompanies).set({ providerConfig: "{\"platform\":\"nowhere\"}" }).where(eq(schema.deliveryCompanies.id, "yal-a"));
    await yalidine("parcel_status_updated", [status("yal-1", "Livré")]);
    await d1.db.update(schema.deliveryCompanies).set({ providerConfig: null }).where(eq(schema.deliveryCompanies.id, "yal-a"));
    const [row] = await inbox();
    expect((await processInboxEvent(d1.db, row.id, new Date(row.nextAttemptAt!))).result).toBe("ok");
    expect((await shipment(id))!.deliveredAt).not.toBeNull();
    expect((await inbox())[0]).toMatchObject({ result: "ok", attempts: 2, errorMsg: null, nextAttemptAt: null });
  });

  it("an event already settled is never processed again, whatever its schedule says", async () => {
    await d1.db.insert(schema.webhookEvents).values({
      id: "w0", provider: "yalidine", eventId: "e0", companyId: "yal-a", eventType: "parcel_status_updated",
      rawPayload: JSON.stringify({ type: "parcel_status_updated", event: status("yal-x", "Livré") }), result: "ok", nextAttemptAt: T0, createdAt: T0,
    });
    expect((await processInboxEvent(d1.db, "w0")).result).toBe("skipped");
    expect((await inbox())[0]).toMatchObject({ result: "ok", attempts: 0 });
  });

  it("an event being processed is not taken by a second pass", async () => {
    await d1.db.insert(schema.webhookEvents).values({
      id: "w1", provider: "yalidine", eventId: "e1", companyId: "yal-a", eventType: "parcel_status_updated",
      rawPayload: JSON.stringify({ type: "parcel_status_updated", event: status("yal-x", "Livré") }), result: "pending", nextAttemptAt: T0, createdAt: T0,
    });
    const [first, second] = await Promise.all([processInboxEvent(d1.db, "w1"), processInboxEvent(d1.db, "w1")]);
    expect([first.result, second.result].sort()).toEqual(["skipped", "unmatched"]);
    expect((await inbox())[0].attempts).toBe(1);
  });
});

describe("the inbox keeps its audit when a shipment goes", () => {
  it("deleting an order whose shipment came from webhooks works, and its events stay in the inbox", async () => {
    const id = await shipmentAt("oa", "yal-a", { carrierParcelId: "yal-1", trackingNumber: "yal-1" });
    await yalidine("parcel_status_updated", [status("yal-1", "Livré")]);
    expect(await events(id)).toHaveLength(1);
    expect(await deleteOrder(d1.db, "oa")).toEqual({ ok: true });
    expect((await inbox())[0]).toMatchObject({ result: "ok", shipmentId: null });
  });
});
