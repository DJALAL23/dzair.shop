/**
 * Units of one order line refused at the door, on real D1: the difference is
 * put back in stock (or taken out again when the return is corrected down),
 * with its movement; never once the order is cancelled or its parcel came
 * back — those already put every remaining unit back — and never twice for
 * the same change, whatever runs in between.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import { interleaved } from "@/test-utils/interleaved";
import * as schema from "@/db/schema";
import { setOrderProductReturn, updateOrderStatus } from "../../../../cod-shared/queries/orders";
import { recordShipmentEvents } from "../../../../cod-shared/shipments/record-events";

const T = "2026-10-14T08:00:00.000Z";
let d1: TestD1;

beforeAll(async () => {
  d1 = await createTestD1();
}, 120_000);

afterAll(async () => {
  await d1?.dispose();
});

beforeEach(async () => {
  for (const table of [schema.shipmentEvents, schema.shipments, schema.stockMovements, schema.orderStatusHistory, schema.orderProducts, schema.orders, schema.productVariants, schema.products, schema.customers]) {
    await d1.db.delete(table);
  }
  await d1.db.insert(schema.customers).values({ id: "c1", name: "K", phone: "0551234567", wilaya: "Alger", totalOrders: 1, totalSpent: 3000, createdAt: T });
  const product = { price: 1000, hasVariants: false, lowStockThreshold: 1, status: "ACTIVE" as const, visibility: true, showInStore: true, storeFeatured: false, createdAt: T, updatedAt: T };
  await d1.db.insert(schema.products).values([
    { ...product, id: "tracked", name: "Robe", handle: "robe", inventory: 10, trackInventory: true },
    { ...product, id: "untracked", name: "Service", handle: "service", inventory: 0, trackInventory: false },
    { ...product, id: "varied", name: "Chemise", handle: "chemise", inventory: 0, trackInventory: true, hasVariants: true },
  ]);
  await d1.db.insert(schema.productVariants).values({ id: "v1", productId: "varied", variations: "{}", price: 1000, sku: "CH-M", inventory: 5, isDefault: true, active: true, position: 0, createdAt: T, updatedAt: T });
  await d1.db.insert(schema.orders).values({ id: "o1", orderNumber: "ORD-1", customerId: "c1", customerName: "K", phone: "0551234567", price: 3000, status: "ready", createdAt: T, updatedAt: T });
  await d1.db.insert(schema.orderProducts).values([
    { id: "l-tracked", orderId: "o1", productId: "tracked", productName: "Robe", quantity: 3, pricePerUnit: 1000, lineTotal: 3000, createdAt: T },
    { id: "l-untracked", orderId: "o1", productId: "untracked", productName: "Service", quantity: 1, pricePerUnit: 0, lineTotal: 0, createdAt: T },
    { id: "l-varied", orderId: "o1", productId: "varied", variantId: "v1", productName: "Chemise", quantity: 2, pricePerUnit: 1000, lineTotal: 2000, createdAt: T },
  ]);
});

const stock = async (id: string) => (await d1.db.select().from(schema.products).where(eq(schema.products.id, id)).get())!.inventory;
const variantStock = async () => (await d1.db.select().from(schema.productVariants).where(eq(schema.productVariants.id, "v1")).get())!.inventory;
const line = (id: string) => d1.db.select().from(schema.orderProducts).where(eq(schema.orderProducts.id, id)).get().then((l) => l!);
const movements = () => d1.db.select().from(schema.stockMovements).all();

describe("a line return", () => {
  it("puts the refused units back, with the line's state and a movement", async () => {
    expect(await setOrderProductReturn(d1.db, "o1", "l-tracked", 2, "u1", "Staff")).toEqual({ ok: true, id: "l-tracked", status: "partially_returned", returnedQuantity: 2, quantity: 3 });
    expect(await stock("tracked")).toBe(12);
    expect(await line("l-tracked")).toMatchObject({ status: "partially_returned", returnedQuantity: 2 });
    expect((await movements()).map((m) => [m.productId, m.type, m.delta, m.qtyBefore, m.qtyAfter, m.reference, m.createdBy])).toEqual([["tracked", "ORDER_RETURNED", 2, 10, 12, "o1", "u1"]]);

    expect((await setOrderProductReturn(d1.db, "o1", "l-tracked", 3)).ok).toBe(true);
    expect(await line("l-tracked")).toMatchObject({ status: "returned", returnedQuantity: 3 });
    expect(await stock("tracked")).toBe(13);
  });

  it("a return corrected down takes the units out again; to zero, the line is fulfilled", async () => {
    await setOrderProductReturn(d1.db, "o1", "l-tracked", 3);
    expect((await setOrderProductReturn(d1.db, "o1", "l-tracked", 1)).ok).toBe(true);
    expect(await stock("tracked")).toBe(11);
    expect((await setOrderProductReturn(d1.db, "o1", "l-tracked", 0)).ok).toBe(true);
    expect(await line("l-tracked")).toMatchObject({ status: "fulfilled", returnedQuantity: 0 });
    expect(await stock("tracked")).toBe(10);
    expect((await movements()).map((m) => m.delta)).toEqual([3, -2, -1]);
  });

  it("a variant's stock moves, an untracked product's line changes alone, and the same quantity again moves nothing", async () => {
    await setOrderProductReturn(d1.db, "o1", "l-varied", 1);
    expect(await variantStock()).toBe(6);
    expect((await setOrderProductReturn(d1.db, "o1", "l-untracked", 1)).ok).toBe(true);
    expect(await line("l-untracked")).toMatchObject({ status: "returned", returnedQuantity: 1 });
    expect(await stock("untracked")).toBe(0);
    expect((await setOrderProductReturn(d1.db, "o1", "l-varied", 1)).ok).toBe(true);
    expect(await variantStock()).toBe(6);
    expect(await movements()).toHaveLength(1);
  });

  it("refuses a quantity out of range, and a line of another order", async () => {
    expect(await setOrderProductReturn(d1.db, "o1", "l-tracked", 4)).toEqual({ ok: false, reason: "out_of_range", quantity: 3 });
    expect(await setOrderProductReturn(d1.db, "o1", "l-tracked", -1)).toEqual({ ok: false, reason: "out_of_range", quantity: 3 });
    expect(await setOrderProductReturn(d1.db, "other", "l-tracked", 1)).toEqual({ ok: false, reason: "line_not_found" });
    expect(await movements()).toEqual([]);
  });
});

describe("refused once every remaining unit is already back", () => {
  it("the order is cancelled", async () => {
    await updateOrderStatus(d1.db, "o1", "cancelled");
    const before = await stock("tracked");
    expect(await setOrderProductReturn(d1.db, "o1", "l-tracked", 1)).toEqual({ ok: false, reason: "order_closed" });
    expect(await stock("tracked")).toBe(before);
  });

  it("the order's parcel came back", async () => {
    await d1.db.insert(schema.drivers).values({ id: "dr1", firstName: "A", lastName: "B", phone: "0661111111", createdAt: T, updatedAt: T });
    await d1.db.insert(schema.shipments).values({ id: "s1", orderId: "o1", kind: "driver", driverId: "dr1", handoffState: "accepted", deliveryType: "home", codAmount: 3000, revision: "r", createdAt: T, updatedAt: T });
    await recordShipmentEvents(d1.db, "s1", [{ source: "merchant", status: { vocabulary: "driver", value: "returned" }, interpretation: { kind: "milestone", milestone: "returned" }, occurredAt: new Date().toISOString() }]);
    expect(await stock("tracked")).toBe(13);
    expect(await setOrderProductReturn(d1.db, "o1", "l-tracked", 1)).toEqual({ ok: false, reason: "order_closed" });
    expect(await stock("tracked")).toBe(13);
  });

  it("the order is cancelled while the return is being recorded", async () => {
    const outcome = await setOrderProductReturn(interleaved(d1.db, () => updateOrderStatus(d1.db, "o1", "cancelled")), "o1", "l-tracked", 2);
    expect(outcome).toEqual({ ok: false, reason: "order_closed" });
    expect(await stock("tracked")).toBe(13);
    expect((await movements()).filter((m) => m.productId === "tracked").map((m) => [m.type, m.delta])).toEqual([["ORDER_CANCELLED", 3]]);
  });
});

describe("never twice for the same change", () => {
  it("another return of the line recorded in between: this one is refused, to be read again", async () => {
    const outcome = await setOrderProductReturn(interleaved(d1.db, () => setOrderProductReturn(d1.db, "o1", "l-tracked", 2)), "o1", "l-tracked", 2);
    expect(outcome).toEqual({ ok: false, reason: "changed" });
    expect(await stock("tracked")).toBe(12);
    expect(await movements()).toHaveLength(1);
  });

  it("the same return sent five times at once moves the units once", async () => {
    await Promise.all(Array.from({ length: 5 }, () => setOrderProductReturn(d1.db, "o1", "l-tracked", 2)));
    expect(await stock("tracked")).toBe(12);
    expect(await movements()).toHaveLength(1);
  });
});
