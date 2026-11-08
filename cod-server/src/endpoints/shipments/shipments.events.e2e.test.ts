/**
 * Every shipment fact records its Business Event with it, on real D1
 * (ADR 0016): the handoff, each milestone reached and each failed attempt,
 * the void — once, under the shipment's own revision, with the shipment and
 * its order as the batch left them, whichever surface reported it. Every
 * event read here is held to its catalogue schema (`eventsOf`).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import type { AppContext } from "@/types";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import { makeFaultyDb } from "@/test-utils/faulty-d1";
import { interleaved } from "@/test-utils/interleaved";
import { SYSTEM, eventsOf, staff } from "@/test-utils/events";
import { carrierAuthor } from "@/lib/acting";
import * as schema from "@/db/schema";
import { createEcotrackMockServer, type EcotrackMockServer } from "@/carriers/ecotrack/test/mock-server";
import { acceptCarrierHandoff, handOffToDriver, reserveCarrierShipment, voidShipment } from "../../../../cod-shared/shipments/handoff";
import { recordShipmentEvents, type IncomingShipmentEvent } from "../../../../cod-shared/shipments/record-events";
import { getShipmentWithEvents } from "../../../../cod-shared/shipments/queries";
import { getShipmentTools } from "./ai-tools";
import { syncShipments } from "./sync";
import { jsonRequest, seedOrder, seedStore, shipmentsApp, T0 } from "./test/harness";

const dbModule = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/db", () => dbModule);

let d1: TestD1;
let app: OpenAPIHono<AppContext>;
let server: EcotrackMockServer;
let commune16: string;
const realFetch = globalThis.fetch;
const db = () => d1.db;

beforeAll(async () => {
  d1 = await createTestD1();
  app = shipmentsApp(d1, () => ["*"]);
}, 120_000);

afterAll(async () => d1?.dispose());

beforeEach(async () => {
  dbModule.getDb.mockReturnValue(d1.db);
  server = createEcotrackMockServer();
  globalThis.fetch = ((url: string | URL, init?: RequestInit) => server.fetch(url, init)) as typeof fetch;
  commune16 = await seedStore(d1.db, server);
  await db().insert(schema.drivers).values({ id: "dr1", firstName: "Amine", lastName: "Bensalem", phone: "0661111111", createdAt: T0, updatedAt: T0 });
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

const call = (method: string, path: string, body?: unknown) => jsonRequest(app, method, path, body);
const ready = (id: string) => seedOrder(db(), commune16, { id, status: "ready" });

async function driverShipment(orderId: string) {
  await ready(orderId);
  const [handed] = await handOffToDriver(db(), { orderIds: [orderId], driverId: "dr1", author: staff("u-ada", "Ada") });
  if (!handed.ok) throw new Error(handed.reason);
  return handed.shipmentId;
}

const fact = (value: string, interpretation: IncomingShipmentEvent["interpretation"], minute: number, extra: Partial<IncomingShipmentEvent> = {}): IncomingShipmentEvent => ({
  source: "webhook",
  status: { vocabulary: "test", value },
  interpretation,
  occurredAt: new Date(Date.parse("2026-10-21T08:00:00.000Z") + minute * 60_000).toISOString(),
  ...extra,
});
const milestone = (m: "out_for_delivery" | "delivered" | "return_started" | "returned" | "cancelled") => ({ kind: "milestone" as const, milestone: m });

const typesOf = async (orderId: string) => (await eventsOf(db(), orderId)).map((e) => e.type);

describe("shipment.handed_off", () => {
  it("is recorded for each order the store's driver takes, as who gave them, with the driver", async () => {
    await ready("o1");
    await ready("o2");
    await seedOrder(db(), commune16, { id: "o3", status: "confirmed" });
    const res = await call("POST", "/api/shipments/driver-bulk", { driverId: "dr1", orderIds: ["o1", "o2", "o3"] });
    expect(res.status).toBe(200);

    for (const id of ["o1", "o2"]) {
      const [event] = await eventsOf(db(), id);
      expect(event).toMatchObject({ type: "shipment.handed_off", subjectType: "shipment", actorKind: "staff", actorId: "staff_1", origin: "dashboard" });
      expect(event!.type === "shipment.handed_off" && event!.data).toMatchObject({
        shipment: { kind: "driver", carrier: null, driver: { id: "dr1", name: "Amine Bensalem", phone: "0661111111" }, deliveryType: "home", deliveredAt: null },
        order: { id, status: "ready" },
      });
    }
    expect(await eventsOf(db(), "o3")).toEqual([]);
  });

  it("is recorded once when a carrier's parcel is accepted, however often its acceptance arrives", async () => {
    await ready("o1");
    const reserved = await reserveCarrierShipment(db(), { orderId: "o1", companyId: "eco", deliveryType: "home", stationCode: null, weight: null, isFragile: null, shippingCost: null, returnFee: null, createdBy: null });
    if (!reserved.ok) throw new Error(reserved.reason);
    expect(await eventsOf(db(), "o1")).toEqual([]);

    const parcel = { carrierParcelId: "ECO-1", trackingNumber: "ECO-1", carrierData: null, labelUrl: null };
    expect(await acceptCarrierHandoff(db(), reserved.shipmentId, parcel, { validated: true, author: staff() })).toBe(true);
    expect(await acceptCarrierHandoff(db(), reserved.shipmentId, parcel, { validated: true, author: staff() })).toBe(false);

    const events = await eventsOf(db(), "o1");
    expect(events.map((e) => e.type)).toEqual(["shipment.handed_off"]);
    expect(events[0]!.type === "shipment.handed_off" && events[0]!.data.shipment).toMatchObject({ kind: "carrier", carrier: { companyId: "eco" }, trackingNumber: "ECO-1" });
  });
});

describe("milestones and failed attempts", () => {
  it("each reached records its type at the time it happened, with the reason given", async () => {
    const id = await driverShipment("o1");
    await recordShipmentEvents(db(), id, [
      fact("out", milestone("out_for_delivery"), 10),
      fact("no answer", { kind: "failed_attempt" }, 20, { reason: "Client injoignable" }),
      fact("delivered", milestone("delivered"), 30),
    ], SYSTEM);

    const events = (await eventsOf(db(), "o1")).slice(1);
    expect(events.map((e) => [e.type, e.occurredAt])).toEqual([
      ["shipment.out_for_delivery", "2026-10-21T08:10:00.000Z"],
      ["shipment.delivery_failed", "2026-10-21T08:20:00.000Z"],
      ["shipment.delivered", "2026-10-21T08:30:00.000Z"],
    ]);
    expect(events[1]!.type === "shipment.delivery_failed" && events[1]!.data).toMatchObject({ attempt: 1, reason: "Client injoignable" });
    // Recorded in one batch: each carries the shipment as that batch left it.
    expect(events[2]!.type === "shipment.delivered" && events[2]!.data.shipment).toMatchObject({ deliveredAt: "2026-10-21T08:30:00.000Z", deliveryAttempts: 1 });
  });

  it("are recorded once, however often the same fact is reported", async () => {
    const id = await driverShipment("o1");
    await recordShipmentEvents(db(), id, [fact("delivered", milestone("delivered"), 30)], SYSTEM);
    await recordShipmentEvents(db(), id, [fact("delivered", milestone("delivered"), 30)], SYSTEM);
    await recordShipmentEvents(db(), id, [fact("delivered again", milestone("delivered"), 40)], SYSTEM);
    expect((await typesOf("o1")).filter((t) => t === "shipment.delivered")).toHaveLength(1);
  });

  it("are recorded once when two writers report them at the same moment", async () => {
    const id = await driverShipment("o1");
    const raced = interleaved(db(), () => recordShipmentEvents(db(), id, [fact("Livré", milestone("delivered"), 31)], carrierAuthor({ id: "eco", name: "EcoTrack" }, "carrier_webhook")));
    await recordShipmentEvents(raced, id, [fact("delivered", milestone("delivered"), 30, { source: "merchant" })], staff());
    const delivered = (await eventsOf(db(), "o1")).filter((e) => e.type === "shipment.delivered");
    expect(delivered).toHaveLength(1);
    expect(delivered[0]).toMatchObject({ actorKind: "carrier", origin: "carrier_webhook" });
  });

  it("are not recorded when the facts are not", async () => {
    const id = await driverShipment("o1");
    const faulty = makeFaultyDb(d1.raw, (text) => text.startsWith('insert into "business_events"'));
    await expect(recordShipmentEvents(faulty, id, [fact("delivered", milestone("delivered"), 30)], SYSTEM)).rejects.toThrow("INJECTED FAULT");
    const shipment = await db().select().from(schema.shipments).where(eq(schema.shipments.id, id)).get();
    expect(shipment!.deliveredAt).toBeNull();
    expect(await typesOf("o1")).toEqual(["shipment.handed_off"]);
  });

  it("a return credits the staff member who confirmed it in the stock ledger", async () => {
    await db().update(schema.products).set({ trackInventory: true }).where(eq(schema.products.id, "p1"));
    const id = await driverShipment("o1");
    await recordShipmentEvents(db(), id, [fact("returned", milestone("returned"), 30, { source: "merchant" })], staff("u-ada", "Ada"));
    const [movement] = await db().select().from(schema.stockMovements).where(eq(schema.stockMovements.type, "ORDER_RETURNED")).all();
    expect(movement).toMatchObject({ createdBy: "u-ada", createdByName: "Ada" });
    expect(await typesOf("o1")).toEqual(["shipment.handed_off", "shipment.returned"]);
  });
});

describe("every surface records the same event", () => {
  it("a delivery reported on the dashboard and through an AI agent: same type, their own Actor and Origin", async () => {
    const viaDashboard = await driverShipment("o1");
    const viaAgent = await driverShipment("o2");
    expect((await call("POST", `/api/shipments/${viaDashboard}/events`, { status: "delivered" })).status).toBe(200);
    const tools = getShipmentTools(db(), { DB: d1.raw } as never, { userId: "u-ada", role: "admin", scopes: [], name: "Ada", email: "ada@example.com" }) as unknown as Record<string, { execute: (a: unknown) => Promise<{ success: boolean; error?: string }> }>;
    expect(await tools.reportShipmentEvent!.execute({ shipmentId: viaAgent, status: "delivered" })).toMatchObject({ success: true });

    const [, fromDashboard] = await eventsOf(db(), "o1");
    const [, fromAgent] = await eventsOf(db(), "o2");
    expect(fromDashboard).toMatchObject({ type: "shipment.delivered", actorKind: "staff", actorId: "staff_1", origin: "dashboard" });
    expect(fromAgent).toMatchObject({ type: "shipment.delivered", actorKind: "agent", actorId: "u-ada", origin: "agent" });
  });

  it("what a pull sync reads back is the carrier's, through its sync", async () => {
    await ready("o1");
    const reserved = await reserveCarrierShipment(db(), { orderId: "o1", companyId: "eco", deliveryType: "home", stationCode: null, weight: null, isFragile: null, shippingCost: null, returnFee: null, createdBy: null });
    if (!reserved.ok) throw new Error(reserved.reason);
    await acceptCarrierHandoff(db(), reserved.shipmentId, { carrierParcelId: "ECO-1", trackingNumber: "ECO-1", carrierData: null, labelUrl: null }, { validated: true, author: SYSTEM });
    const row = await db().select().from(schema.shipments).where(eq(schema.shipments.id, reserved.shipmentId)).get();
    const carrier = {
      capabilities: { historyBatch: 10 },
      interpret: () => milestone("delivered"),
      fetchHistory: async () => new Map([["ECO-1", [{ status: { vocabulary: "eco", value: "livred" }, occurredAt: "2026-10-21T09:00:00.000Z", match: {}, reason: null, raw: null }]]]),
    };
    await syncShipments(db(), carrier as never, [row!], carrierAuthor({ id: "eco", name: "EcoTrack" }, "carrier_sync"));

    expect((await eventsOf(db(), "o1")).at(-1)).toMatchObject({ type: "shipment.delivered", actorKind: "carrier", actorId: "eco", actorName: "EcoTrack", origin: "carrier_sync" });
  });
});

describe("shipment.voided", () => {
  it("keeps the shipment as it was, after its row and history are gone", async () => {
    const id = await driverShipment("o1");
    await recordShipmentEvents(db(), id, [fact("no answer", { kind: "failed_attempt" }, 10)], SYSTEM);
    expect((await call("POST", `/api/shipments/${id}/void`)).status).toBe(200);

    expect(await getShipmentWithEvents(db(), id)).toBeNull();
    const voided = (await eventsOf(db(), "o1")).at(-1);
    expect(voided).toMatchObject({ type: "shipment.voided", subjectId: id, actorKind: "staff", origin: "dashboard" });
    expect(voided!.type === "shipment.voided" && voided!.data.shipment).toMatchObject({ id, kind: "driver", deliveryAttempts: 1 });
  });

  it("is not recorded for a shipment that cannot be voided", async () => {
    const id = await driverShipment("o1");
    await recordShipmentEvents(db(), id, [fact("delivered", milestone("delivered"), 30)], SYSTEM);
    expect(await voidShipment(db(), id, SYSTEM)).toMatchObject({ ok: false });
    expect(await typesOf("o1")).toEqual(["shipment.handed_off", "shipment.delivered"]);
  });

  it("is not recorded when a delivery lands between the void's read and its write", async () => {
    const id = await driverShipment("o1");
    const raced = interleaved(db(), () => recordShipmentEvents(db(), id, [fact("delivered", milestone("delivered"), 30)], SYSTEM));
    expect(await voidShipment(raced, id, SYSTEM)).toMatchObject({ ok: false });
    expect(await typesOf("o1")).toEqual(["shipment.handed_off", "shipment.delivered"]);
  });
});
