/**
 * The order list and the analytics by stage, through the real routes on real
 * D1: each order carries the stage the merchant sees and whether its delivery
 * needs them; the list filters on both; the counts add up to the orders.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { AppContext } from "@/types";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import * as schema from "@/db/schema";
import { createEcotrackMockServer, type EcotrackMockServer } from "@/carriers/ecotrack/test/mock-server";
import { recordShipmentEvents } from "../../../../cod-shared/shipments/record-events";
import analyticsRouter from "../analytics/routes";
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
  app = shipmentsApp(d1, () => scopes, { "/api/analytics": analyticsRouter });
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
  scopes = ["orders:read", "orders:assign", "delivery:dispatch", "dashboard:view"];
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
    expect(rows.get("driven")).toMatchObject({ status: "ready", driverName: "Amine Bouzid", driverId: null });
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

  it("refuses a stage or attention value it does not know", async () => {
    expect((await call("GET", "/api/orders?stage=assigned")).status).toBe(400);
    expect((await call("GET", "/api/orders?attention=yes")).status).toBe(400);
  });
});

describe("orders by stage", () => {
  it("counts each stage that has orders, and how many need attention — a legacy order has no stage", async () => {
    await d1.db.insert(schema.orders).values({ id: "legacy", orderNumber: "ORD-legacy", customerId: "c1", customerName: "K", phone: "0551234567", price: 1000, status: "delivered", createdAt: T0, updatedAt: T0 });
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

  it("needs the dashboard permission", async () => {
    scopes = ["orders:read"];
    expect((await call("GET", "/api/analytics/order-stages")).status).toBe(403);
  });
});
