/**
 * A delivery company's inbox and its "sync now", through the real routes on
 * real D1 with the real EcoTrack adapter over its double: the inbox shows
 * what each event became and where it was recorded; an event can be
 * processed again by hand; a sync records only what is new.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { OpenAPIHono } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import type { AppContext } from "@/types";
import { errorHandler } from "@/middleware/error";
import { openApiValidationHook } from "@/openapi/validation-hook";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import * as schema from "@/db/schema";
import { createEcotrackMockServer, type EcotrackMockServer } from "@/carriers/ecotrack/test/mock-server";
import { acceptCarrierHandoff, reserveCarrierShipment } from "../../../../cod-shared/shipments/handoff";
import { requeueInboxEvent } from "../../../../cod-shared/inbound/inbox";
import { seedOrder, seedStore, T0 } from "../shipments/test/harness";
import deliveryCompaniesRouter from "./routes";
import { SYNC_NOW_LIMIT } from "./handlers";

const dbModule = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/db", () => dbModule);

let d1: TestD1;
let app: OpenAPIHono<AppContext>;
let server: EcotrackMockServer;
let commune16: string;
let scopes: string[] = [];
const realFetch = globalThis.fetch;
const created = vi.fn(async (_: unknown) => ({ id: "wf" }));
const pending: Promise<unknown>[] = [];

beforeAll(async () => {
  d1 = await createTestD1();
  app = new OpenAPIHono<AppContext>({ defaultHook: openApiValidationHook });
  app.use("*", async (c, next) => {
    c.set("user", { id: "staff_1", email: "s@example.com", name: "Staff", role: "staff", status: "active", apiKey: "k", scopes } as never);
    await next();
  });
  app.onError(errorHandler);
  app.route("/api/delivery-companies", deliveryCompaniesRouter);
}, 120_000);

afterAll(async () => {
  await d1?.dispose();
});

beforeEach(async () => {
  dbModule.getDb.mockReturnValue(d1.db);
  scopes = ["delivery:read", "delivery:manage"];
  created.mockClear();
  server = createEcotrackMockServer();
  globalThis.fetch = ((url: string | URL, init?: RequestInit) => server.fetch(url, init)) as typeof fetch;
  commune16 = await seedStore(d1.db, server);
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

const env = () => ({ DB: d1.raw, CAPI_WORKFLOW: { create: created } }) as never;
const ctx = () => ({ waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException() {} }) as never;
const call = (method: string, path: string) => app.request(`/api/delivery-companies${path}`, { method }, env(), ctx());

async function parcelAtEcotrack(reference: string) {
  const query = new URLSearchParams({ reference, nom_client: "K", telephone: "0551234567", adresse: "Rue 1", code_wilaya: "16", commune: "Alger", montant: "1900", produit: "x", type: "1", stop_desk: "0" });
  const res = await server.fetch(`${server.baseUrl}/api/v1/create/order?${query}`, { method: "POST", headers: { Authorization: `Bearer ${server.token}` } });
  return ((await res.json()) as { tracking: string }).tracking;
}

async function shipmentAt(orderId: string, companyId: string, tracking: string) {
  await seedOrder(d1.db, commune16, { id: orderId });
  const reserved = await reserveCarrierShipment(d1.db, { orderId, companyId, deliveryType: "home", stationCode: null, weight: null, isFragile: null, createdBy: null });
  if (!reserved.ok) throw new Error("reservation failed");
  await acceptCarrierHandoff(d1.db, reserved.shipmentId, { carrierParcelId: tracking, trackingNumber: tracking, carrierData: null, labelUrl: null }, { validated: true });
  return reserved.shipmentId;
}

const yalidineEvent = (id: string, tracking: string, value: string, extra: Partial<typeof schema.webhookEvents.$inferInsert> = {}) => ({
  id, provider: "yalidine", eventId: id, companyId: "yal", eventType: "parcel_status_updated",
  rawPayload: JSON.stringify({ type: "parcel_status_updated", event: { event_id: id, occurred_at: "2026-10-14 10:00:00", data: { tracking, status: value } } }),
  result: "pending", createdAt: T0, ...extra,
});

describe("syncing a company's shipments now", () => {
  it("reads every open shipment's history and records what is new — once", async () => {
    const a = await shipmentAt("o1", "eco", await parcelAtEcotrack("ORD-o1"));
    const tB = await parcelAtEcotrack("ORD-o2");
    const b = await shipmentAt("o2", "eco", tB);
    server.parcel(tB)!.activity.push({ date: "2026-10-14", time: "16:00:00", status: "livred", station: "" });

    const res = await call("POST", "/eco/sync-shipments");
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).data).toEqual({ synced: 2, recorded: 3, reached: 1, moreRemain: false });
    expect((await d1.db.select().from(schema.shipments).where(eq(schema.shipments.id, b)).get())!.deliveredAt).not.toBeNull();
    expect((await d1.db.select().from(schema.shipments).where(eq(schema.shipments.id, a)).get())!.lastSyncedAt).not.toBeNull();
    expect(created).toHaveBeenCalledTimes(1);

    const again = ((await (await call("POST", "/eco/sync-shipments")).json()) as any).data;
    expect(again).toEqual({ synced: 1, recorded: 0, reached: 0, moreRemain: false });
  });

  it("reads at most a bounded number per request and says more remain", async () => {
    for (let i = 0; i <= SYNC_NOW_LIMIT; i++) await shipmentAt(`s${i}`, "eco", await parcelAtEcotrack(`ORD-s${i}`));
    const { data } = (await (await call("POST", "/eco/sync-shipments")).json()) as any;
    expect(data).toMatchObject({ synced: SYNC_NOW_LIMIT, moreRemain: true });
  });

  it("a carrier that throttles is reported as such", async () => {
    await shipmentAt("o1", "eco", await parcelAtEcotrack("ORD-o1"));
    server.override("/api/v1/get/tracking/info", () => new Response("{}", { status: 429 }));
    const res = await call("POST", "/eco/sync-shipments");
    expect(res.status).toBe(429);
    expect(((await res.json()) as any).code).toBe("CARRIER_RATE_LIMITED");
  });

  it("needs the manage permission, a connected company, and one that exists", async () => {
    expect((await call("POST", "/unconnected/sync-shipments")).status).toBe(400);
    expect((await call("POST", "/nope/sync-shipments")).status).toBe(404);
    scopes = ["delivery:read"];
    expect((await call("POST", "/eco/sync-shipments")).status).toBe(403);
  });

  it("the old reconcile route is gone", async () => {
    expect((await call("POST", "/eco/reconcile-orders")).status).toBe(404);
  });
});

describe("ZR webhook registration", () => {
  it("is for ZR Express companies only — refused before any call", async () => {
    const res = await call("POST", "/eco/webhook/register");
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).code).toBe("OPERATION_NOT_SUPPORTED");
    expect(server.requests).toHaveLength(0);
  });
});

describe("the inbox", () => {
  it("shows what each event became, the shipment it was recorded on and its order", async () => {
    const shipment = await shipmentAt("o1", "yal", "yal-1");
    await d1.db.insert(schema.webhookEvents).values(yalidineEvent("w1", "yal-1", "Livré", { result: "ok", shipmentId: shipment, tracking: "yal-1", attempts: 1, processedAt: T0 }));
    await d1.db.insert(schema.webhookEvents).values(yalidineEvent("w2", "yal-2", "Livré", { result: "error", attempts: 2, nextAttemptAt: "2026-10-14T09:00:00.000Z", errorMsg: "boom", createdAt: "2026-10-14T08:05:00.000Z" }));
    const { data } = (await (await call("GET", "/yal/webhook/events")).json()) as any;
    expect(data.total).toBe(2);
    expect(data.events.find((e: any) => e.id === "w1")).toMatchObject({ result: "ok", shipmentId: shipment, orderId: "o1", orderNumber: "ORD-o1", attempts: 1, nextAttemptAt: null });
    expect(data.events.find((e: any) => e.id === "w2")).toMatchObject({ result: "error", attempts: 2, nextAttemptAt: "2026-10-14T09:00:00.000Z", errorMsg: "boom", orderId: null });
    expect(JSON.stringify(data)).not.toContain("rawPayload");

    const errors = ((await (await call("GET", "/yal/webhook/events?result=error")).json()) as any).data;
    expect(errors.events.map((e: any) => e.id)).toEqual(["w2"]);
  });

  it("an event is processed again by hand, and recorded once its parcel exists", async () => {
    await d1.db.insert(schema.webhookEvents).values(yalidineEvent("w1", "yal-9", "Livré", { result: "unmatched", attempts: 1, processedAt: T0 }));
    const shipment = await shipmentAt("o1", "yal", "yal-9");
    const res = await call("POST", "/yal/webhook/events/w1/retry");
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).data).toEqual({ result: "ok", errorMsg: null, shipmentId: shipment });
    expect((await d1.db.select().from(schema.shipments).where(eq(schema.shipments.id, shipment)).get())!.deliveredAt).not.toBeNull();
    expect((await d1.db.select().from(schema.webhookEvents).where(eq(schema.webhookEvents.id, "w1")).get())!.attempts).toBe(1);
  });

  it("only an event that went wrong goes back in the queue, with its tries starting over", async () => {
    const results = ["ok", "ignored", "pending", "deferred_settlement", "error", "dead", "unmatched", "unknown_status", "unmapped"];
    for (const [i, result] of results.entries()) {
      await d1.db.insert(schema.webhookEvents).values(yalidineEvent(`r${i}`, "yal-1", "Livré", { result, attempts: 5 }));
    }
    const requeued: string[] = [];
    for (const [i, result] of results.entries()) if (await requeueInboxEvent(d1.db, `r${i}`)) requeued.push(result);
    expect(requeued).toEqual(["error", "dead", "unmatched", "unknown_status", "unmapped"]);
    const row = await d1.db.select().from(schema.webhookEvents).where(eq(schema.webhookEvents.id, "r5")).get();
    expect(row).toMatchObject({ result: "pending", attempts: 0, errorMsg: null });
    expect(row!.nextAttemptAt).not.toBeNull();
  });

  it("an event already processed, or another company's, is not retried", async () => {
    await d1.db.insert(schema.webhookEvents).values(yalidineEvent("w1", "yal-1", "Livré", { result: "ok" }));
    expect((await call("POST", "/yal/webhook/events/w1/retry")).status).toBe(409);
    expect((await call("POST", "/eco/webhook/events/w1/retry")).status).toBe(404);
    scopes = ["delivery:read"];
    expect((await call("POST", "/yal/webhook/events/w1/retry")).status).toBe(403);
  });
});
