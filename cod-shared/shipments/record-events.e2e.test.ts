/**
 * recordShipmentEvents on real D1: facts, events and their commercial effects
 * land together, exactly once, whatever order reports arrive in and however
 * many writers race.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { SYSTEM } from "@/test-utils/events";
import { asc, eq } from "drizzle-orm";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import * as schema from "../db/schema";
import type { Interpretation } from "./interpretation";
import { ShipmentNotFoundError, recordShipmentEvents, type IncomingShipmentEvent } from "./record-events";

let d1: TestD1;
const T0 = "2026-10-14T08:00:00.000Z";
const at = (minute: number) => new Date(Date.parse(T0) + minute * 60_000).toISOString();

beforeAll(async () => {
  d1 = await createTestD1();
}, 120_000);

afterAll(async () => {
  await d1?.dispose();
});

beforeEach(async () => {
  const db = d1.db;
  for (const table of [schema.businessEvents, schema.shipmentEvents, schema.driverPaymentLines, schema.shipments, schema.stockMovements, schema.orderProducts, schema.orders, schema.productVariants, schema.products, schema.customers, schema.drivers, schema.deliveryCompanies]) {
    await db.delete(table);
  }
  await db.insert(schema.customers).values({ id: "c1", name: "Karim", phone: "0551234567", wilaya: "Alger", totalOrders: 2, totalSpent: 2500, createdAt: T0 });
  await db.insert(schema.products).values([
    { id: "p-tracked", name: "Tracked", handle: "tracked", price: 300, inventory: 10, trackInventory: true, createdAt: T0, updatedAt: T0 },
    { id: "p-variant", name: "Variant", handle: "variant", price: 400, inventory: 0, trackInventory: true, hasVariants: true, createdAt: T0, updatedAt: T0 },
    { id: "p-untracked", name: "Untracked", handle: "untracked", price: 100, inventory: 0, trackInventory: false, createdAt: T0, updatedAt: T0 },
  ]);
  await db.insert(schema.productVariants).values({ id: "v1", productId: "p-variant", variations: '{"Couleur":"Rouge"}', sku: "V-ROUGE", price: 400, inventory: 5, createdAt: T0, updatedAt: T0 });
  for (const id of ["o1", "o2"]) {
    await db.insert(schema.orders).values({ id, orderNumber: `ORD-${id}`, customerId: "c1", customerName: "Karim", phone: "0551234567", price: 1500, deliveryFee: 400, codAmount: 1900, createdAt: T0, updatedAt: T0 });
  }
  await db.insert(schema.orderProducts).values([
    { id: "l-tracked", orderId: "o1", productId: "p-tracked", productName: "Tracked", quantity: 3, returnedQuantity: 1, status: "partially_returned", pricePerUnit: 300, lineTotal: 900, createdAt: T0 },
    { id: "l-variant", orderId: "o1", productId: "p-variant", variantId: "v1", productName: "Variant", quantity: 1, pricePerUnit: 400, lineTotal: 400, createdAt: T0 },
    { id: "l-untracked", orderId: "o1", productId: "p-untracked", productName: "Untracked", quantity: 2, pricePerUnit: 100, lineTotal: 200, createdAt: T0 },
    { id: "l-refused", orderId: "o1", productId: "p-tracked", productName: "Tracked", quantity: 1, returnedQuantity: 1, status: "returned", pricePerUnit: 300, lineTotal: 300, createdAt: T0 },
  ]);
  await db.insert(schema.drivers).values({ id: "dr1", firstName: "Amine", lastName: "B", phone: "0661111111", createdAt: T0, updatedAt: T0 });
  await db.insert(schema.deliveryCompanies).values({ id: "co1", name: "Yalidine", nameAr: "ياليدين", code: "yalidine", provider: "yalidine", createdAt: T0, updatedAt: T0 });
  await db.insert(schema.shipments).values([
    { id: "s-driver", orderId: "o1", kind: "driver", driverId: "dr1", handoffState: "accepted", deliveryType: "home", codAmount: 1900, driverFee: 300, revision: "r0", createdAt: T0, updatedAt: T0 },
    { id: "s-carrier", orderId: "o2", kind: "carrier", companyId: "co1", handoffState: "accepted", carrierParcelId: "yal-1", trackingNumber: "yal-1", deliveryType: "home", codAmount: 1900, revision: "r0", createdAt: T0, updatedAt: T0 },
  ]);
});

const milestone = (m: "out_for_delivery" | "delivered" | "return_started" | "returned" | "cancelled", attention?: boolean): Interpretation =>
  attention ? { kind: "milestone", milestone: m, attention } : { kind: "milestone", milestone: m };

const ev = (value: string, interpretation: Interpretation, minute: number, extra: Partial<IncomingShipmentEvent> = {}): IncomingShipmentEvent => ({
  source: "webhook",
  status: { vocabulary: "status", value },
  interpretation,
  occurredAt: at(minute),
  ...extra,
});

const shipment = (id: string) => d1.db.select().from(schema.shipments).where(eq(schema.shipments.id, id)).get();
const events = (id: string) => d1.db.select().from(schema.shipmentEvents).where(eq(schema.shipmentEvents.shipmentId, id)).all();
const driver = () => d1.db.select().from(schema.drivers).where(eq(schema.drivers.id, "dr1")).get();
const inventory = async () => ({
  tracked: (await d1.db.select().from(schema.products).where(eq(schema.products.id, "p-tracked")).get())!.inventory,
  variant: (await d1.db.select().from(schema.productVariants).where(eq(schema.productVariants.id, "v1")).get())!.inventory,
  untracked: (await d1.db.select().from(schema.products).where(eq(schema.products.id, "p-untracked")).get())!.inventory,
});
const spent = async () => (await d1.db.select().from(schema.customers).where(eq(schema.customers.id, "c1")).get())!.totalSpent;

describe("recording", () => {
  it("stores each report raw and interpreted, and moves the shipment's facts", async () => {
    const result = await recordShipmentEvents(d1.db, "s-carrier", [
      ev("Sorti en livraison", milestone("out_for_delivery"), 10),
      ev("Tentative échouée", { kind: "failed_attempt" }, 20, { reason: "Client ne répond pas", raw: { id: 7 } }),
      ev("Livré", milestone("delivered"), 30, { status: { vocabulary: "status", value: "Livré", label: "Delivered" } }),
    ], SYSTEM);
    expect(result).toMatchObject({ recorded: 3, duplicates: 0, reached: ["out_for_delivery", "delivered"], anomalies: [] });
    const logged = await d1.db.select({ type: schema.businessEvents.type }).from(schema.businessEvents).where(eq(schema.businessEvents.subjectId, "s-carrier")).orderBy(asc(schema.businessEvents.seq)).all();
    expect(logged.map((e) => e.type)).toEqual(["shipment.out_for_delivery", "shipment.delivery_failed", "shipment.delivered"]);
    expect(await shipment("s-carrier")).toMatchObject({
      providerStatus: "Livré",
      providerStatusLabel: "Delivered",
      providerStatusKind: "milestone",
      providerStatusAt: at(30),
      outForDeliveryAt: at(10),
      deliveredAt: at(30),
      deliveryAttempts: 1,
    });
    const rows = await events("s-carrier");
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.providerStatus === "Tentative échouée")).toMatchObject({ interpretation: "failed_attempt", reason: "Client ne répond pas", raw: '{"id":7}', source: "webhook" });
    expect(rows.find((r) => r.providerStatus === "Livré")).toMatchObject({ interpretation: "milestone", milestone: "delivered" });
  });

  it("records the same fact once, whichever channel brings it and however often", async () => {
    const livre = ev("Livré", milestone("delivered"), 30);
    await recordShipmentEvents(d1.db, "s-carrier", [livre, livre], SYSTEM);
    const again = await recordShipmentEvents(d1.db, "s-carrier", [{ ...livre, source: "pull" }], SYSTEM);
    expect(again).toMatchObject({ recorded: 0, duplicates: 1, reached: [] });
    expect(await events("s-carrier")).toHaveLength(1);
  });

  it("an older report arriving late is history: it records its milestone, not the current status", async () => {
    await recordShipmentEvents(d1.db, "s-carrier", [ev("Livré", milestone("delivered"), 30)], SYSTEM);
    await recordShipmentEvents(d1.db, "s-carrier", [ev("Sorti en livraison", milestone("out_for_delivery"), 10)], SYSTEM);
    expect(await shipment("s-carrier")).toMatchObject({ providerStatus: "Livré", outForDeliveryAt: at(10), deliveredAt: at(30) });
  });

  it("an unknown shipment is an error", async () => {
    await expect(recordShipmentEvents(d1.db, "nope", [ev("Livré", milestone("delivered"), 1)], SYSTEM)).rejects.toBeInstanceOf(ShipmentNotFoundError);
  });

  it("marks attention on an exception and records the anomaly of a contradiction", async () => {
    await recordShipmentEvents(d1.db, "s-carrier", [ev("En alerte", { kind: "exception" }, 5, { reason: "Téléphone injoignable" })], SYSTEM);
    expect((await shipment("s-carrier"))!.attentionSince).toBe(at(5));
    await recordShipmentEvents(d1.db, "s-carrier", [ev("Livré", milestone("delivered"), 10)], SYSTEM);
    expect((await shipment("s-carrier"))!.attentionSince).toBeNull();
    const result = await recordShipmentEvents(d1.db, "s-carrier", [ev("Retourné au vendeur", milestone("returned"), 20)], SYSTEM);
    expect(result.anomalies).toEqual(["conflicting_outcome"]);
    expect((await shipment("s-carrier"))!.returnedAt).toBeNull();
    expect((await events("s-carrier")).find((r) => r.providerStatus === "Retourné au vendeur")!.anomaly).toBe("conflicting_outcome");
  });
});

describe("a driver's delivery", () => {
  it("credits the driver once: delivered count, earnings and the cash they now hold", async () => {
    await recordShipmentEvents(d1.db, "s-driver", [ev("delivered", milestone("delivered"), 30, { source: "merchant" })], SYSTEM);
    await recordShipmentEvents(d1.db, "s-driver", [ev("delivered", milestone("delivered"), 31, { source: "merchant" }), ev("collected", { kind: "collection" }, 40)], SYSTEM);
    expect(await driver()).toMatchObject({ totalDelivered: 1, totalEarnings: 300, pendingCash: 1900 });
  });

  it("a carrier's delivery never touches a driver", async () => {
    await recordShipmentEvents(d1.db, "s-carrier", [ev("Livré", milestone("delivered"), 30)], SYSTEM);
    expect(await driver()).toMatchObject({ totalDelivered: 0, totalEarnings: 0, pendingCash: 0 });
  });
});

describe("a return", () => {
  it("puts back exactly the units still out — once — and rolls back the customer's spend once", async () => {
    await recordShipmentEvents(d1.db, "s-driver", [ev("return started", milestone("return_started"), 10)], SYSTEM);
    expect(await inventory()).toEqual({ tracked: 10, variant: 5, untracked: 0 });

    await recordShipmentEvents(d1.db, "s-driver", [ev("returned", milestone("returned"), 20, { source: "merchant" })], SYSTEM);
    await recordShipmentEvents(d1.db, "s-driver", [ev("returned", milestone("returned"), 25, { source: "merchant" })], SYSTEM);

    expect(await inventory()).toEqual({ tracked: 12, variant: 6, untracked: 0 });
    expect(await spent()).toBe(1000);
    const lines = await d1.db.select().from(schema.orderProducts).where(eq(schema.orderProducts.orderId, "o1")).all();
    expect(Object.fromEntries(lines.map((l) => [l.id, [l.status, l.returnedQuantity]]))).toEqual({
      "l-tracked": ["returned", 3],
      "l-variant": ["returned", 1],
      "l-untracked": ["fulfilled", 0],
      "l-refused": ["returned", 1],
    });
    const ledger = await d1.db.select().from(schema.stockMovements).where(eq(schema.stockMovements.reference, "o1")).all();
    expect(ledger.map((m) => [m.productId, m.variantId, m.type, m.delta, m.qtyBefore, m.qtyAfter]).sort()).toEqual([
      ["p-tracked", null, "ORDER_RETURNED", 2, 10, 12],
      ["p-variant", "v1", "ORDER_RETURNED", 1, 5, 6],
    ]);
  });

  it("a return reported after a delivery restocks nothing", async () => {
    await recordShipmentEvents(d1.db, "s-driver", [ev("delivered", milestone("delivered"), 10)], SYSTEM);
    await recordShipmentEvents(d1.db, "s-driver", [ev("returned", milestone("returned"), 20)], SYSTEM);
    expect(await inventory()).toEqual({ tracked: 10, variant: 5, untracked: 0 });
    expect(await spent()).toBe(2500);
  });
});

describe("racing writers", () => {
  it("two writers delivering the same driver shipment credit the driver once", async () => {
    await Promise.all([
      recordShipmentEvents(d1.db, "s-driver", [ev("delivered", milestone("delivered"), 30, { source: "merchant" })], SYSTEM),
      recordShipmentEvents(d1.db, "s-driver", [ev("Livré", milestone("delivered"), 31)], SYSTEM),
      recordShipmentEvents(d1.db, "s-driver", [ev("collected", { kind: "collection" }, 32)], SYSTEM),
    ]);
    expect(await driver()).toMatchObject({ totalDelivered: 1, pendingCash: 1900 });
    expect(await events("s-driver")).toHaveLength(3);
  });

  it("two writers returning the same shipment restock once", async () => {
    await Promise.all([
      recordShipmentEvents(d1.db, "s-driver", [ev("returned", milestone("returned"), 20, { source: "merchant" })], SYSTEM),
      recordShipmentEvents(d1.db, "s-driver", [ev("Retourné au vendeur", milestone("returned"), 21)], SYSTEM),
    ]);
    expect(await inventory()).toEqual({ tracked: 12, variant: 6, untracked: 0 });
    expect(await spent()).toBe(1000);
  });

  it("a delivery racing a return: whichever wins, stock comes back only if the return did", async () => {
    for (let round = 0; round < 5; round++) {
      await d1.db.update(schema.shipments).set({ deliveredAt: null, returnedAt: null, providerStatus: null, providerStatusAt: null, providerStatusKind: null, revision: `r-${round}` }).where(eq(schema.shipments.id, "s-driver"));
      await d1.db.delete(schema.shipmentEvents);
      await d1.db.update(schema.orderProducts).set({ status: "fulfilled", returnedQuantity: 0 }).where(eq(schema.orderProducts.id, "l-variant"));
      await d1.db.update(schema.orderProducts).set({ status: "partially_returned", returnedQuantity: 1 }).where(eq(schema.orderProducts.id, "l-tracked"));
      await d1.db.update(schema.products).set({ inventory: 10 }).where(eq(schema.products.id, "p-tracked"));
      await d1.db.update(schema.productVariants).set({ inventory: 5 }).where(eq(schema.productVariants.id, "v1"));
      await Promise.all([
        recordShipmentEvents(d1.db, "s-driver", [ev("Livré", milestone("delivered"), 30)], SYSTEM),
        recordShipmentEvents(d1.db, "s-driver", [ev("returned", milestone("returned"), 30, { source: "merchant" })], SYSTEM),
      ]);
      const s = (await shipment("s-driver"))!;
      expect([s.deliveredAt, s.returnedAt].filter(Boolean)).toHaveLength(1);
      expect(await inventory()).toEqual(s.returnedAt ? { tracked: 12, variant: 6, untracked: 0 } : { tracked: 10, variant: 5, untracked: 0 });
    }
  });

  it("concurrent milestones all land: none is lost to another writer's update", async () => {
    await Promise.all([
      recordShipmentEvents(d1.db, "s-carrier", [ev("Sorti en livraison", milestone("out_for_delivery"), 10)], SYSTEM),
      recordShipmentEvents(d1.db, "s-carrier", [ev("Tentative échouée", { kind: "failed_attempt" }, 15)], SYSTEM),
      recordShipmentEvents(d1.db, "s-carrier", [ev("Livré", milestone("delivered"), 30)], SYSTEM),
    ]);
    expect(await shipment("s-carrier")).toMatchObject({ outForDeliveryAt: at(10), deliveredAt: at(30), deliveryAttempts: 1, providerStatus: "Livré" });
  });
});

describe("all or nothing", () => {
  it("a write that fails part-way leaves no fact, no event and no restock behind", async () => {
    const write = recordShipmentEvents(d1.db, "s-driver", [ev("returned", milestone("returned"), 20, { webhookEventId: "no-such-inbox-row" })], SYSTEM);
    await expect(write).rejects.toThrow();
    expect((await shipment("s-driver"))!.returnedAt).toBeNull();
    expect(await events("s-driver")).toHaveLength(0);
    expect(await inventory()).toEqual({ tracked: 10, variant: 5, untracked: 0 });
    expect(await spent()).toBe(2500);
  });
});
