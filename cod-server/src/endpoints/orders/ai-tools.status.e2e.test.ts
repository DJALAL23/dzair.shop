/**
 * The AI tool that changes an order's status, on real D1: it decides with the
 * same order lifecycle as the route — the processing moves only, nothing once
 * the order has a shipment — and its effects are the route's.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { SYSTEM } from "@/test-utils/events";
import { eq } from "drizzle-orm";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import * as schema from "@/db/schema";
import { handOffToDriver } from "../../../../cod-shared/shipments/handoff";
import { getOrderTools } from "./ai-tools";
import type { OrderStatus } from "../../../../cod-shared/orders/lifecycle";

const T = "2026-10-14T08:00:00.000Z";
let d1: TestD1;

beforeAll(async () => {
  d1 = await createTestD1();
}, 120_000);

afterAll(async () => {
  await d1?.dispose();
});

beforeEach(async () => {
  for (const table of [schema.shipmentEvents, schema.shipments, schema.orderStatusHistory, schema.orders, schema.drivers, schema.customers]) await d1.db.delete(table);
  await d1.db.insert(schema.customers).values({ id: "c1", name: "K", phone: "0551234567", wilaya: "Alger", totalOrders: 1, totalSpent: 1000, createdAt: T });
  await d1.db.insert(schema.drivers).values({ id: "dr1", firstName: "A", lastName: "B", phone: "0661111111", createdAt: T, updatedAt: T });
});

async function order(id: string, status: OrderStatus) {
  await d1.db.insert(schema.orders).values({ id, orderNumber: `ORD-${id}`, customerId: "c1", customerName: "K", phone: "0551234567", address: "12 Rue Didouche Mourad", price: 1000, status, createdAt: T, updatedAt: T });
}

const statusOf = async (id: string) => (await d1.db.select().from(schema.orders).where(eq(schema.orders.id, id)).get())!.status;
const setStatus = (orderId: string, status: string) =>
  (getOrderTools(d1.db, { userId: "u-ada", role: "staff", scopes: [], name: "Ada", email: "ada@example.com" }).updateOrderStatus as unknown as { execute: (args: unknown) => Promise<{ success: boolean; error?: string; newStatus?: string }> }).execute({ orderId, status });

const ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

describe("updateOrderStatus (AI tool)", () => {
  it("makes a move the lifecycle allows, with its effects", async () => {
    await order(ID, "confirmed");
    expect(await setStatus(ID, "ready")).toMatchObject({ success: true, newStatus: "ready" });
    expect(await statusOf(ID)).toBe("ready");
    expect(await setStatus(ID, "cancelled")).toMatchObject({ success: true });
    expect((await d1.db.select().from(schema.customers).get())!.totalSpent).toBe(0);
  });

  it("refuses a move the lifecycle does not allow, naming the allowed ones", async () => {
    await order(ID, "ready");
    const refused = await setStatus(ID, "preparing");
    expect(refused).toMatchObject({ success: false });
    expect(refused.error).toContain("[cancelled]");
    expect(await statusOf(ID)).toBe("ready");
  });

  it("refuses every delivery word — delivery is the shipment's", async () => {
    await order(ID, "ready");
    for (const status of ["out_for_delivery", "delivered", "returned", "dispatched", "assigned"]) {
      expect((await setStatus(ID, status)).success, status).toBe(false);
    }
    expect(await statusOf(ID)).toBe("ready");
  });

  it("refuses any change once the order has a shipment", async () => {
    await order(ID, "ready");
    await handOffToDriver(d1.db, { orderIds: [ID], driverId: "dr1", author: SYSTEM });
    const refused = await setStatus(ID, "cancelled");
    expect(refused).toMatchObject({ success: false });
    expect(refused.error).toContain("shipment");
    expect(await statusOf(ID)).toBe("ready");
  });
});
