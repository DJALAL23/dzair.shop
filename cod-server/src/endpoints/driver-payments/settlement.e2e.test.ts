/**
 * Settling with the store's driver, through the real routes on real D1: a
 * delivery credits the driver once; a payment settles each part of a
 * delivered shipment — the cash, the fee — once, even when two payments
 * race; the driver's cash counter always agrees with the shipments still to
 * settle; and an order whose delivery a payment settled is never deleted
 * from under it, while an unsettled one takes its credit back with it.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { SYSTEM } from "@/test-utils/events";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import type { AppContext } from "@/types";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import { interleaved } from "@/test-utils/interleaved";
import * as schema from "@/db/schema";
import { createEcotrackMockServer, type EcotrackMockServer } from "@/carriers/ecotrack/test/mock-server";
import { createDriverPayment } from "../../../../cod-shared/queries/driver-payments";
import { getDriverCashReconciliation } from "../../../../cod-shared/queries/drivers";
import { recordShipmentEvents } from "../../../../cod-shared/shipments/record-events";
import { handOffToDriver } from "../../../../cod-shared/shipments/handoff";
import driverPaymentsRouter from "./routes";
import driversRouter from "../drivers/routes";
import { jsonRequest, seedOrder, seedStore, shipmentsApp, T0 } from "../shipments/test/harness";

const dbModule = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/db", () => dbModule);

let d1: TestD1;
let app: OpenAPIHono<AppContext>;
let server: EcotrackMockServer;
let commune16: string;
let scopes: string[] = [];
const realFetch = globalThis.fetch;
const BY = { id: "staff_1", name: "Staff" };

beforeAll(async () => {
  d1 = await createTestD1();
  app = shipmentsApp(d1, () => scopes, { "/api/driver-payments": driverPaymentsRouter, "/api/drivers": driversRouter });
}, 120_000);

afterAll(async () => {
  await d1?.dispose();
});

beforeEach(async () => {
  dbModule.getDb.mockReturnValue(d1.db);
  scopes = ["orders:assign", "orders:read", "orders:delete", "delivery:read", "delivery:manage", "delivery:dispatch"];
  server = createEcotrackMockServer();
  globalThis.fetch = ((url: string | URL, init?: RequestInit) => server.fetch(url, init)) as typeof fetch;
  commune16 = await seedStore(d1.db, server);
  await d1.db.insert(schema.drivers).values([
    { id: "dr1", firstName: "Amine", lastName: "B", phone: "0661111111", createdAt: T0, updatedAt: T0 },
    { id: "dr2", firstName: "Sofiane", lastName: "K", phone: "0662222222", createdAt: T0, updatedAt: T0 },
  ]);
  await d1.db.insert(schema.driverCompensations).values([
    { id: "c1", driverId: "dr1", wilayaId: 16, feePerDelivery: 300, createdAt: T0, updatedAt: T0 },
    { id: "c2", driverId: "dr2", wilayaId: 16, feePerDelivery: 250, createdAt: T0, updatedAt: T0 },
  ]);
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

const call = (method: string, path: string, body?: unknown) => jsonRequest(app, method, path, body);
const json = async (res: Response) => (await res.json()) as any;
const driver = (id = "dr1") => d1.db.select().from(schema.drivers).where(eq(schema.drivers.id, id)).get().then((d) => d!);
const payments = () => d1.db.select().from(schema.driverPayments).all();
const lines = () => d1.db.select().from(schema.driverPaymentLines).all();
const drift = async (id = "dr1") => (await getDriverCashReconciliation(d1.db, id)).drift;

/** An order given to the driver; delivered unless asked otherwise. Returns its shipment id. */
async function driverShipment(orderId: string, options: { driverId?: string; price?: number; deliveryFee?: number; delivered?: boolean } = {}) {
  await seedOrder(d1.db, commune16, { id: orderId, price: options.price ?? 1500, deliveryFee: options.deliveryFee ?? 400 });
  const [handed] = await handOffToDriver(d1.db, { orderIds: [orderId], driverId: options.driverId ?? "dr1", author: SYSTEM });
  if (!handed.ok) throw new Error(`handoff of ${orderId} failed: ${handed.reason}`);
  if (options.delivered !== false) {
    await recordShipmentEvents(d1.db, handed.shipmentId, [
      { source: "merchant", status: { vocabulary: "driver", value: "delivered" }, interpretation: { kind: "milestone", milestone: "delivered" }, occurredAt: new Date().toISOString() },
    ], SYSTEM);
  }
  return handed.shipmentId;
}

/**
 * Many delivered driver shipments at once, written directly (the handoff and
 * the delivery are tested above): orders, their shipments, and the driver's
 * credit for them.
 */
async function deliveredInBulk(n: number, money: { price: number; deliveryFee: number; driverFee: number }) {
  const now = new Date().toISOString();
  const ids = Array.from({ length: n }, (_, i) => `bulk-${i}`);
  const orderRows = ids.map((id) => ({
    id, orderNumber: `ORD-${id}`, customerId: "c1", customerName: "Karim Benali", phone: "0551234567", wilayaId: 16, communeId: commune16,
    address: "Rue 1", deliveryType: "home" as const, price: money.price, deliveryFee: money.deliveryFee, status: "ready" as const, createdAt: T0, updatedAt: T0,
  }));
  const shipmentRows = ids.map((id) => ({
    id: `shp-${id}`, orderId: id, kind: "driver" as const, driverId: "dr1", handoffState: "accepted" as const, deliveryType: "home" as const,
    codAmount: money.price + money.deliveryFee, driverFee: money.driverFee, deliveredAt: now, providerStatus: "delivered", revision: "r", createdAt: now, updatedAt: now,
  }));
  for (let i = 0; i < n; i += 5) {
    await d1.db.insert(schema.orders).values(orderRows.slice(i, i + 5));
    await d1.db.insert(schema.shipments).values(shipmentRows.slice(i, i + 5));
  }
  await d1.db
    .update(schema.drivers)
    .set({ totalDelivered: n, totalEarnings: n * money.driverFee, pendingCash: n * (money.price + money.deliveryFee) })
    .where(eq(schema.drivers.id, "dr1"));
  return shipmentRows.map((r) => r.id);
}

const pay = (type: string, shipmentIds: string[], driverId = "dr1") => call("POST", "/api/driver-payments", { driverId, type, shipmentIds });

describe("a delivery and its settlement, end to end", () => {
  it("credits the driver once, then the cash and the fee are each settled once", async () => {
    await seedOrder(d1.db, commune16, { id: "o1", price: 1500, deliveryFee: 400 });
    const handed = json(await call("POST", "/api/orders/o1/shipment", { kind: "driver", driverId: "dr1" }));
    const id = (await handed).data.shipment.id as string;
    const report = (body: unknown) => call("POST", `/api/shipments/${id}/events`, body);

    expect((await report({ status: "livred" })).status).toBe(400);
    expect((await report({ status: "out_for_delivery" })).status).toBe(200);
    expect((await report({ status: "delivered" })).status).toBe(200);
    expect((await report({ status: "delivered" })).status).toBe(409);
    expect(await driver()).toMatchObject({ totalDelivered: 1, totalEarnings: 300, pendingCash: 1900, totalPaid: 0 });
    expect(await drift()).toBe(0);

    const pending = await json(await call("GET", "/api/driver-payments/dr1/pending"));
    expect(pending.data).toEqual([
      { shipmentId: id, orderId: "o1", orderNumber: "ORD-o1", customerName: "Karim Benali", codAmount: 1900, driverFee: 300, deliveredAt: expect.any(String), codPaymentId: null, feePaymentId: null },
    ]);

    const cash = await pay("cod_remittance", [id]);
    expect(cash.status).toBe(201);
    const cashPayment = (await json(cash)).data;
    expect(cashPayment).toMatchObject({ driverId: "dr1", type: "cod_remittance", amount: 1900, orderCount: 1, createdBy: "staff_1", createdByName: "Staff" });
    expect(await driver()).toMatchObject({ pendingCash: 0, totalPaid: 1900, totalEarnings: 300 });
    expect(await drift()).toBe(0);
    expect((await json(await call("GET", "/api/driver-payments/dr1/pending"))).data).toMatchObject([{ shipmentId: id, codPaymentId: cashPayment.id, feePaymentId: null }]);

    const fee = await pay("fee_payment", [id]);
    expect(fee.status).toBe(201);
    expect((await json(fee)).data).toMatchObject({ type: "fee_payment", amount: 300 });
    expect(await driver()).toMatchObject({ pendingCash: 0, totalPaid: 1900 });
    expect((await json(await call("GET", "/api/driver-payments/dr1/pending"))).data).toEqual([]);

    expect((await lines()).map((l) => [l.shipmentId, l.component, l.amount]).sort()).toEqual([
      [id, "cod", 1900],
      [id, "fee", 300],
    ]);
    const history = (await json(await call("GET", "/api/driver-payments/dr1"))).data;
    expect(history.map((p: any) => p.type).sort()).toEqual(["cod_remittance", "fee_payment"]);
  });
});

describe("a payment", () => {
  it("a net settlement settles both parts: the cash less the fees", async () => {
    const a = await driverShipment("a", { price: 1500, deliveryFee: 400 });
    const b = await driverShipment("b", { price: 3000, deliveryFee: 500 });
    const res = await pay("net_settlement", [a, b]);
    expect(res.status).toBe(201);
    expect((await json(res)).data).toMatchObject({ type: "net_settlement", amount: 1900 + 3500 - 600, orderCount: 2 });
    expect(await lines()).toHaveLength(4);
    expect(await driver()).toMatchObject({ pendingCash: 0, totalPaid: 5400 });
    expect(await drift()).toBe(0);
  });

  it("settles a part only once — whichever payment tries again", async () => {
    const a = await driverShipment("a");
    expect((await pay("cod_remittance", [a])).status).toBe(201);
    for (const type of ["cod_remittance", "net_settlement"]) {
      const again = await pay(type, [a]);
      expect(again.status, type).toBe(422);
      expect(await json(again)).toMatchObject({ code: "PAYMENT_ALREADY_SETTLED", context: { kind: "cod", shipmentIds: [a] } });
    }
    expect((await pay("fee_payment", [a])).status).toBe(201);
    expect(await json(await pay("fee_payment", [a]))).toMatchObject({ code: "PAYMENT_ALREADY_SETTLED", context: { kind: "fee" } });
    expect(await payments()).toHaveLength(2);
    expect(await driver()).toMatchObject({ pendingCash: 0, totalPaid: 1900 });
  });

  it("one shipment already settled refuses the whole payment — nothing is recorded", async () => {
    const a = await driverShipment("a");
    const b = await driverShipment("b");
    await pay("cod_remittance", [a]);
    const res = await pay("cod_remittance", [a, b]);
    expect(res.status).toBe(422);
    expect((await json(res)).context.shipmentIds).toEqual([a]);
    expect(await payments()).toHaveLength(1);
    expect(await lines()).toHaveLength(1);
    expect(await driver()).toMatchObject({ pendingCash: 1900, totalPaid: 1900 });
  });

  it("settles only the driver's own delivered shipments", async () => {
    const mine = await driverShipment("a");
    const outstanding = await driverShipment("b", { delivered: false });
    const theirs = await driverShipment("c", { driverId: "dr2" });
    await seedOrder(d1.db, commune16, { id: "carrier" });
    const carrier = (await json(await call("POST", "/api/orders/carrier/shipment", { kind: "carrier", companyId: "eco-manual" }))).data.shipment.id;

    const res = await pay("cod_remittance", [mine, outstanding, theirs, carrier, "nope"]);
    expect(res.status).toBe(422);
    expect(await json(res)).toMatchObject({ code: "SHIPMENT_NOT_SETTLEABLE", context: { shipmentIds: [outstanding, theirs, carrier, "nope"] } });
    expect(await payments()).toEqual([]);
    expect(await driver()).toMatchObject({ pendingCash: 1900, totalPaid: 0 });
  });

  it("two payments racing for the same shipment settle it once", async () => {
    const a = await driverShipment("a");
    const request = { driverId: "dr1", type: "cod_remittance" as const, shipmentIds: [a] };
    let competitor: Awaited<ReturnType<typeof createDriverPayment>> | undefined;
    const outcome = await createDriverPayment(interleaved(d1.db, async () => (competitor = await createDriverPayment(d1.db, request, BY))), request, BY);
    expect(competitor).toMatchObject({ ok: true });
    expect(outcome).toEqual({ ok: false, reason: "already_settled", component: "cod", shipmentIds: [a] });
    expect(await payments()).toHaveLength(1);
    expect(await driver()).toMatchObject({ pendingCash: 0, totalPaid: 1900 });
    expect(await drift()).toBe(0);
  });

  it("a shipment that goes while the payment is being made is not settled", async () => {
    const a = await driverShipment("a");
    const b = await driverShipment("b");
    const request = { driverId: "dr1", type: "cod_remittance" as const, shipmentIds: [a, b] };
    // Nothing in the product removes a delivered shipment; the guard is proved against one disappearing anyway.
    const outcome = await createDriverPayment(interleaved(d1.db, () => d1.db.delete(schema.shipments).where(eq(schema.shipments.id, b))), request, BY);
    expect(outcome).toEqual({ ok: false, reason: "not_settleable", shipmentIds: [b] });
    expect(await payments()).toEqual([]);
    expect(await driver()).toMatchObject({ totalPaid: 0 });
  });

  it("settles a hundred shipments in one atomic write", async () => {
    const ids = await deliveredInBulk(100, { price: 1000, deliveryFee: 100, driverFee: 300 });
    const res = await pay("net_settlement", ids);
    expect(res.status).toBe(201);
    expect((await json(res)).data).toMatchObject({ orderCount: 100, amount: 100 * (1100 - 300) });
    expect(await lines()).toHaveLength(200);
    expect(await driver()).toMatchObject({ pendingCash: 0, totalPaid: 110_000, totalDelivered: 100 });
    expect((await json(await call("GET", "/api/driver-payments/dr1/pending"))).data).toEqual([]);
    expect(await drift()).toBe(0);
  }, 30_000);

  it("needs the delivery management permission; the history and pending lists the read one", async () => {
    const a = await driverShipment("a");
    scopes = ["delivery:read"];
    expect((await pay("cod_remittance", [a])).status).toBe(403);
    expect((await call("GET", "/api/driver-payments/dr1/pending")).status).toBe(200);
    expect((await call("GET", "/api/driver-payments/dr1")).status).toBe(200);
    expect(await payments()).toEqual([]);
  });

  it("refuses order ids, a shipment listed twice, and an unknown type", async () => {
    const a = await driverShipment("a");
    expect((await call("POST", "/api/driver-payments", { driverId: "dr1", type: "cod_remittance", orderIds: ["a"] })).status).toBe(400);
    expect((await pay("cod_remittance", [a, a])).status).toBe(400);
    expect((await pay("refund", [a])).status).toBe(400);
    expect(await payments()).toEqual([]);
  });
});

describe("the driver's cash counter", () => {
  it("agrees with the shipments still to settle at every step, and shows a counter that drifted", async () => {
    const a = await driverShipment("a");
    await driverShipment("b", { delivered: false });
    expect(await getDriverCashReconciliation(d1.db, "dr1")).toEqual({ pendingCash: 1900, pendingOrdersTotal: 1900, pendingOrdersCount: 1, drift: 0 });
    await pay("fee_payment", [a]);
    expect(await drift()).toBe(0);
    await pay("cod_remittance", [a]);
    expect(await getDriverCashReconciliation(d1.db, "dr1")).toEqual({ pendingCash: 0, pendingOrdersTotal: 0, pendingOrdersCount: 0, drift: 0 });

    await d1.db.update(schema.drivers).set({ pendingCash: 500 }).where(eq(schema.drivers.id, "dr1"));
    expect(await drift()).toBe(500);
  });

  it("the driver's detail shows their recent and open shipments and the reconciliation", async () => {
    const a = await driverShipment("a");
    await driverShipment("b", { delivered: false });
    await driverShipment("c", { driverId: "dr2" });
    const { data } = await json(await call("GET", "/api/drivers/dr1"));
    expect(data.openShipmentCount).toBe(1);
    expect(data.recentShipments.map((s: any) => s.orderId).sort()).toEqual(["a", "b"]);
    expect(data.recentShipments.find((s: any) => s.id === a)).toMatchObject({ orderNumber: "ORD-a", codAmount: 1900, driverFee: 300, providerStatus: "delivered", deliveredAt: expect.any(String) });
    expect(data.cashReconciliation).toEqual({ pendingCash: 1900, pendingOrdersTotal: 1900, pendingOrdersCount: 1, drift: 0 });
    expect(data).not.toHaveProperty("recentOrders");
    expect((await json(await call("GET", "/api/driver-payments/dr1/pending"))).data.map((p: any) => p.orderId)).toEqual(["a"]);
  });
});

describe("a driver's delivery keeps its order", () => {
  it.each([["delivered, before any settlement", "delivered"], ["returned", "returned"], ["settled", "settled"]] as const)(
    "%s: the order cannot be deleted, and the driver's counters do not move",
    async (_label, state) => {
      const id = await driverShipment("a", { delivered: state !== "returned" });
      if (state === "returned") {
        await recordShipmentEvents(d1.db, id, [
          { source: "merchant", status: { vocabulary: "driver", value: "returned" }, interpretation: { kind: "milestone", milestone: "returned" }, occurredAt: new Date().toISOString() },
        ], SYSTEM);
      }
      if (state === "settled") await pay("cod_remittance", [id]);
      const before = await driver();
      const res = await call("DELETE", "/api/orders/a");
      expect(res.status).toBe(409);
      expect((await json(res)).code).toBe("ORDER_HAS_SHIPMENT");
      expect(await d1.db.select().from(schema.orders).where(eq(schema.orders.id, "a")).get()).toBeDefined();
      expect(await driver()).toEqual(before);
      expect(await drift()).toBe(0);
    },
  );

  it("an order taken back from the driver has no shipment left: it can be deleted, and nothing was credited", async () => {
    const id = await driverShipment("a", { delivered: false });
    await call("POST", `/api/shipments/${id}/void`);
    expect((await call("DELETE", "/api/orders/a")).status).toBe(200);
    expect(await driver()).toMatchObject({ totalDelivered: 0, totalEarnings: 0, pendingCash: 0 });
  });
});

