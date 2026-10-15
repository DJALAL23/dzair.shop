/**
 * The store's own driver, through the real routes on real D1: an order is
 * given to a driver as a shipment (one or a hundred at once), only by someone
 * who may assign orders, only while it is ready and the driver takes orders;
 * it can be taken back until it leaves; and a driver or a carrier company
 * that has carried parcels keeps them — it is never deleted from under them.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import type { AppContext } from "@/types";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import * as schema from "@/db/schema";
import { createEcotrackMockServer, type EcotrackMockServer } from "@/carriers/ecotrack/test/mock-server";
import { handOffToDriver } from "../../../../cod-shared/shipments/handoff";
import { getShipmentWithEvents } from "../../../../cod-shared/shipments/queries";
import { recordShipmentEvents } from "../../../../cod-shared/shipments/record-events";
import driversRouter from "../drivers/routes";
import deliveryCompaniesRouter from "../delivery-companies/routes";
import { driverFor, handOffToDriverOrders } from "./driver-handoff";
import { jsonRequest, seedOrder, seedStore, shipmentsApp, T0, type OrderSeed } from "./test/harness";

const dbModule = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/db", () => dbModule);

let d1: TestD1;
let app: OpenAPIHono<AppContext>;
let server: EcotrackMockServer;
let commune16: string;
let scopes: string[] = [];
const realFetch = globalThis.fetch;

beforeAll(async () => {
  d1 = await createTestD1();
  app = shipmentsApp(d1, () => scopes, { "/api/drivers": driversRouter, "/api/delivery-companies": deliveryCompaniesRouter });
}, 120_000);

afterAll(async () => {
  await d1?.dispose();
});

beforeEach(async () => {
  dbModule.getDb.mockReturnValue(d1.db);
  scopes = ["orders:assign", "orders:read", "delivery:dispatch", "delivery:manage", "delivery:delete"];
  server = createEcotrackMockServer();
  globalThis.fetch = ((url: string | URL, init?: RequestInit) => server.fetch(url, init)) as typeof fetch;
  commune16 = await seedStore(d1.db, server);
  await d1.db.insert(schema.drivers).values([
    { id: "dr1", firstName: "Amine", lastName: "B", phone: "0661111111", createdAt: T0, updatedAt: T0 },
    { id: "dr-off", firstName: "Off", lastName: "Duty", phone: "0662222222", status: "inactive", createdAt: T0, updatedAt: T0 },
  ]);
  await d1.db.insert(schema.driverCompensations).values({ id: "comp1", driverId: "dr1", wilayaId: 16, feePerDelivery: 300, createdAt: T0, updatedAt: T0 });
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

const seed = (s: OrderSeed) => seedOrder(d1.db, commune16, s);
const call = (method: string, path: string, body?: unknown) => jsonRequest(app, method, path, body);
const giveToDriver = (orderId: string, body: Record<string, unknown> = {}) => call("POST", `/api/orders/${orderId}/shipment`, { kind: "driver", driverId: "dr1", ...body });
const codeOf = async (res: Response) => ((await res.json()) as any).code;
const shipmentOf = (orderId: string) => d1.db.select().from(schema.shipments).where(eq(schema.shipments.orderId, orderId)).get();
const activity = (action: string) => d1.db.select().from(schema.activityLogs).where(eq(schema.activityLogs.action, action)).all();
const deliver = (shipmentId: string) =>
  recordShipmentEvents(d1.db, shipmentId, [
    { source: "merchant", status: { vocabulary: "driver", value: "delivered" }, interpretation: { kind: "milestone", milestone: "delivered" }, occurredAt: new Date().toISOString() },
  ]);
const outForDelivery = (shipmentId: string) =>
  recordShipmentEvents(d1.db, shipmentId, [
    { source: "merchant", status: { vocabulary: "driver", value: "out_for_delivery" }, interpretation: { kind: "milestone", milestone: "out_for_delivery" }, occurredAt: new Date().toISOString() },
  ]);

describe("giving an order to the driver", () => {
  it("is accepted at once, with the cash to collect and the driver's fee for the wilaya frozen", async () => {
    await seed({ id: "o1", price: 1500, deliveryFee: 400 });
    const res = await giveToDriver("o1");
    expect(res.status).toBe(201);
    const { data } = (await res.json()) as any;
    expect(data).toMatchObject({ orderId: "o1", orderNumber: "ORD-o1", outcome: "accepted" });
    expect(data.shipment).toMatchObject({ kind: "driver", driverId: "dr1", companyId: null, handoffState: "accepted", codAmount: 1900, driverFee: 300, deliveryType: "home" });
    expect(data.shipment.actions).toEqual(["void", "report"]);
    expect(data).not.toHaveProperty("validationError");

    const shipment = await shipmentOf("o1");
    expect(shipment).toMatchObject({ createdBy: "staff_1" });
    expect((await getShipmentWithEvents(d1.db, shipment!.id))!.events.map((e) => [e.source, e.providerStatus, e.actorId])).toEqual([["handoff", "assigned_to_driver", "staff_1"]]);
    const [logged] = await activity("order.driver_assigned");
    expect(logged).toMatchObject({ entityType: "order", entityId: "o1", entityLabel: "ORD-o1" });
    expect(JSON.parse(logged.metadata!)).toEqual({ driverId: "dr1", shipmentId: shipment!.id });

    const order = await d1.db.select().from(schema.orders).where(eq(schema.orders.id, "o1")).get();
    expect(order).toMatchObject({ status: "ready" });
  });

  it("takes the customer's delivery type and desk, unless told otherwise", async () => {
    await seed({ id: "o1", deliveryType: "stop_desk", stationCode: "16A" });
    await seed({ id: "o2", deliveryType: "stop_desk", stationCode: "16A" });
    await giveToDriver("o1");
    await giveToDriver("o2", { deliveryType: "home" });
    expect(await shipmentOf("o1")).toMatchObject({ deliveryType: "stop_desk", stationCode: "16A" });
    expect(await shipmentOf("o2")).toMatchObject({ deliveryType: "home", stationCode: null });
  });

  it("needs the assignment permission — and a carrier handoff the dispatch one", async () => {
    await seed({ id: "o1" });
    scopes = ["delivery:dispatch"];
    const res = await giveToDriver("o1");
    expect(res.status).toBe(403);
    expect(await shipmentOf("o1")).toBeUndefined();

    scopes = ["orders:assign"];
    expect((await call("POST", "/api/orders/o1/shipment", { kind: "carrier", companyId: "eco" })).status).toBe(403);
    expect(await shipmentOf("o1")).toBeUndefined();
    expect(server.requests).toHaveLength(0);
    expect((await call("POST", "/api/shipments/driver-bulk", { driverId: "dr1", orderIds: ["o1"] })).status).toBe(200);

    scopes = ["delivery:dispatch"];
    expect((await call("POST", "/api/shipments/driver-bulk", { driverId: "dr1", orderIds: ["o1"] })).status).toBe(403);
  });

  it("refuses an order that is not ready, or already has a shipment — creating nothing", async () => {
    await seed({ id: "o1", status: "confirmed" });
    const notReady = await giveToDriver("o1");
    expect(notReady.status).toBe(422);
    expect(await codeOf(notReady)).toBe("ORDER_NOT_READY_FOR_HANDOFF");
    expect(await shipmentOf("o1")).toBeUndefined();

    await seed({ id: "o2" });
    expect((await giveToDriver("o2")).status).toBe(201);
    const twice = await giveToDriver("o2");
    expect(twice.status).toBe(409);
    expect(await codeOf(twice)).toBe("ORDER_HAS_SHIPMENT");
    expect((await call("POST", "/api/orders/o2/shipment", { kind: "carrier", companyId: "eco" })).status).toBe(409);
    expect(await d1.db.select().from(schema.shipments).all()).toHaveLength(1);
  });

  it("refuses a driver who does not exist or is inactive", async () => {
    await seed({ id: "o1" });
    expect((await giveToDriver("o1", { driverId: "nobody" })).status).toBe(404);
    const off = await giveToDriver("o1", { driverId: "dr-off" });
    expect(off.status).toBe(422);
    expect(await codeOf(off)).toBe("DRIVER_UNAVAILABLE");
    expect(await shipmentOf("o1")).toBeUndefined();
  });

  it("a driver deactivated or deleted after the check never receives the order", async () => {
    await seed({ id: "o1" });
    await d1.db.update(schema.drivers).set({ status: "inactive" }).where(eq(schema.drivers.id, "dr1"));
    expect(await handOffToDriver(d1.db, { orderId: "o1", driverId: "dr1", deliveryType: "home", stationCode: null, createdBy: null })).toEqual({ ok: false, reason: "driver_unavailable" });
    expect(await handOffToDriver(d1.db, { orderId: "o1", driverId: "gone", deliveryType: "home", stationCode: null, createdBy: null })).toEqual({ ok: false, reason: "driver_unavailable" });
    expect(await shipmentOf("o1")).toBeUndefined();

    await d1.db.update(schema.orders).set({ status: "confirmed" }).where(eq(schema.orders.id, "o1"));
    expect(await handOffToDriver(d1.db, { orderId: "o1", driverId: "gone", deliveryType: "home", stationCode: null, createdBy: null })).toEqual({ ok: false, reason: "order_not_ready" });
  });

  it("…and the request that checked the driver first is told so", async () => {
    await seed({ id: "o1" });
    const driver = await driverFor(d1.db, "dr1");
    await d1.db.update(schema.drivers).set({ status: "inactive" }).where(eq(schema.drivers.id, "dr1"));
    const [result] = await handOffToDriverOrders(d1.db, driver, [{ orderId: "o1" }], null);
    expect(result).toMatchObject({ orderId: "o1", outcome: "refused" });
    expect(result.outcome === "refused" && result.error.code).toBe("DRIVER_UNAVAILABLE");
  });

  it("the same order given twice at once is given once", async () => {
    await seed({ id: "o1" });
    const results = await Promise.all([giveToDriver("o1"), giveToDriver("o1"), call("POST", "/api/orders/o1/shipment", { kind: "carrier", companyId: "eco" })]);
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(await d1.db.select().from(schema.shipments).all()).toHaveLength(1);
  });

  it("the old assignment routes are gone", async () => {
    await seed({ id: "o1" });
    expect((await call("PATCH", "/api/orders/o1/assign-driver", { driverId: "dr1" })).status).toBe(404);
    expect((await call("PATCH", "/api/orders/o1/unassign")).status).toBe(404);
  });
});

describe("giving many orders to the driver", () => {
  it("one result per order, in the order asked, with the same rules as one", async () => {
    await seed({ id: "o1" });
    await seed({ id: "o2", status: "new" });
    await seed({ id: "o3" });
    const res = await call("POST", "/api/shipments/driver-bulk", { driverId: "dr1", orderIds: ["o1", "o2", "missing", "o3", "o1"] });
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as any;
    expect(data.results.map((r: any) => [r.orderId, r.outcome, r.error?.code ?? null])).toEqual([
      ["o1", "accepted", null],
      ["o2", "refused", "ORDER_NOT_READY_FOR_HANDOFF"],
      ["missing", "refused", "ORDER_NOT_FOUND"],
      ["o3", "accepted", null],
      ["o1", "refused", "ORDER_HAS_SHIPMENT"],
    ]);
    expect(data.summary).toEqual({ accepted: 2, unknown: 0, refused: 3 });
    expect(data.results[0].shipment).toMatchObject({ kind: "driver", driverFee: 300 });
    expect(await d1.db.select().from(schema.shipments).all()).toHaveLength(2);
  });

  it("an inactive or unknown driver refuses the whole request", async () => {
    await seed({ id: "o1" });
    expect((await call("POST", "/api/shipments/driver-bulk", { driverId: "dr-off", orderIds: ["o1"] })).status).toBe(422);
    expect((await call("POST", "/api/shipments/driver-bulk", { driverId: "nobody", orderIds: ["o1"] })).status).toBe(404);
    expect((await call("POST", "/api/shipments/driver-bulk", { driverId: "dr1", orderIds: [] })).status).toBe(400);
    expect(await shipmentOf("o1")).toBeUndefined();
  });

  it("gives the same result as one at a time", async () => {
    await seed({ id: "a1", price: 2000, deliveryFee: 500, wilayaId: 16 });
    await seed({ id: "b1", price: 2000, deliveryFee: 500, wilayaId: 16 });
    await giveToDriver("a1");
    await call("POST", "/api/shipments/driver-bulk", { driverId: "dr1", orderIds: ["b1"] });
    const pick = ({ kind, driverId, handoffState, codAmount, driverFee, deliveryType, stationCode }: NonNullable<Awaited<ReturnType<typeof shipmentOf>>>) =>
      ({ kind, driverId, handoffState, codAmount, driverFee, deliveryType, stationCode });
    expect(pick((await shipmentOf("b1"))!)).toEqual(pick((await shipmentOf("a1"))!));
  });
});

describe("taking an order back from the driver", () => {
  let id: string;
  beforeEach(async () => {
    await seed({ id: "o1" });
    await giveToDriver("o1");
    id = (await shipmentOf("o1"))!.id;
  });

  it("before it leaves: the order is ready for another handoff", async () => {
    const res = await call("POST", `/api/shipments/${id}/void`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).data).toEqual({ orderId: "o1" });
    expect(await shipmentOf("o1")).toBeUndefined();
    const [logged] = await activity("shipment.voided");
    expect(JSON.parse(logged.metadata!)).toMatchObject({ shipmentId: id, kind: "driver", driverId: "dr1", companyId: null });
    expect((await call("POST", "/api/orders/o1/shipment", { kind: "carrier", companyId: "eco-manual" })).status).toBe(201);
  });

  it("needs the assignment permission, checked before anything else", async () => {
    scopes = ["delivery:dispatch"];
    const res = await call("POST", `/api/shipments/${id}/void`);
    expect(res.status).toBe(403);
    await outForDelivery(id);
    expect((await call("POST", `/api/shipments/${id}/void`)).status).toBe(403);
    expect(await shipmentOf("o1")).toBeDefined();
  });

  it("not once it is out for delivery", async () => {
    await outForDelivery(id);
    const res = await call("POST", `/api/shipments/${id}/void`);
    expect(res.status).toBe(409);
    expect(await shipmentOf("o1")).toBeDefined();
  });
});

describe("deleting a driver", () => {
  it("one who never had an order goes", async () => {
    const res = await call("DELETE", "/api/drivers/dr1");
    expect(res.status).toBe(200);
    expect(await d1.db.select().from(schema.drivers).where(eq(schema.drivers.id, "dr1")).get()).toBeUndefined();
  });

  it("one with an order out stays, until the order is taken back", async () => {
    await seed({ id: "o1" });
    await giveToDriver("o1");
    const res = await call("DELETE", "/api/drivers/dr1");
    expect(res.status).toBe(409);
    expect(((await res.json()) as any)).toMatchObject({ code: "DRIVER_HAS_ACTIVE_ORDERS", context: { activeOrderCount: 1 } });
    expect(await d1.db.select().from(schema.drivers).where(eq(schema.drivers.id, "dr1")).get()).toBeDefined();

    await call("POST", `/api/shipments/${(await shipmentOf("o1"))!.id}/void`);
    expect((await call("DELETE", "/api/drivers/dr1")).status).toBe(200);
  });

  it("one with past deliveries stays — set inactive instead", async () => {
    await seed({ id: "o1" });
    await giveToDriver("o1");
    await deliver((await shipmentOf("o1"))!.id);
    const res = await call("DELETE", "/api/drivers/dr1");
    expect(res.status).toBe(409);
    expect(((await res.json()) as any)).toMatchObject({ code: "DRIVER_HAS_SHIPMENTS", context: { shipmentCount: 1 } });
    expect(await d1.db.select().from(schema.drivers).where(eq(schema.drivers.id, "dr1")).get()).toBeDefined();
  });
});

describe("deleting a delivery company", () => {
  const inbox = (id: string, companyId: string) =>
    d1.db.insert(schema.webhookEvents).values({ id, provider: "ecotrack", eventId: id, companyId, eventType: "x", rawPayload: "{}", result: "ok", createdAt: T0 });
  const apiLog = (id: string, companyId: string) =>
    d1.db.insert(schema.companyApiLogs).values({ id, companyId, action: "createShipment", method: "CALL", endpoint: "createShipment", httpStatus: 200, success: true, durationMs: 1, createdAt: T0 });

  it("one that never carried a parcel goes, with its API log and inbox", async () => {
    await inbox("w1", "eco-manual");
    await apiLog("l1", "eco-manual");
    await inbox("w2", "eco");
    const res = await call("DELETE", "/api/delivery-companies/eco-manual");
    expect(res.status).toBe(200);
    expect(await d1.db.select().from(schema.deliveryCompanies).where(eq(schema.deliveryCompanies.id, "eco-manual")).get()).toBeUndefined();
    expect(await d1.db.select().from(schema.webhookEvents).where(eq(schema.webhookEvents.companyId, "eco-manual")).all()).toEqual([]);
    expect(await d1.db.select().from(schema.companyApiLogs).where(eq(schema.companyApiLogs.companyId, "eco-manual")).all()).toEqual([]);
    expect(await d1.db.select().from(schema.webhookEvents).where(eq(schema.webhookEvents.id, "w2")).get()).toBeDefined();
  });

  it("one with a parcel on its way stays, with everything it recorded", async () => {
    await seed({ id: "o1" });
    await call("POST", "/api/orders/o1/shipment", { kind: "carrier", companyId: "eco-manual" });
    await inbox("w1", "eco-manual");
    const res = await call("DELETE", "/api/delivery-companies/eco-manual");
    expect(res.status).toBe(409);
    expect(((await res.json()) as any)).toMatchObject({ code: "COMPANY_HAS_ACTIVE_SHIPMENTS", context: { openShipments: 1, shipments: 1 } });
    expect(await d1.db.select().from(schema.deliveryCompanies).where(eq(schema.deliveryCompanies.id, "eco-manual")).get()).toBeDefined();
    expect(await d1.db.select().from(schema.webhookEvents).where(eq(schema.webhookEvents.id, "w1")).get()).toBeDefined();
    expect(await d1.db.select().from(schema.companyApiLogs).where(eq(schema.companyApiLogs.companyId, "eco-manual")).all()).not.toEqual([]);
  });

  it("one that has delivered parcels stays — deactivate it instead", async () => {
    await seed({ id: "o1" });
    await call("POST", "/api/orders/o1/shipment", { kind: "carrier", companyId: "eco-manual" });
    await deliver((await shipmentOf("o1"))!.id);
    const res = await call("DELETE", "/api/delivery-companies/eco-manual");
    expect(res.status).toBe(409);
    expect(await codeOf(res)).toBe("COMPANY_HAS_SHIPMENTS");
  });

  it("one that does not exist is not found", async () => {
    expect((await call("DELETE", "/api/delivery-companies/nope")).status).toBe(404);
  });
});
