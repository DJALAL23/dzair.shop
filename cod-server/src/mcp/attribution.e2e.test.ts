/**
 * What an agent writes through MCP is recorded as the work of the person who
 * granted the access — never as a fixed "ai-agent", and never under a name
 * the model chose — on real D1: an order created, its status changed, a line
 * returned, a driver settled, stock adjusted.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import * as schema from "@/db/schema";
import { buildToolsForUser } from "./registry";
import { executeMcpTool } from "./execute-tool";
import type { McpProps } from "./props";
import { handOffToDriver } from "../../../cod-shared/shipments/handoff";
import { recordShipmentEvents } from "../../../cod-shared/shipments/record-events";

const dbModule = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/db", () => dbModule);

const T = "2026-10-14T08:00:00.000Z";
const ORDER = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const LINE = "1b4e28ba-2fa1-41d2-883f-0016d3cca427";
const PRODUCT = "6fa459ea-ee8a-4ca4-894e-db77e160355e";
const CUSTOMER = "16fd2706-8baf-433b-82eb-8c7fada847da";
const ada: McpProps = { userId: "u-ada", role: "admin", scopes: [], name: "Ada", email: "ada@example.com" };
let d1: TestD1;

beforeAll(async () => {
  d1 = await createTestD1();
}, 120_000);

afterAll(async () => {
  await d1?.dispose();
});

beforeEach(async () => {
  dbModule.getDb.mockReturnValue(d1.db);
  for (const table of [schema.driverPaymentLines, schema.driverPayments, schema.shipmentEvents, schema.shipments, schema.stockMovements, schema.orderStatusHistory, schema.orderProducts, schema.orders, schema.products, schema.customers, schema.drivers]) {
    await d1.db.delete(table);
  }
  await d1.db.insert(schema.customers).values({ id: CUSTOMER, name: "Karim", phone: "0551234567", wilaya: "Alger", wilayaId: 16, createdAt: T });
  await d1.db.insert(schema.products).values({
    id: PRODUCT, name: "Robe", handle: "robe", price: 1000, hasVariants: false, inventory: 10, trackInventory: true,
    lowStockThreshold: 1, status: "ACTIVE", visibility: true, showInStore: true, createdAt: T, updatedAt: T,
  });
  await d1.db.insert(schema.orders).values({ id: ORDER, orderNumber: "ORD-1", customerId: CUSTOMER, customerName: "Karim", phone: "0551234567", address: "12 Rue Didouche Mourad", wilayaId: 16, price: 2000, codAmount: 2000, status: "confirmed", createdAt: T, updatedAt: T });
  await d1.db.insert(schema.orderProducts).values({ id: LINE, orderId: ORDER, productId: PRODUCT, productName: "Robe", quantity: 2, pricePerUnit: 1000, lineTotal: 2000, createdAt: T });
  await d1.db.insert(schema.drivers).values({ id: "dr1", firstName: "Amine", lastName: "B", phone: "0661111111", createdAt: T, updatedAt: T });
});

async function run(name: string, args: Record<string, unknown>) {
  const tool = buildToolsForUser({ DB: d1.raw } as never, ada)[name];
  const result = await executeMcpTool({ db: d1.db, actor: { id: ada.userId, name: ada.name, role: ada.role }, name, tool, args });
  const out = result.structuredContent as { success: boolean; error?: string };
  expect(out, `${name}: ${out.error}`).toMatchObject({ success: true });
  return out as any;
}

const movements = () => d1.db.select().from(schema.stockMovements).all();

describe("an agent's writes are the granting person's", () => {
  it("an order's status change and a line return", async () => {
    await run("updateOrderStatus", { orderId: ORDER, status: "ready" });
    const history = await d1.db.select().from(schema.orderStatusHistory).where(eq(schema.orderStatusHistory.orderId, ORDER)).all();
    expect(history.map((h) => [h.status, h.by])).toEqual([["ready", "u-ada"]]);

    await run("recordOrderProductReturn", { orderId: ORDER, productLineId: LINE, returnedQuantity: 1 });
    expect((await movements()).map((m) => [m.type, m.createdBy, m.createdByName])).toEqual([["ORDER_RETURNED", "u-ada", "Ada"]]);
  });

  it("an order created", async () => {
    const commune = (await d1.db.select({ id: schema.communes.id }).from(schema.communes).where(eq(schema.communes.wilayaId, 16)).get())!.id;
    await run("createOrder", {
      customerId: CUSTOMER, customerName: "Karim", phone: "0551234567", wilayaId: 16, communeId: commune, address: "12 Rue Didouche", price: 1000, orderType: "offline", deliveryFee: 0,
      products: [{ productId: PRODUCT, productName: "Robe", quantity: 1, pricePerUnit: 1000, lineTotal: 1000 }],
    });
    expect((await movements()).map((m) => [m.type, m.createdBy, m.createdByName])).toEqual([["ORDER_DEDUCTED", "u-ada", "Ada"]]);
  });

  it("a driver settled — the model names no one", async () => {
    await d1.db.update(schema.orders).set({ status: "ready" }).where(eq(schema.orders.id, ORDER));
    const [handoff] = await handOffToDriver(d1.db, { orderIds: [ORDER], driverId: "dr1", createdBy: null });
    if (!handoff.ok) throw new Error(handoff.reason);
    await recordShipmentEvents(d1.db, handoff.shipmentId, [
      { source: "merchant", status: { vocabulary: "driver", value: "delivered" }, interpretation: { kind: "milestone", milestone: "delivered" }, occurredAt: new Date().toISOString() },
    ]);
    await run("createDriverSettlement", { driverId: "dr1", type: "cod_remittance", shipmentIds: [handoff.shipmentId], agentName: "Totally the owner" });
    expect(await d1.db.select({ by: schema.driverPayments.createdBy, name: schema.driverPayments.createdByName }).from(schema.driverPayments).all()).toEqual([{ by: "u-ada", name: "Ada" }]);
  });

  it("stock adjusted", async () => {
    await run("adjustProductStock", { productId: PRODUCT, type: "PURCHASE", delta: 5 });
    expect((await movements()).map((m) => [m.type, m.delta, m.createdBy, m.createdByName])).toEqual([["PURCHASE", 5, "u-ada", "Ada"]]);
  });
});
