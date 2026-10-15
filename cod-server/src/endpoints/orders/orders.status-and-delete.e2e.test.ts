/**
 * An order's status change and its deletion, on real D1: their effects
 * (history, driver credit, customer spend, restock) and that each applies
 * exactly once — against a concurrent copy of itself, and against a handoff
 * that gives the order a shipment meanwhile.
 *
 * The interleavings are made deterministic by holding a write's batch and
 * letting the other writer in first.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import * as schema from "@/db/schema";
import type { AppDb } from "@/db";
import { deleteOrder, updateOrderStatus, updateOrder } from "../../../../cod-shared/queries/orders";
import { acceptCarrierHandoff, markHandoffUnknown, reserveCarrierShipment } from "../../../../cod-shared/shipments/handoff";
import { recordShipmentEvents } from "../../../../cod-shared/shipments/record-events";

let d1: TestD1;
const T0 = "2026-10-14T08:00:00.000Z";

beforeAll(async () => {
  d1 = await createTestD1();
}, 120_000);

afterAll(async () => {
  await d1?.dispose();
});

beforeEach(async () => {
  const db = d1.db;
  for (const table of [
    schema.shipmentEvents, schema.shipments, schema.stockMovements, schema.orderProducts, schema.orderStatusHistory, schema.orders,
    schema.productVariants, schema.products, schema.customers, schema.drivers, schema.deliveryCompanies,
  ]) {
    await db.delete(table);
  }
  await db.insert(schema.customers).values({ id: "c1", name: "Karim", phone: "0551234567", wilaya: "Alger", totalOrders: 2, totalSpent: 3000, createdAt: T0 });
  const product = { price: 1500, hasVariants: false, inventory: 10, lowStockThreshold: 1, status: "ACTIVE" as const, visibility: true, showInStore: true, storeFeatured: false, createdAt: T0, updatedAt: T0 };
  await db.insert(schema.products).values({ ...product, id: "tracked", name: "Robe", handle: "robe", sku: "ROBE", trackInventory: true });
  await db.insert(schema.products).values({ ...product, id: "untracked", name: "Carte", handle: "carte", sku: "CARTE", trackInventory: false });
  await db.insert(schema.products).values({ ...product, id: "varied", name: "Foulard", handle: "foulard", sku: "FOU", trackInventory: true, hasVariants: true });
  await db.insert(schema.productVariants).values({ id: "v1", productId: "varied", variations: "{}", price: 1500, sku: "FOU-R", inventory: 5, createdAt: T0, updatedAt: T0 });
  await db.insert(schema.drivers).values({ id: "dr1", firstName: "Amine", lastName: "B", phone: "0661111111", createdAt: T0, updatedAt: T0 });
  await db.insert(schema.deliveryCompanies).values({ id: "co", name: "Yalidine", nameAr: "-", code: "yalidine", provider: "yalidine", createdAt: T0, updatedAt: T0 });
});

interface Line { product: "tracked" | "untracked" | "varied"; quantity: number; returned?: number }

async function seedOrder(id: string, status: string, lines: Line[] = [{ product: "tracked", quantity: 2 }], extra: Partial<typeof schema.orders.$inferInsert> = {}) {
  await d1.db.insert(schema.orders).values({
    id, orderNumber: `ORD-${id}`, customerId: "c1", customerName: "Karim", phone: "0551234567", wilayaId: 16, address: "Rue 1",
    price: 1500, deliveryFee: 400, status: status as never, createdAt: T0, updatedAt: T0, ...extra,
  });
  for (const [i, line] of lines.entries()) {
    await d1.db.insert(schema.orderProducts).values({
      id: `${id}-l${i}`, orderId: id, productId: line.product, variantId: line.product === "varied" ? "v1" : null, productName: line.product,
      quantity: line.quantity, returnedQuantity: line.returned ?? 0, pricePerUnit: 1500, lineTotal: 1500 * line.quantity, createdAt: T0,
    });
  }
}

const db = () => d1.db;
const stockOf = async (id: string) => (await db().select({ n: schema.products.inventory }).from(schema.products).where(eq(schema.products.id, id)).get())!.n;
const variantStock = async () => (await db().select({ n: schema.productVariants.inventory }).from(schema.productVariants).where(eq(schema.productVariants.id, "v1")).get())!.n;
const customer = () => db().select().from(schema.customers).where(eq(schema.customers.id, "c1")).get();
const statusOf = async (id: string) => (await db().select({ s: schema.orders.status }).from(schema.orders).where(eq(schema.orders.id, id)).get())?.s;
const historyOf = (id: string) => db().select().from(schema.orderStatusHistory).where(eq(schema.orderStatusHistory.orderId, id)).all();
const movements = () => db().select().from(schema.stockMovements).all();

async function shipment(orderId: string, state: "submitting" | "unknown" | "accepted") {
  const reserved = await reserveCarrierShipment(db(), { orderId, companyId: "co", deliveryType: "home", stationCode: null, weight: null, isFragile: null, createdBy: null });
  if (!reserved.ok) throw new Error(`reservation failed: ${reserved.reason}`);
  if (state === "unknown") await markHandoffUnknown(db(), reserved.shipmentId, "timeout");
  if (state === "accepted") await acceptCarrierHandoff(db(), reserved.shipmentId, { carrierParcelId: `P-${orderId}`, trackingNumber: `T-${orderId}`, carrierData: null, labelUrl: null }, { validated: true });
  return reserved.shipmentId;
}

/** The customer has another order of the same value, so a spend rolled back twice shows. */
const SPEND_BEFORE = 3000;

/** The same database, but its next batch first lets `meanwhile` run — another writer getting in between a read and a write. */
function interleaved(meanwhile: () => Promise<unknown>): AppDb {
  let pending = true;
  return new Proxy(d1.db, {
    get(target, prop, receiver) {
      if (prop === "batch" && pending) {
        return async (statements: unknown) => {
          pending = false;
          await meanwhile();
          return (target.batch as (s: unknown) => Promise<unknown>)(statements);
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as AppDb;
}

describe("changing an order's status", () => {
  it("moves the status and keeps its history", async () => {
    await seedOrder("o1", "new");
    expect(await updateOrderStatus(db(), "o1", "confirmed", "u1", "Staff")).toEqual({ ok: true });
    expect(await statusOf("o1")).toBe("confirmed");
    expect((await historyOf("o1")).map((h) => [h.status, h.by])).toEqual([["confirmed", "u1"]]);
  });

  it("an unknown order is not found", async () => {
    expect(await updateOrderStatus(db(), "nope", "confirmed")).toEqual({ ok: false, reason: "not_found" });
  });

  it("a legacy delivery credits the assigned driver once; with no driver nobody is credited", async () => {
    await seedOrder("o1", "out_for_delivery", [], { driverId: "dr1", driverFee: 300, codAmount: 1900 });
    await updateOrderStatus(db(), "o1", "delivered");
    expect(await db().select().from(schema.drivers).where(eq(schema.drivers.id, "dr1")).get()).toMatchObject({ totalDelivered: 1, totalEarnings: 300, pendingCash: 1900 });
    await seedOrder("o2", "out_for_delivery", []);
    await updateOrderStatus(db(), "o2", "delivered");
    expect((await db().select().from(schema.drivers).where(eq(schema.drivers.id, "dr1")).get())!.totalDelivered).toBe(1);
  });

  it("a legacy delivery sent five times at once credits the driver once", async () => {
    await seedOrder("o1", "out_for_delivery", [], { driverId: "dr1", driverFee: 300, codAmount: 1900 });
    const outcomes = await Promise.all(Array.from({ length: 5 }, () => updateOrderStatus(db(), "o1", "delivered")));
    expect(outcomes.filter((o) => o.ok)).toHaveLength(1);
    expect(await db().select().from(schema.drivers).where(eq(schema.drivers.id, "dr1")).get()).toMatchObject({ totalDelivered: 1, totalEarnings: 300, pendingCash: 1900 });
  });

  it("cancelling puts back what is still out — tracked products and variants only — and rolls the spend back", async () => {
    await seedOrder("o1", "confirmed", [
      { product: "tracked", quantity: 3, returned: 1 },
      { product: "untracked", quantity: 2 },
      { product: "varied", quantity: 2 },
    ]);
    await updateOrderStatus(db(), "o1", "cancelled", "u1", "Staff");
    expect(await stockOf("tracked")).toBe(12);
    expect(await stockOf("untracked")).toBe(10);
    expect(await stockOf("varied")).toBe(10);
    expect(await variantStock()).toBe(7);
    expect((await customer())!.totalSpent).toBe(SPEND_BEFORE - 1500);
    expect((await movements()).map((m) => [m.productId, m.variantId, m.type, m.delta, m.qtyBefore, m.qtyAfter, m.createdBy]).sort()).toEqual([
      ["tracked", null, "ORDER_CANCELLED", 2, 10, 12, "u1"],
      ["varied", "v1", "ORDER_CANCELLED", 2, 5, 7, "u1"],
    ]);
    const lines = await db().select().from(schema.orderProducts).where(eq(schema.orderProducts.orderId, "o1")).all();
    expect(lines.filter((l) => l.productId !== "untracked").every((l) => l.status === "returned" && l.returnedQuantity === l.quantity)).toBe(true);
  });

  it("a line already fully returned is not restocked again; a legacy return is a return movement", async () => {
    await seedOrder("o1", "out_for_delivery", [{ product: "tracked", quantity: 2, returned: 2 }, { product: "varied", quantity: 1 }]);
    await updateOrderStatus(db(), "o1", "returned");
    expect(await stockOf("tracked")).toBe(10);
    expect(await variantStock()).toBe(6);
    expect((await movements()).map((m) => m.type)).toEqual(["ORDER_RETURNED"]);
  });

  it("an order already cancelled gives nothing back twice", async () => {
    await seedOrder("o1", "new");
    await updateOrderStatus(db(), "o1", "cancelled");
    await updateOrderStatus(db(), "o1", "returned");
    expect(await stockOf("tracked")).toBe(12);
    expect((await customer())!.totalSpent).toBe(SPEND_BEFORE - 1500);
  });

  it("five cancels at once: one applies, the others are refused, everything happens once", async () => {
    await seedOrder("o1", "confirmed");
    const outcomes = await Promise.all(Array.from({ length: 5 }, () => updateOrderStatus(db(), "o1", "cancelled")));
    expect(outcomes.filter((o) => o.ok)).toHaveLength(1);
    expect(outcomes.filter((o) => !o.ok).every((o) => !o.ok && o.reason === "changed")).toBe(true);
    expect(await stockOf("tracked")).toBe(12);
    expect((await customer())!.totalSpent).toBe(SPEND_BEFORE - 1500);
    expect(await historyOf("o1")).toHaveLength(1);
    expect(await movements()).toHaveLength(1);
  });

  it("another change between the read and the write: nothing applies", async () => {
    await seedOrder("o1", "confirmed");
    const raced = interleaved(() => updateOrderStatus(db(), "o1", "preparing"));
    expect(await updateOrderStatus(raced, "o1", "cancelled")).toEqual({ ok: false, reason: "changed" });
    expect(await statusOf("o1")).toBe("preparing");
    expect(await stockOf("tracked")).toBe(10);
    expect((await customer())!.totalSpent).toBe(SPEND_BEFORE);
  });

  it("an order with a shipment has no status change — not even cancelling", async () => {
    await seedOrder("o1", "ready");
    await shipment("o1", "accepted");
    expect(await updateOrderStatus(db(), "o1", "cancelled")).toEqual({ ok: false, reason: "has_shipment" });
    expect(await statusOf("o1")).toBe("ready");
    expect(await stockOf("tracked")).toBe(10);
    expect(await historyOf("o1")).toHaveLength(0);
  });

  it("a handoff landing between the read and the write wins: the cancel applies nothing", async () => {
    await seedOrder("o1", "ready");
    const raced = interleaved(() => shipment("o1", "submitting"));
    expect(await updateOrderStatus(raced, "o1", "cancelled")).toEqual({ ok: false, reason: "has_shipment" });
    expect(await statusOf("o1")).toBe("ready");
    expect(await stockOf("tracked")).toBe(10);
    expect((await customer())!.totalSpent).toBe(SPEND_BEFORE);
  });

  it("a cancel and a handoff at once: exactly one of them happens", async () => {
    for (let i = 0; i < 8; i++) {
      const id = `race${i}`;
      await seedOrder(id, "ready");
      const [cancel, handoff] = await Promise.all([
        updateOrderStatus(db(), id, "cancelled"),
        reserveCarrierShipment(db(), { orderId: id, companyId: "co", deliveryType: "home", stationCode: null, weight: null, isFragile: null, createdBy: null }),
      ]);
      expect(cancel.ok !== handoff.ok, id).toBe(true);
      expect(await statusOf(id)).toBe(cancel.ok ? "cancelled" : "ready");
    }
  });
});

describe("deleting an order", () => {
  it("removes it and undoes its stock and the customer's count and spend", async () => {
    await seedOrder("o1", "confirmed", [{ product: "tracked", quantity: 2 }, { product: "varied", quantity: 1, returned: 0 }, { product: "untracked", quantity: 4 }]);
    expect(await deleteOrder(db(), "o1")).toEqual({ ok: true });
    expect(await statusOf("o1")).toBeUndefined();
    expect(await stockOf("tracked")).toBe(12);
    expect(await variantStock()).toBe(6);
    expect(await stockOf("untracked")).toBe(10);
    expect(await customer()).toMatchObject({ totalOrders: 1, totalSpent: SPEND_BEFORE - 1500 });
    expect((await movements()).every((m) => m.reason === "Order deleted - inventory restored" && m.createdBy === "system")).toBe(true);
    expect(await db().select().from(schema.orderProducts).where(eq(schema.orderProducts.orderId, "o1")).all()).toHaveLength(0);
  });

  it("puts back only what is still out", async () => {
    await seedOrder("o1", "confirmed", [{ product: "tracked", quantity: 3, returned: 1 }, { product: "varied", quantity: 2, returned: 2 }]);
    await deleteOrder(db(), "o1");
    expect(await stockOf("tracked")).toBe(12);
    expect(await variantStock()).toBe(5);
  });

  it("a cancelled order's spend is not rolled back twice", async () => {
    await seedOrder("o1", "new");
    await updateOrderStatus(db(), "o1", "cancelled");
    await deleteOrder(db(), "o1");
    expect(await customer()).toMatchObject({ totalOrders: 1, totalSpent: SPEND_BEFORE - 1500 });
    expect(await stockOf("tracked")).toBe(12);
  });

  it("an unknown order is not found", async () => {
    expect(await deleteOrder(db(), "nope")).toEqual({ ok: false, reason: "not_found" });
  });

  it.each(["submitting", "unknown", "accepted"] as const)("is refused while a shipment is open (%s) — nothing changes", async (state) => {
    await seedOrder("o1", "ready");
    await shipment("o1", state);
    expect(await deleteOrder(db(), "o1")).toEqual({ ok: false, reason: "has_open_shipment" });
    expect(await statusOf("o1")).toBe("ready");
    expect(await stockOf("tracked")).toBe(10);
    expect(await customer()).toMatchObject({ totalOrders: 2, totalSpent: SPEND_BEFORE });
  });

  it("a delivered shipment goes with the order, and its goods stay with the customer", async () => {
    await seedOrder("o1", "ready");
    const id = await shipment("o1", "accepted");
    await recordShipmentEvents(db(), id, [{ source: "webhook", status: { vocabulary: "t", value: "Livré" }, interpretation: { kind: "milestone", milestone: "delivered" }, occurredAt: T0 }]);
    expect(await deleteOrder(db(), "o1")).toEqual({ ok: true });
    expect(await stockOf("tracked")).toBe(10);
    expect(await db().select().from(schema.shipments).all()).toHaveLength(0);
    expect(await db().select().from(schema.shipmentEvents).all()).toHaveLength(0);
    expect(await customer()).toMatchObject({ totalOrders: 1, totalSpent: SPEND_BEFORE - 1500 });
  });

  it("a returned shipment already restocked and rolled the spend back: neither happens twice", async () => {
    await seedOrder("o1", "ready");
    const id = await shipment("o1", "accepted");
    await recordShipmentEvents(db(), id, [{ source: "webhook", status: { vocabulary: "t", value: "Retourné" }, interpretation: { kind: "milestone", milestone: "returned" }, occurredAt: T0 }]);
    expect(await stockOf("tracked")).toBe(12);
    expect((await customer())!.totalSpent).toBe(SPEND_BEFORE - 1500);
    await deleteOrder(db(), "o1");
    expect(await stockOf("tracked")).toBe(12);
    expect(await customer()).toMatchObject({ totalOrders: 1, totalSpent: SPEND_BEFORE - 1500 });
  });

  it("a parcel the carrier cancelled never left: its goods come back", async () => {
    await seedOrder("o1", "ready");
    const id = await shipment("o1", "accepted");
    await recordShipmentEvents(db(), id, [{ source: "webhook", status: { vocabulary: "t", value: "Annulé" }, interpretation: { kind: "milestone", milestone: "cancelled" }, occurredAt: T0 }]);
    expect(await deleteOrder(db(), "o1")).toEqual({ ok: true });
    expect(await stockOf("tracked")).toBe(12);
  });

  it("a cancel between the read and the write: the deletion is planned again and the spend rolls back once", async () => {
    await seedOrder("o1", "confirmed");
    const raced = interleaved(() => updateOrderStatus(db(), "o1", "cancelled"));
    expect(await deleteOrder(raced, "o1")).toEqual({ ok: true });
    expect(await customer()).toMatchObject({ totalOrders: 1, totalSpent: SPEND_BEFORE - 1500 });
    expect(await stockOf("tracked")).toBe(12);
  });

  it("a handoff between the read and the write: the order is kept with its parcel", async () => {
    await seedOrder("o1", "ready");
    const raced = interleaved(() => shipment("o1", "submitting"));
    expect(await deleteOrder(raced, "o1")).toEqual({ ok: false, reason: "has_open_shipment" });
    expect(await statusOf("o1")).toBe("ready");
    expect(await db().select().from(schema.shipments).all()).toHaveLength(1);
    expect(await customer()).toMatchObject({ totalOrders: 2, totalSpent: SPEND_BEFORE });
  });
});

describe("editing an order's delivery details", () => {
  it("is refused once the order has a shipment; its email and notes still change", async () => {
    await seedOrder("o1", "ready");
    await shipment("o1", "accepted");
    expect(await updateOrder(db(), "o1", { phone: "0661112233" })).toEqual({ ok: false, reason: "has_shipment" });
    expect(await updateOrder(db(), "o1", { notes: "Client VIP", customerEmail: "k@example.com" })).toEqual({ ok: true });
    const order = await db().select().from(schema.orders).where(eq(schema.orders.id, "o1")).get();
    expect(order).toMatchObject({ phone: "0551234567", notes: "Client VIP", customerEmail: "k@example.com" });
    expect((await customer())!.phone).toBe("0551234567");
  });

  it("through the shipment it changes, with the customer", async () => {
    await seedOrder("o1", "ready");
    await shipment("o1", "accepted");
    expect(await updateOrder(db(), "o1", { phone: "0661112233" }, { throughShipment: true })).toEqual({ ok: true });
    expect((await customer())!.phone).toBe("0661112233");
  });

  it("a handoff landing first wins over an edit of the address", async () => {
    await seedOrder("o1", "ready");
    const raced = interleaved(() => shipment("o1", "submitting"));
    expect(await updateOrder(raced, "o1", { address: "Ailleurs" })).toEqual({ ok: false, reason: "has_shipment" });
    expect((await db().select().from(schema.orders).where(eq(schema.orders.id, "o1")).get())!.address).toBe("Rue 1");
  });

  it("an unknown order is not found", async () => {
    expect(await updateOrder(db(), "nope", { notes: "x" })).toEqual({ ok: false, reason: "not_found" });
  });
});
