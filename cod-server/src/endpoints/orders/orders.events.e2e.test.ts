/**
 * Every order change records its Business Event with it, on real D1
 * (ADR 0016): exactly when the change commits, under the change's own claim,
 * with the order as the change left it — whichever surface made it. Every
 * event read here is also held to its catalogue schema (`eventsOf`).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import { makeFaultyDb } from "@/test-utils/faulty-d1";
import { interleaved } from "@/test-utils/interleaved";
import { SYSTEM, eventsOf, staff } from "@/test-utils/events";
import { jsonRequest, shipmentsApp } from "@/endpoints/shipments/test/harness";
import * as schema from "@/db/schema";
import { getOrderTools } from "./ai-tools";
import { createOrder, deleteOrder, setOrderProductReturn, updateOrder, updateOrderStatus } from "../../../../cod-shared/queries/orders";
import { createStoreOrder } from "../../../../cod-shared/queries/store";
import { acceptCarrierHandoff, reserveCarrierShipment } from "../../../../cod-shared/shipments/handoff";
import { recordShipmentEvents } from "../../../../cod-shared/shipments/record-events";

let d1: TestD1;
const db = () => d1.db;
const T0 = "2026-10-20T08:00:00.000Z";

beforeAll(async () => {
  d1 = await createTestD1();
}, 120_000);

afterAll(async () => d1?.dispose());

beforeEach(async () => {
  for (const table of [
    schema.businessEvents, schema.shipmentEvents, schema.shipments, schema.stockMovements, schema.orderProducts, schema.orderStatusHistory,
    schema.orders, schema.products, schema.customers, schema.deliveryCompanies,
  ]) {
    await db().delete(table);
  }
  await db().insert(schema.customers).values({ id: "c1", name: "Karim", phone: "0551234567", wilaya: "Alger", createdAt: T0 });
  await db().insert(schema.products).values({
    id: "robe", name: "Robe", handle: "robe", sku: "ROBE", price: 2500, hasVariants: false, inventory: 10, lowStockThreshold: 1,
    trackInventory: true, status: "ACTIVE", visibility: true, showInStore: true, createdAt: T0, updatedAt: T0,
  });
  await db().insert(schema.deliveryCompanies).values({ id: "co", name: "Yalidine", nameAr: "-", code: "yalidine", provider: "yalidine", createdAt: T0, updatedAt: T0 });
});

function orderRow(id: string, extra: Partial<typeof schema.orders.$inferInsert> = {}): typeof schema.orders.$inferInsert {
  return {
    id, orderNumber: `ORD-${id}`, customerId: "c1", customerName: "Karim", phone: "0551234567", wilayaId: 16, communeId: "c-16-001",
    address: "12 rue Didouche", price: 5000, deliveryFee: 400, codAmount: 5400, status: "new", createdAt: T0, updatedAt: T0, ...extra,
  };
}

const line = (orderId: string, quantity = 2) => ({
  id: `${orderId}-l1`, orderId, productId: "robe", productName: "Robe", quantity, pricePerUnit: 2500, lineTotal: 2500 * quantity, createdAt: T0,
});

/** An order as the dashboard creates it, by staff member Samira. */
async function placed(id: string, extra: Partial<typeof schema.orders.$inferInsert> = {}) {
  await createOrder(db(), orderRow(id, extra), [line(id)], staff("u-samira", "Samira"));
}

/** Handed to the carrier; an order goes out only once ready, so it is made ready first. */
async function shipped(orderId: string) {
  await db().update(schema.orders).set({ status: "ready" }).where(eq(schema.orders.id, orderId));
  const reserved = await reserveCarrierShipment(db(), { orderId, companyId: "co", deliveryType: "home", stationCode: null, weight: null, isFragile: null, createdBy: null });
  if (!reserved.ok) throw new Error(reserved.reason);
  await acceptCarrierHandoff(db(), reserved.shipmentId, { carrierParcelId: `P-${orderId}`, trackingNumber: `T-${orderId}`, carrierData: null, labelUrl: null }, { validated: true , author: SYSTEM });
  return reserved.shipmentId;
}

async function delivered(orderId: string) {
  const shipmentId = await shipped(orderId);
  await recordShipmentEvents(db(), shipmentId, [
    { source: "webhook", status: { vocabulary: "yalidine", value: "Livré" }, interpretation: { kind: "milestone", milestone: "delivered" }, occurredAt: "2026-10-21T10:00:00.000Z" },
  ], SYSTEM);
}

const typesOf = async (orderId: string) => (await eventsOf(db(), orderId)).map((e) => e.type);

describe("order.created", () => {
  it("records the order as it was committed, with who placed it", async () => {
    await placed("o1", { notes: "Appeler avant" });

    const [event] = await eventsOf(db(), "o1");
    expect(event).toMatchObject({ type: "order.created", subjectType: "order", subjectId: "o1", actorKind: "staff", actorId: "u-samira", actorName: "Samira", origin: "dashboard", occurredAt: T0 });
    expect(event!.type === "order.created" && event!.data.order).toMatchObject({
      id: "o1",
      number: "ORD-o1",
      status: "new",
      type: "online",
      placedAt: T0,
      customer: { id: "c1", name: "Karim", phone: "0551234567", email: null },
      destination: {
        wilaya: { id: 16, name: "Alger", nameAr: "الجزائر" },
        commune: { id: "c-16-001", name: "Alger Centre", nameAr: "الجزائر الوسطى" },
        address: "12 rue Didouche",
        deliveryType: "home",
      },
      lines: [{ id: "o1-l1", productId: "robe", name: "Robe", quantity: 2, unitPrice: { amount: "2500.00", currency: "DZD" }, total: { amount: "5000.00", currency: "DZD" }, gift: false, offer: null, returnedQuantity: 0 }],
      subtotal: { amount: "5000.00", currency: "DZD" },
      deliveryFee: { amount: "400.00", currency: "DZD" },
      total: { amount: "5400.00", currency: "DZD" },
      coupon: null,
      notes: "Appeler avant",
      customFields: [],
    });
  });

  it("credits the staff member in the order's history", async () => {
    await placed("o1");
    const [history] = await db().select().from(schema.orderStatusHistory).where(eq(schema.orderStatusHistory.orderId, "o1")).all();
    expect(history!.by).toBe("u-samira");
  });

  it("carries the number the order kept when its first draw was taken", async () => {
    await placed("o1", { orderNumber: "ORD-20261020-0007" });
    await createOrder(db(), orderRow("o2", { orderNumber: "ORD-20261020-0007" }), [line("o2", 1)], SYSTEM);

    const [event] = await eventsOf(db(), "o2");
    const saved = await db().select({ n: schema.orders.orderNumber }).from(schema.orders).where(eq(schema.orders.id, "o2")).get();
    expect(saved!.n).not.toBe("ORD-20261020-0007");
    expect(event!.type === "order.created" && event!.data.order.number).toBe(saved!.n);
    expect(await typesOf("o2")).toEqual(["order.created"]);
  });

  it("records nothing for an order that could not be placed", async () => {
    await expect(createOrder(db(), orderRow("o1"), [line("o1", 50)], SYSTEM)).rejects.toThrow();
    expect(await eventsOf(db(), "o1")).toEqual([]);
  });

  it("is the shopper's, through the storefront, at checkout", async () => {
    const order = await createStoreOrder(db(), {
      customerName: "Karim", phone: "0551234567", wilayaId: 16, communeId: "c-16-001", deliveryType: "home",
      productId: "robe", productName: "Robe", quantity: 1, pricePerUnit: 2500, customerId: "c1", deliveryFee: 400, locale: "fr",
    });
    const [event] = await eventsOf(db(), order.id);
    expect(event).toMatchObject({ type: "order.created", actorKind: "shopper", actorId: null, actorName: null, origin: "storefront" });
    expect(event!.type === "order.created" && event!.data.order).toMatchObject({ number: order.orderNumber, total: { amount: "2900.00" } });
  });
});

describe("a status change", () => {
  it("records the status's own type, the order after it, and where it came from", async () => {
    await placed("o1");
    expect(await updateOrderStatus(db(), "o1", "confirmed", staff("u-ada", "Ada"))).toEqual({ ok: true });

    const [, event] = await eventsOf(db(), "o1");
    expect(event).toMatchObject({ type: "order.confirmed", actorId: "u-ada", origin: "dashboard" });
    expect(event!.type === "order.confirmed" && event!.data).toMatchObject({ previousStatus: "new", order: { status: "confirmed" } });
  });

  it("names every status by its type", async () => {
    for (const [id, steps] of [
      ["a", ["unreachable"]],
      ["b", ["confirmed", "preparing", "ready", "cancelled"]],
    ] as const) {
      await placed(id);
      for (const status of steps) expect(await updateOrderStatus(db(), id, status, SYSTEM)).toEqual({ ok: true });
    }
    expect(await typesOf("a")).toEqual(["order.created", "order.unreachable"]);
    expect(await typesOf("b")).toEqual(["order.created", "order.confirmed", "order.preparing", "order.ready", "order.cancelled"]);
  });

  it("records a cancel once, however many arrive at once", async () => {
    await placed("o1");
    const outcomes = await Promise.all(Array.from({ length: 5 }, () => updateOrderStatus(db(), "o1", "cancelled", SYSTEM)));
    expect(outcomes.filter((o) => o.ok)).toHaveLength(1);
    expect(await typesOf("o1")).toEqual(["order.created", "order.cancelled"]);
  });

  it("records nothing for a change that lost its race", async () => {
    await placed("o1");
    const raced = interleaved(db(), () => updateOrderStatus(db(), "o1", "confirmed", SYSTEM));
    expect(await updateOrderStatus(raced, "o1", "cancelled", SYSTEM)).toEqual({ ok: false, reason: "changed" });
    expect(await typesOf("o1")).toEqual(["order.created", "order.confirmed"]);
  });

  it("records nothing once the order has a shipment", async () => {
    await placed("o1");
    await shipped("o1");
    expect(await updateOrderStatus(db(), "o1", "cancelled", SYSTEM)).toEqual({ ok: false, reason: "has_shipment" });
    expect(await typesOf("o1")).toEqual(["order.created", "shipment.handed_off"]);
  });

  it("records nothing when any write of the change fails", async () => {
    await placed("o1");
    const faulty = makeFaultyDb(d1.raw, (text) => text.startsWith('insert into "stock_movements"'));
    await expect(updateOrderStatus(faulty, "o1", "cancelled", SYSTEM)).rejects.toThrow("INJECTED FAULT");
    expect(await typesOf("o1")).toEqual(["order.created"]);
  });

  it("refuses to move an order back to new", async () => {
    await placed("o1");
    await expect(updateOrderStatus(db(), "o1", "new", SYSTEM)).rejects.toThrow(/never moves back to new/);
  });
});

describe("every surface records the same event", () => {
  const scopes = () => ["*"];

  it("a confirmation from the dashboard and from an AI agent: same type and data, their own Actor and Origin", async () => {
    const agentOrder = crypto.randomUUID();
    await placed("dash");
    await placed(agentOrder);
    const res = await jsonRequest(shipmentsApp(d1, scopes), "PATCH", "/api/orders/dash/status", { status: "confirmed" });
    expect(res.status).toBe(200);
    const tools = getOrderTools(db(), { userId: "u-ada", role: "admin", scopes: [], name: "Ada", email: "ada@example.com" });
    const outcome = await (tools.updateOrderStatus as unknown as { execute: (a: unknown) => Promise<{ success: boolean }> }).execute({ orderId: agentOrder, status: "confirmed" });
    expect(outcome).toEqual(expect.objectContaining({ success: true }));
    expect((outcome as { error?: string }).error).toBeUndefined();

    const [, fromDashboard] = await eventsOf(db(), "dash");
    const [, fromAgent] = await eventsOf(db(), agentOrder);
    expect(fromDashboard).toMatchObject({ type: "order.confirmed", actorKind: "staff", actorId: "staff_1", origin: "dashboard" });
    expect(fromAgent).toMatchObject({ type: "order.confirmed", actorKind: "agent", actorId: "u-ada", actorName: "Ada", origin: "agent" });
    const shape = (e: typeof fromAgent) => e!.type === "order.confirmed" && { previousStatus: e!.data.previousStatus, status: e!.data.order.status };
    expect(shape(fromAgent)).toEqual(shape(fromDashboard));
  });

  it("an order created and deleted through an AI agent records each, as the agent", async () => {
    const tools = getOrderTools(db(), { userId: "u-ada", role: "admin", scopes: [], name: "Ada", email: "ada@example.com" }) as unknown as Record<string, { execute: (a: unknown) => Promise<Record<string, unknown>> }>;
    const created = await tools.createOrder!.execute({
      customerId: "c1", customerName: "Karim", phone: "0551234567", notes: "by-agent", wilayaId: 16, communeId: "c-16-001", address: "Rue 2", deliveryType: "home", orderType: "online",
      price: 2500, products: [{ productId: "robe", productName: "Robe", quantity: 1, pricePerUnit: 2500, lineTotal: 2500 }],
    });
    expect(created).toEqual(expect.objectContaining({ success: true }));
    const [order] = await db().select({ id: schema.orders.id }).from(schema.orders).where(eq(schema.orders.notes, "by-agent")).all();
    const [movement] = await db().select().from(schema.stockMovements).where(eq(schema.stockMovements.reference, order!.id)).all();
    expect(movement).toMatchObject({ createdBy: "u-ada", createdByName: "Ada" });
    expect((await tools.deleteOrder!.execute({ orderId: order!.id })).success).toBe(true);

    const events = await eventsOf(db(), order!.id);
    expect(events.map((e) => [e.type, e.actorKind, e.origin])).toEqual([
      ["order.created", "agent", "agent"],
      ["order.deleted", "agent", "agent"],
    ]);
  });
});

describe("order.updated", () => {
  it("names what changed and carries the order as edited", async () => {
    await placed("o1");
    expect(await updateOrder(db(), "o1", { phone: "0660000000", address: "5 rue Larbi", notes: "VIP", customerName: "Karim" }, staff())).toEqual({ ok: true });

    const [, event] = await eventsOf(db(), "o1");
    expect(event!.type === "order.updated" && event!.data).toMatchObject({
      changedFields: ["customerPhone", "destination", "notes"],
      order: { customer: { phone: "0660000000" }, destination: { address: "5 rue Larbi" }, notes: "VIP" },
    });
  });

  it("records nothing for an edit that changes nothing", async () => {
    await placed("o1");
    expect(await updateOrder(db(), "o1", { customerName: "Karim", address: "12 rue Didouche" }, staff())).toEqual({ ok: true });
    expect(await typesOf("o1")).toEqual(["order.created"]);
  });

  it("records nothing for an edit the parcel refuses, and the notes still record", async () => {
    await placed("o1");
    await shipped("o1");
    expect(await updateOrder(db(), "o1", { address: "Ailleurs" }, staff())).toEqual({ ok: false, reason: "has_shipment" });
    expect(await updateOrder(db(), "o1", { notes: "Fragile" }, staff())).toEqual({ ok: true });
    expect(await typesOf("o1")).toEqual(["order.created", "shipment.handed_off", "order.updated"]);
  });

  it("records the edit a shipment makes after the carrier took it", async () => {
    await placed("o1");
    await shipped("o1");
    expect(await updateOrder(db(), "o1", { address: "Ailleurs" }, staff(), { throughShipment: true })).toEqual({ ok: true });
    const events = await eventsOf(db(), "o1");
    expect(events.at(-1)).toMatchObject({ type: "order.updated", data: { changedFields: ["destination"] } });
  });
});

describe("order.line_returned", () => {
  it("records the units refused, with the line's previous count and the order after", async () => {
    await placed("o1");
    await delivered("o1");
    expect((await setOrderProductReturn(db(), "o1", "o1-l1", 1, staff())).ok).toBe(true);

    const event = (await eventsOf(db(), "o1")).at(-1);
    expect(event!.type === "order.line_returned" && event!.data).toMatchObject({
      lineId: "o1-l1",
      previousReturnedQuantity: 0,
      order: { lines: [{ id: "o1-l1", returnedQuantity: 1 }] },
    });
  });

  it("records nothing when the count does not change, or the return is refused", async () => {
    await placed("o1");
    expect(await setOrderProductReturn(db(), "o1", "o1-l1", 1, staff())).toEqual({ ok: false, reason: "not_delivered" });
    await delivered("o1");
    await setOrderProductReturn(db(), "o1", "o1-l1", 1, staff());
    await setOrderProductReturn(db(), "o1", "o1-l1", 1, staff());
    expect((await typesOf("o1")).filter((t) => t === "order.line_returned")).toHaveLength(1);
  });

  it("records one event per return that applied, when two arrive at once", async () => {
    await placed("o1");
    await delivered("o1");
    const outcome = await setOrderProductReturn(interleaved(db(), () => setOrderProductReturn(db(), "o1", "o1-l1", 2, SYSTEM)), "o1", "o1-l1", 1, SYSTEM);
    expect(outcome).toEqual({ ok: false, reason: "changed" });
    const returns = (await eventsOf(db(), "o1")).filter((e) => e.type === "order.line_returned");
    expect(returns).toHaveLength(1);
    expect(returns[0]!.type === "order.line_returned" && returns[0]!.data.order.lines[0]!.returnedQuantity).toBe(2);
  });
});

describe("order.deleted", () => {
  it("keeps the order as it was before it was deleted", async () => {
    await placed("o1");
    await updateOrderStatus(db(), "o1", "confirmed", SYSTEM);
    expect(await deleteOrder(db(), "o1", staff("u-ada", "Ada"))).toEqual({ ok: true });

    expect(await db().select().from(schema.orders).where(eq(schema.orders.id, "o1")).all()).toEqual([]);
    const event = (await eventsOf(db(), "o1")).at(-1);
    expect(event).toMatchObject({ type: "order.deleted", actorId: "u-ada" });
    expect(event!.type === "order.deleted" && event!.data.order).toMatchObject({ status: "confirmed", lines: [{ id: "o1-l1", quantity: 2 }] });
  });

  it("records nothing for a refused deletion", async () => {
    await placed("o1");
    await shipped("o1");
    expect(await deleteOrder(db(), "o1", SYSTEM)).toEqual({ ok: false, reason: "has_shipment" });
    expect(await typesOf("o1")).toEqual(["order.created", "shipment.handed_off"]);
  });

  it("deletes the order as it now is when it changed meanwhile, and records both", async () => {
    await placed("o1");
    // Its first batch is the read; the cancel lands between that read and the delete's write.
    const raced = interleaved(db(), () => updateOrderStatus(db(), "o1", "cancelled", SYSTEM), { atBatch: 2 });
    expect(await deleteOrder(raced, "o1", SYSTEM)).toEqual({ ok: true });
    const events = await eventsOf(db(), "o1");
    expect(events.map((e) => e.type)).toEqual(["order.created", "order.cancelled", "order.deleted"]);
    expect(events[2]!.type === "order.deleted" && events[2]!.data.order.status).toBe("cancelled");
  });
});

afterAll(() => vi.restoreAllMocks());
