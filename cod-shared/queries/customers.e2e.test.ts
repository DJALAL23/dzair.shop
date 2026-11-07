/**
 * A customer's totals on real D1, read as every surface reads them
 * (`customerTotals`): every order placed counts, only delivered goods were
 * spent — net of the units refused at the door — and a deleted order leaves
 * no trace.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import * as schema from "../db/schema";
import { getAllCustomers, getCustomerById } from "./customers";
import { getGroupWithMembers } from "./customer-groups";

let d1: TestD1;
const T = (minute: number) => new Date(Date.UTC(2026, 10, 7, 10, minute)).toISOString();

beforeAll(async () => {
  d1 = await createTestD1();
}, 120_000);
afterAll(async () => d1?.dispose());

beforeEach(async () => {
  for (const table of [schema.customerGroupMembers, schema.customerGroups, schema.shipments, schema.orderProducts, schema.orders, schema.customers, schema.drivers]) await d1.db.delete(table);
  await d1.db.insert(schema.drivers).values({ id: "dr1", firstName: "Amine", lastName: "B", phone: "0661111111", createdAt: T(0), updatedAt: T(0) });
  await d1.db.insert(schema.customers).values([
    { id: "c1", name: "Karim", phone: "0551234567", wilaya: "Alger", createdAt: T(0) },
    { id: "c2", name: "Amina", phone: "0661234567", wilaya: "Oran", createdAt: T(0) },
  ]);
});

/** An order of `c1`, with its lines and, once handed off, its shipment's outcome. */
async function order(id: string, at: number, lines: Array<{ total: number; quantity: number; returned?: number }>, outcome: "none" | "in_transit" | "delivered" | "returned", status: "new" | "ready" | "cancelled" = outcome === "none" ? "new" : "ready") {
  await d1.db.insert(schema.orders).values({ id, orderNumber: `ORD-${id}`, customerId: "c1", customerName: "Karim", phone: "0551234567", price: lines.reduce((s, l) => s + l.total, 0), status, createdAt: T(at), updatedAt: T(at) });
  for (const [i, line] of lines.entries()) {
    await d1.db.insert(schema.orderProducts).values({ id: `${id}-l${i}`, orderId: id, productName: "Robe", quantity: line.quantity, returnedQuantity: line.returned ?? 0, pricePerUnit: line.total / line.quantity, lineTotal: line.total, createdAt: T(at) });
  }
  if (outcome === "none") return;
  await d1.db.insert(schema.shipments).values({
    id: `s-${id}`, orderId: id, kind: "driver", driverId: "dr1", handoffState: "accepted", deliveryType: "home", codAmount: 0, revision: "r", createdAt: T(at), updatedAt: T(at),
    deliveredAt: outcome === "delivered" ? T(at + 1) : null, returnedAt: outcome === "returned" ? T(at + 1) : null,
  });
}

describe("a customer's totals", () => {
  it("count every order, spend only the delivered goods they kept, and know the newest order", async () => {
    await order("kept", 1, [{ total: 3000, quantity: 3, returned: 1 }, { total: 1000, quantity: 1 }], "delivered");
    await order("travelling", 2, [{ total: 5000, quantity: 1 }], "in_transit");
    await order("back", 3, [{ total: 7000, quantity: 1 }], "returned");
    await order("dropped", 4, [{ total: 9000, quantity: 1 }], "none", "cancelled");
    await order("fresh", 5, [{ total: 1500, quantity: 1 }], "none");

    // 3000 × 2/3 kept + 1000: the refused unit and every undelivered order are not spent.
    expect(await getCustomerById(d1.db, "c1")).toMatchObject({ totalOrders: 5, totalSpent: 3000, lastOrderAt: T(5) });
  });

  it("are the same in the list, the profile and a group's members", async () => {
    await order("kept", 1, [{ total: 2500, quantity: 1 }], "delivered");
    await d1.db.insert(schema.customerGroups).values({ id: "g", name: "VIP", createdAt: T(0), updatedAt: T(0) });
    await d1.db.insert(schema.customerGroupMembers).values({ id: "m", groupId: "g", customerId: "c1", assignedAt: T(0) });

    const listed = (await getAllCustomers(d1.db)).find((c) => c.id === "c1");
    const member = (await getGroupWithMembers(d1.db, "g"))!.members[0];
    for (const read of [listed, await getCustomerById(d1.db, "c1"), member]) expect(read).toMatchObject({ totalOrders: 1, totalSpent: 2500 });
  });

  it("forget a deleted order, and start at nothing for a customer who never ordered", async () => {
    await order("gone", 1, [{ total: 2500, quantity: 1 }], "none");
    await d1.db.delete(schema.orders).where(eq(schema.orders.id, "gone"));

    expect(await getCustomerById(d1.db, "c1")).toMatchObject({ totalOrders: 0, totalSpent: 0, lastOrderAt: null });
    expect(await getCustomerById(d1.db, "c2")).toMatchObject({ totalOrders: 0, totalSpent: 0, lastOrderAt: null });
  });
});
