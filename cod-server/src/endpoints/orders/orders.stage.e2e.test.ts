/**
 * The order list and the analytics by stage, through the real routes on real
 * D1: each order carries the stage the merchant sees and whether its delivery
 * needs them; the list filters on both; the counts add up to the orders.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import type { AppContext } from "@/types";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import * as schema from "@/db/schema";
import { createEcotrackMockServer, type EcotrackMockServer } from "@/carriers/ecotrack/test/mock-server";
import { recordShipmentEvents } from "../../../../cod-shared/shipments/record-events";
import analyticsRouter from "../analytics/routes";
import customersRouter from "../customers/routes";
import driversRouter from "../drivers/routes";
import { jsonRequest, seedOrder, seedStore, shipmentsApp, T0 } from "../shipments/test/harness";

const dbModule = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/db", () => dbModule);

let d1: TestD1;
let app: OpenAPIHono<AppContext>;
let server: EcotrackMockServer;
let scopes: string[] = [];
const realFetch = globalThis.fetch;

beforeAll(async () => {
  d1 = await createTestD1();
  app = shipmentsApp(d1, () => scopes, { "/api/analytics": analyticsRouter, "/api/customers": customersRouter, "/api/drivers": driversRouter });
}, 120_000);

afterAll(async () => {
  await d1?.dispose();
});

const call = (method: string, path: string, body?: unknown) => jsonRequest(app, method, path, body);
const json = async (res: Response) => (await res.json()) as any;
const list = async (query = "") => (await json(await call("GET", `/api/orders${query}`))).data as any[];
const ids = (rows: any[]) => rows.map((r) => r.id).sort();

beforeEach(async () => {
  dbModule.getDb.mockReturnValue(d1.db);
  scopes = ["orders:read", "orders:assign", "delivery:dispatch", "dashboard:view", "customers:read", "delivery:read"];
  server = createEcotrackMockServer();
  globalThis.fetch = ((url: string | URL, init?: RequestInit) => server.fetch(url, init)) as typeof fetch;
  const commune = await seedStore(d1.db, server);
  await d1.db.insert(schema.drivers).values({ id: "dr1", firstName: "Amine", lastName: "Bouzid", phone: "0661111111", createdAt: T0, updatedAt: T0 });
  for (const [id, status] of [["fresh", "new"], ["waiting", "ready"], ["dropped", "cancelled"], ["carried", "ready"], ["driven", "ready"], ["lost", "ready"]] as const) {
    await seedOrder(d1.db, commune, { id, status });
  }
  await call("POST", "/api/orders/carried/shipment", { kind: "carrier", companyId: "eco-manual" });
  const driven = (await json(await call("POST", "/api/orders/driven/shipment", { kind: "driver", driverId: "dr1" }))).data.shipment.id;
  await recordShipmentEvents(d1.db, driven, [
    { source: "merchant", status: { vocabulary: "driver", value: "delivered" }, interpretation: { kind: "milestone", milestone: "delivered" }, occurredAt: new Date().toISOString() },
  ]);
  server.override("/api/v1/create/order", () => new Response("{}", { status: 500 }));
  await call("POST", "/api/orders/lost/shipment", { kind: "carrier", companyId: "eco" });
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("the order list", () => {
  it("each order carries its stage, whether it needs attention, and its shipment", async () => {
    const rows = new Map((await list()).map((r) => [r.id, r]));
    expect(Object.fromEntries([...rows].map(([id, r]) => [id, [r.stage, r.needsAttention, r.shipmentId !== null]]))).toEqual({
      fresh: ["new", false, false],
      waiting: ["ready_to_ship", false, false],
      dropped: ["cancelled", false, false],
      carried: ["in_transit", false, true],
      driven: ["delivered", false, true],
      lost: ["handoff_pending", true, true],
    });
    expect(rows.get("driven")).toMatchObject({ status: "ready", driverName: "Amine Bouzid" });
    expect(rows.get("carried")!.driverName).toBeNull();
  });

  it("filters by stage, by attention, and by both", async () => {
    expect(ids(await list("?stage=in_transit"))).toEqual(["carried"]);
    expect(ids(await list("?stage=ready_to_ship"))).toEqual(["waiting"]);
    expect(ids(await list("?stage=delivered"))).toEqual(["driven"]);
    expect(ids(await list("?attention=true"))).toEqual(["lost"]);
    expect(ids(await list("?attention=false"))).toEqual(["carried", "driven", "dropped", "fresh", "waiting"]);
    expect(ids(await list("?stage=handoff_pending&attention=false"))).toEqual([]);
    expect(ids(await list("?status=ready&stage=in_transit"))).toEqual(["carried"]);
  });

  it("filters on several stages at once — a merchant's work queue", async () => {
    expect(ids(await list("?stage=new,ready_to_ship"))).toEqual(["fresh", "waiting"]);
    expect(ids(await list("?stage=in_transit,handoff_pending,delivered"))).toEqual(["carried", "driven", "lost"]);
  });

  it("shows each order's delivery at a glance: who carries it and its tracking number", async () => {
    const rows = new Map((await list()).map((r) => [r.id, r]));
    const carried = (await d1.db.select().from(schema.shipments).all()).find((s) => s.orderId === "carried")!;
    expect(rows.get("carried")).toMatchObject({ shipmentKind: "carrier", carrierName: "Packers (manual)", trackingNumber: carried.trackingNumber });
    const detail = (await json(await call("GET", "/api/orders/carried"))).data;
    expect(detail.shipment).toMatchObject({ kind: "carrier", carrierName: "Packers (manual)", trackingNumber: carried.trackingNumber });
    expect(rows.get("driven")).toMatchObject({ shipmentKind: "driver", carrierName: null, trackingNumber: null });
    expect(rows.get("waiting")).toMatchObject({ shipmentKind: null, carrierName: null, trackingNumber: null });
  });

  it("filters by who carries it and by order type, and finds an order by its parcel's tracking number", async () => {
    expect(ids(await list("?kind=carrier"))).toEqual(["carried", "lost"]);
    expect(ids(await list("?kind=driver"))).toEqual(["driven"]);
    await d1.db.update(schema.orders).set({ orderType: "offline" }).where(eq(schema.orders.id, "fresh"));
    expect(ids(await list("?orderType=offline"))).toEqual(["fresh"]);
    const tracking = (await d1.db.select().from(schema.shipments).all()).find((s) => s.orderId === "carried")!.trackingNumber!;
    expect(ids(await list(`?search=${tracking}`))).toEqual(["carried"]);
  });

  it("pages with nextCursor until the last page", async () => {
    const first = await json(await call("GET", "/api/orders?limit=4"));
    expect(first.data).toHaveLength(4);
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = await json(await call("GET", `/api/orders?limit=4&cursor=${first.nextCursor}`));
    expect(second.data).toHaveLength(2);
    expect(second.nextCursor).toBeNull();
    expect(new Set([...first.data, ...second.data].map((r: any) => r.id)).size).toBe(6);
  });

  it("refuses a stage or attention value it does not know", async () => {
    expect((await call("GET", "/api/orders?stage=assigned")).status).toBe(400);
    expect((await call("GET", "/api/orders?attention=yes")).status).toBe(400);
  });
});

describe("orders by stage", () => {
  it("counts each stage that has orders, and how many need attention", async () => {
    const res = await call("GET", "/api/analytics/order-stages");
    expect(res.status).toBe(200);
    const { data } = await json(res);
    expect(Object.fromEntries(data.stages.map((s: any) => [s.stage, s.count]))).toEqual({
      new: 1,
      ready_to_ship: 1,
      cancelled: 1,
      in_transit: 1,
      delivered: 1,
      handoff_pending: 1,
    });
    expect(data.needsAttention).toBe(1);
  });

  it("is for whoever reads the orders or the dashboard", async () => {
    for (const allowed of [["orders:read"], ["dashboard:view"]]) {
      scopes = allowed;
      expect((await call("GET", "/api/analytics/order-stages")).status, allowed[0]).toBe(200);
    }
    scopes = ["customers:read"];
    expect((await call("GET", "/api/analytics/order-stages")).status).toBe(403);
  });

  it("the old counts by order status are gone", async () => {
    expect((await call("GET", "/api/analytics/dashboard-stats")).status).toBe(404);
  });
});

describe("the stage wherever an order is shown", () => {
  it("in a customer's order history — what came back is plain to see", async () => {
    const { data } = await json(await call("GET", "/api/customers/c1/orders"));
    expect(Object.fromEntries(data.map((o: any) => [o.id, o.stage]))).toEqual({
      fresh: "new",
      waiting: "ready_to_ship",
      dropped: "cancelled",
      carried: "in_transit",
      driven: "delivered",
      lost: "handoff_pending",
    });
  });

  it("in the driver's recent shipments", async () => {
    const { data } = await json(await call("GET", "/api/drivers/dr1"));
    expect(data.recentShipments.map((s: any) => [s.orderId, s.stage])).toEqual([["driven", "delivered"]]);
  });
});
