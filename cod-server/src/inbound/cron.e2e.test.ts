/**
 * The five-minute schedule on real D1, with the real adapters over the
 * EcoTrack double (and a NOEST stub): the inbox retried, stale reservations
 * settled, unknown handoffs looked up, pull-only carriers synced — each
 * bounded, oldest first, and stopping a company that throttles.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import * as schema from "@/db/schema";
import { createEcotrackMockServer, type EcotrackMockServer } from "@/carriers/ecotrack/test/mock-server";
import { acceptCarrierHandoff, markHandoffUnknown, reserveCarrierShipment } from "../../../cod-shared/shipments/handoff";
import { recordShipmentEvents } from "../../../cod-shared/shipments/record-events";
import { seedOrder, seedStore } from "@/endpoints/shipments/test/harness";
import { syncShipments } from "@/endpoints/shipments/sync";
import { INBOUND_CRON, LIMITS, expireStaleReservations, lookUpUnknownHandoffs, runInboundCron, sweepInbox, syncPullCarriers } from "./cron";

const dbModule = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/db", () => dbModule);

let d1: TestD1;
let server: EcotrackMockServer;
let commune16: string;
let noestCalls: string[];
const realFetch = globalThis.fetch;
const created = vi.fn(async (_: unknown) => ({ id: "wf" }));
const env = () => ({ DB: d1.raw, CAPI_WORKFLOW: { create: created } }) as never;
const waitUntil = () => {};
const MINUTE = 60_000;

beforeAll(async () => {
  d1 = await createTestD1();
}, 120_000);

afterAll(async () => {
  await d1?.dispose();
});

beforeEach(async () => {
  dbModule.getDb.mockReturnValue(d1.db);
  created.mockClear();
  server = createEcotrackMockServer();
  noestCalls = [];
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    if (String(url).startsWith(server.baseUrl)) return server.fetch(url, init);
    noestCalls.push(String(url));
    return Response.json({});
  }) as typeof fetch;
  commune16 = await seedStore(d1.db, server);
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

const row = (id: string) => d1.db.select().from(schema.shipments).where(eq(schema.shipments.id, id)).get();

/** A parcel the EcoTrack double holds, for one of our orders. */
async function parcelAtEcotrack(reference: string): Promise<string> {
  const query = new URLSearchParams({ reference, nom_client: "K", telephone: "0551234567", adresse: "Rue 1", code_wilaya: "16", commune: "Alger", montant: "1900", produit: "x", type: "1", stop_desk: "0" });
  const res = await server.fetch(`${server.baseUrl}/api/v1/create/order?${query}`, { method: "POST", headers: { Authorization: `Bearer ${server.token}` } });
  return ((await res.json()) as { tracking: string }).tracking;
}

async function shipment(orderId: string, companyId: string, state: "submitting" | "unknown" | "accepted", tracking?: string) {
  await seedOrder(d1.db, commune16, { id: orderId });
  const reserved = await reserveCarrierShipment(d1.db, { orderId, companyId, deliveryType: "home", stationCode: null, weight: null, isFragile: null, createdBy: null });
  if (!reserved.ok) throw new Error("reservation failed");
  if (state === "unknown") await markHandoffUnknown(d1.db, reserved.shipmentId, "timeout");
  if (state === "accepted") {
    const t = tracking ?? `T-${orderId}`;
    await acceptCarrierHandoff(d1.db, reserved.shipmentId, { carrierParcelId: t, trackingNumber: t, carrierData: null, labelUrl: null }, { validated: true });
  }
  return reserved.shipmentId;
}

const setTimes = (id: string, times: { createdAt?: string; lastSyncedAt?: string | null }) => d1.db.update(schema.shipments).set(times).where(eq(schema.shipments.id, id));
const ago = (ms: number, now = new Date()) => new Date(now.getTime() - ms).toISOString();

describe("the schedule", () => {
  it("is the one the worker is configured with", () => {
    const config = readFileSync(resolve(__dirname, "../../wrangler.toml.example"), "utf8");
    expect(config).toContain(`"${INBOUND_CRON}"`);
    expect(INBOUND_CRON).toBe("*/5 * * * *");
  });
});

describe("stale reservations", () => {
  it("a reservation still submitting after ten minutes becomes an unknown handoff; a recent one is left alone", async () => {
    const stale = await shipment("o1", "eco", "submitting");
    const fresh = await shipment("o2", "eco", "submitting");
    await setTimes(stale, { createdAt: ago(LIMITS.staleReservationMs + MINUTE) });
    await setTimes(fresh, { createdAt: ago(LIMITS.staleReservationMs - MINUTE) });
    expect(await expireStaleReservations(d1.db)).toEqual([stale]);
    expect((await row(stale))!.handoffState).toBe("unknown");
    expect((await row(fresh))!.handoffState).toBe("submitting");
  });
});

describe("unknown handoffs", () => {
  it("are looked up by order number where the carrier can, and recorded when found", async () => {
    const id = await shipment("o1", "eco", "unknown");
    const tracking = await parcelAtEcotrack("ORD-o1");
    const outcome = await lookUpUnknownHandoffs(d1.db);
    expect(outcome.found).toEqual([id]);
    expect(await row(id)).toMatchObject({ handoffState: "accepted", trackingNumber: tracking });
  });

  it("one not found is looked up again only after a while", async () => {
    const id = await shipment("o1", "eco", "unknown");
    expect((await lookUpUnknownHandoffs(d1.db)).notFound).toEqual([id]);
    expect((await row(id))!.lastSyncedAt).not.toBeNull();
    const calls = server.requests.length;
    expect(await lookUpUnknownHandoffs(d1.db)).toEqual({ found: [], notFound: [], failed: [] });
    expect(server.requests.length).toBe(calls);
    expect((await lookUpUnknownHandoffs(d1.db, new Date(Date.now() + LIMITS.lookupEveryMs + MINUTE))).notFound).toEqual([id]);
  });

  it("a carrier that cannot search by order number is not asked", async () => {
    await shipment("o1", "zr", "unknown");
    expect(await lookUpUnknownHandoffs(d1.db)).toEqual({ found: [], notFound: [], failed: [] });
    expect(noestCalls).toHaveLength(0);
  });

  it("a lookup that fails is counted and waits like one not found", async () => {
    const id = await shipment("o1", "eco", "unknown");
    server.override("/api/v1/get/orders", () => new Response("{}", { status: 503 }));
    expect((await lookUpUnknownHandoffs(d1.db)).failed).toEqual([id]);
    expect((await row(id))!.lastSyncedAt).not.toBeNull();
  });

  it("at most a bounded number per run, the longest waiting first", async () => {
    const ids: string[] = [];
    for (let i = 0; i < LIMITS.lookups + 2; i++) {
      const id = await shipment(`u${i}`, "eco", "unknown");
      await setTimes(id, { lastSyncedAt: ago((LIMITS.lookups + 2 - i) * LIMITS.lookupEveryMs) });
      ids.push(id);
    }
    const outcome = await lookUpUnknownHandoffs(d1.db);
    expect(outcome.notFound).toEqual(ids.slice(0, LIMITS.lookups));
  });
});

describe("pull-only carriers", () => {
  it("open shipments are synced from the carrier's history; a delivery starts its conversion", async () => {
    const t1 = await parcelAtEcotrack("ORD-o1");
    const t2 = await parcelAtEcotrack("ORD-o2");
    const a = await shipment("o1", "eco", "accepted", t1);
    const b = await shipment("o2", "eco", "accepted", t2);
    server.parcel(t2)!.activity.push({ date: "2026-10-14", time: "16:00:00", status: "livred", station: "" });
    const { synced, stopped } = await syncPullCarriers(env(), waitUntil);
    expect(synced.sort()).toEqual([a, b].sort());
    expect(stopped).toEqual([]);
    expect((await row(b))!.deliveredAt).not.toBeNull();
    expect((await row(a))!.lastSyncedAt).not.toBeNull();
    expect(created).toHaveBeenCalledTimes(1);
    expect(created.mock.calls[0][0]).toMatchObject({ params: { orderId: "o2", stage: "delivered" } });
  });

  it("closed shipments, recently synced ones and webhook carriers are left alone", async () => {
    const closed = await shipment("o1", "eco", "accepted", await parcelAtEcotrack("ORD-o1"));
    await recordShipmentEvents(d1.db, closed, [{ source: "webhook", status: { vocabulary: "activity", value: "livred" }, interpretation: { kind: "milestone", milestone: "delivered" }, occurredAt: "2026-10-14T10:00:00.000Z" }]);
    const recent = await shipment("o2", "eco", "accepted", await parcelAtEcotrack("ORD-o2"));
    await setTimes(recent, { lastSyncedAt: ago(LIMITS.syncEveryMs - MINUTE) });
    await shipment("o3", "yal", "accepted");
    const pending = await shipment("o4", "eco", "unknown");
    expect((await syncPullCarriers(env(), waitUntil)).synced).toEqual([]);
    expect(server.callsFor("/api/v1/get/tracking/info")).toHaveLength(0);
    expect((await row(pending))!.lastSyncedAt).toBeNull();
  });

  it("a company that throttles stops for this run; the others are still synced", async () => {
    const eco = await shipment("o1", "eco", "accepted", await parcelAtEcotrack("ORD-o1"));
    const noest = await shipment("o2", "noest", "accepted");
    server.override("/api/v1/get/tracking/info", () => new Response("{}", { status: 429 }));
    const { synced, stopped } = await syncPullCarriers(env(), waitUntil);
    expect(stopped).toContain("eco");
    expect(synced).toContain(noest);
    expect((await row(eco))!.lastSyncedAt).toBeNull();
    expect(noestCalls.some((u) => u.includes("noest"))).toBe(true);
  });

  it("at most a bounded number per company per run, the longest unsynced first", async () => {
    const ids: string[] = [];
    for (let i = 0; i < LIMITS.syncPerCompany + 2; i++) {
      const id = await shipment(`s${i}`, "eco", "accepted", await parcelAtEcotrack(`ORD-s${i}`));
      await setTimes(id, { lastSyncedAt: ago((LIMITS.syncPerCompany + 2 - i) * LIMITS.syncEveryMs) });
      ids.push(id);
    }
    const { synced } = await syncPullCarriers(env(), waitUntil);
    expect(synced).toEqual(ids.slice(0, LIMITS.syncPerCompany));
  });

  it("handoffs not yet accepted never take a parcel's place in the budget", async () => {
    for (let i = 0; i < LIMITS.syncPerCompany; i++) await shipment(`u${i}`, "eco", "unknown");
    const real = await shipment("real", "eco", "accepted", await parcelAtEcotrack("ORD-real"));
    await setTimes(real, { lastSyncedAt: ago(LIMITS.syncEveryMs + MINUTE) });
    expect((await syncPullCarriers(env(), waitUntil)).synced).toEqual([real]);
  });

  it("histories are read in the carrier's own batches", async () => {
    const ids = [await shipment("b1", "noest", "accepted"), await shipment("b2", "noest", "accepted"), await shipment("b3", "noest", "accepted")];
    const batches: string[][] = [];
    const carrier = {
      capabilities: { historyBatch: 2 } as never,
      interpret: () => ({ kind: "progress" as const }),
      fetchHistory: async (refs: Array<{ carrierParcelId: string }>) => {
        batches.push(refs.map((r) => r.carrierParcelId));
        return new Map(refs.map((r) => [r.carrierParcelId, [{ match: { carrierParcelId: r.carrierParcelId }, status: { vocabulary: "event", value: "en_hub" }, reason: null, occurredAt: "2026-10-14T10:00:00.000Z", raw: {} }]]));
      },
    };
    const rows = await Promise.all(ids.map(row));
    const recorded = await syncShipments(d1.db, carrier as never, rows as never);
    expect(batches).toEqual([["T-b1", "T-b2"], ["T-b3"]]);
    expect([...recorded.values()].map((r) => r.recorded)).toEqual([1, 1, 1]);
  });

  it("an inactive company, or one without credentials, is not synced", async () => {
    await shipment("o1", "off", "accepted");
    await shipment("o2", "unconnected", "accepted");
    expect((await syncPullCarriers(env(), waitUntil)).synced).toEqual([]);
    expect(server.requests).toHaveLength(0);
  });
});

describe("the inbox", () => {
  it("processes the events that are due, and only those", async () => {
    const due = { id: "due", provider: "yalidine", eventId: "e1", companyId: "yal", eventType: "parcel_payment_updated", rawPayload: JSON.stringify({ type: "parcel_payment_updated", event: { event_id: "e1", occurred_at: "2026-10-14 10:00:00", data: {} } }), result: "error", attempts: 1, nextAttemptAt: ago(MINUTE), createdAt: ago(10 * MINUTE) };
    await d1.db.insert(schema.webhookEvents).values(due);
    await d1.db.insert(schema.webhookEvents).values({ ...due, id: "later", eventId: "e2", nextAttemptAt: new Date(Date.now() + 10 * MINUTE).toISOString() });
    const outcomes = await sweepInbox(env(), waitUntil);
    expect(outcomes.map((o) => [o.id, o.result])).toEqual([["due", "deferred_settlement"]]);
    expect((await d1.db.select().from(schema.webhookEvents).where(eq(schema.webhookEvents.id, "later")).get())!.result).toBe("error");
  });
});

describe("one run", () => {
  it("does every pass, and one failing never stops the others", async () => {
    const stale = await shipment("o1", "eco", "submitting");
    await setTimes(stale, { createdAt: ago(LIMITS.staleReservationMs + MINUTE) });
    const pull = await shipment("o2", "eco", "accepted", await parcelAtEcotrack("ORD-o2"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    // The first read of the run is the inbox pass's.
    vi.spyOn(d1.db, "select").mockImplementationOnce(() => {
      throw new Error("inbox read failed");
    });
    await runInboundCron(env(), waitUntil);
    vi.restoreAllMocks();
    expect(error).toHaveBeenCalledWith(expect.stringContaining("inbox pass failed"), "inbox read failed");
    expect((await row(stale))!.handoffState).toBe("unknown");
    expect((await row(pull))!.lastSyncedAt).not.toBeNull();
  });
});
