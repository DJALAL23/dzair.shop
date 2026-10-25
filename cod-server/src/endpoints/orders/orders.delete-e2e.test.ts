/**
 * deleteOrder — real D1 (E2E)
 *
 * Regression: deleting an order with carrier-API audit rows (company_api_logs
 * references orders(id) with ON DELETE no action) failed with FOREIGN KEY
 * constraint failed. The order's shipment, its events and history cascade;
 * the inbox rows that recorded the shipment's events stay, unlinked
 * (webhook_events.shipment_id is SET NULL), as the carrier's record.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { SYSTEM, staff } from "@/test-utils/events";
import { Miniflare } from "miniflare";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import type { AppDb } from "@/db";
import { archiveOrder, deleteOrder } from "../../../../cod-shared/queries/orders";

let db: AppDb;

beforeAll(async () => {
  const mf = new Miniflare({
    script: "export default { fetch() { return new Response('ok'); } }",
    modules: true,
    d1Databases: { DB: "test-db" },
  });
  const d1 = await mf.getD1Database("DB");
  const dir = resolve(__dirname, "../../db/migrations");
  const preparedStatements: D1PreparedStatement[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    const statements = readFileSync(`${dir}/${file}`, "utf8")
      .split("--> statement-breakpoint")
      .flatMap((s) => s.split(/;\s*\n/))
      .map((s) => s.replace(/;+\s*$/, "").trim())
      .filter((s) => s.replace(/--[^\n]*/g, "").trim().length > 0);
    for (const statement of statements) {
      preparedStatements.push(d1.prepare(statement));
    }
  }
  for (let i = 0; i < preparedStatements.length; i += 50) {
    await d1.batch(preparedStatements.slice(i, i + 50));
  }
  db = drizzle(d1 as unknown as D1Database, { schema }) as unknown as AppDb;
  registry.push(mf);
}, 120_000);

const registry: Miniflare[] = [];

afterAll(async () => {
  for (const mf of registry) await mf.dispose();
});

async function seedOrder(id: string, withCarrierActivity: boolean) {
  const now = new Date().toISOString();
  await db.insert(schema.customers).values({
    id: `cust-${id}`, name: "E2E Customer", phone: `0555${id.slice(-6)}`,
    wilaya: "الجزائر", totalOrders: 1, totalSpent: 2000, createdAt: now,
  });
  await db.insert(schema.orders).values({
    id, orderNumber: `ORD-${id}`, customerId: `cust-${id}`,
    customerName: "E2E Customer", phone: "0555000001", price: 2000,
    status: "ready", deliveryType: "home",
    deliveryFee: 0, codAmount: 2000, createdAt: now, updatedAt: now,
  });
  await db.insert(schema.orderProducts).values({
    id: `op-${id}`, orderId: id, productId: "prod-e2e-del", productName: "E2E Product",
    quantity: 2, pricePerUnit: 1000, lineTotal: 2000, createdAt: now,
  });
  await db.insert(schema.orderStatusHistory).values({
    id: `hist-${id}`, orderId: id, status: "ready", timestamp: now, by: null,
  });

  if (withCarrierActivity) {
    await db.insert(schema.deliveryCompanies).values({
      id: "comp-e2e-del", name: "E2E Carrier", nameAr: "E2E Carrier", code: "e2e-carrier",
      active: true, createdAt: now, updatedAt: now,
    });
    await db.insert(schema.shipments).values({
      id: `ship-${id}`, orderId: id, kind: "carrier", companyId: "comp-e2e-del", handoffState: "accepted",
      carrierParcelId: `TRK-${id}`, trackingNumber: `TRK-${id}`, deliveryType: "home", codAmount: 2000,
      deliveredAt: now, revision: "r", createdAt: now, updatedAt: now,
    });
    await db.insert(schema.companyApiLogs).values({
      id: `log-${id}`, companyId: "comp-e2e-del", orderId: id,
      action: "create_shipment", method: "POST", endpoint: "/api/public/create/order",
      createdAt: now,
    });
    await db.insert(schema.webhookEvents).values({
      id: `evt-${id}`, provider: "zr_express", eventId: `evt-${id}`,
      companyId: "comp-e2e-del", shipmentId: `ship-${id}`, tracking: `TRK-${id}`,
      eventType: "parcel.state.updated", rawPayload: "{}", result: "ok",
      createdAt: now,
    });
    await db.insert(schema.shipmentEvents).values({
      id: `se-${id}`, shipmentId: `ship-${id}`, source: "webhook", eventKey: `state:livre@${now}`, vocabulary: "state",
      providerStatus: "livre", interpretation: "milestone", milestone: "delivered", occurredAt: now, recordedAt: now, webhookEventId: `evt-${id}`,
    });
  }
}

describe("deleteOrder — real D1 (E2E)", () => {
  beforeAll(async () => {
    const now = new Date().toISOString();
    await db.insert(schema.products).values({
      id: "prod-e2e-del", name: "E2E Product", handle: "e2e-product-del", price: 1000,
      hasVariants: false, inventory: 5, trackInventory: true, lowStockThreshold: 2,
      status: "ACTIVE", visibility: true, showInStore: true,      createdAt: now, updatedAt: now,
    });
  });

  it("keeps a delivered order whole — its shipment, events, logs and inbox rows; it is archived instead", async () => {
    await seedOrder("ord-e2e-del-1", true);

    expect(await deleteOrder(db, "ord-e2e-del-1", SYSTEM)).toEqual({ ok: false, reason: "has_shipment" });

    expect(await db.select().from(schema.orders).where(eq(schema.orders.id, "ord-e2e-del-1")).get()).toBeDefined();
    expect(await db.select().from(schema.orderProducts).where(eq(schema.orderProducts.orderId, "ord-e2e-del-1")).all()).toHaveLength(1);
    expect(await db.select().from(schema.shipmentEvents).where(eq(schema.shipmentEvents.shipmentId, "ship-ord-e2e-del-1")).all()).toHaveLength(1);
    expect(await db.select().from(schema.companyApiLogs).where(eq(schema.companyApiLogs.orderId, "ord-e2e-del-1")).all()).toHaveLength(1);
    expect(await db.select().from(schema.webhookEvents).where(eq(schema.webhookEvents.id, "evt-ord-e2e-del-1")).get()).toMatchObject({ shipmentId: "ship-ord-e2e-del-1" });

    expect(await archiveOrder(db, "ord-e2e-del-1")).toMatchObject({ ok: true, archivedAt: expect.any(String) });
  });

  it("an order whose handoff was refused has carrier logs and no shipment: deleting it takes the logs too", async () => {
    await seedOrder("ord-e2e-del-3", false);
    const now = new Date().toISOString();
    await db.insert(schema.companyApiLogs).values({
      id: "log-refused", companyId: "comp-e2e-del", orderId: "ord-e2e-del-3",
      action: "create_shipment", method: "POST", endpoint: "/api/public/create/order", success: false, createdAt: now,
    });
    await db.insert(schema.capiEventLog).values({ id: "capi-3", orderId: "ord-e2e-del-3", eventName: "Lead", stage: "placed", status: "sent", sentAt: now });

    expect(await deleteOrder(db, "ord-e2e-del-3", SYSTEM)).toEqual({ ok: true });

    expect(await db.select().from(schema.companyApiLogs).where(eq(schema.companyApiLogs.orderId, "ord-e2e-del-3")).all()).toHaveLength(0);
    expect(await db.select().from(schema.capiEventLog).where(eq(schema.capiEventLog.orderId, "ord-e2e-del-3")).all()).toHaveLength(0);
    expect(await db.select().from(schema.orderStatusHistory).where(eq(schema.orderStatusHistory.orderId, "ord-e2e-del-3")).all()).toHaveLength(0);
  });

  it("deletes an order with no carrier activity", async () => {
    await seedOrder("ord-e2e-del-2", false);

    await deleteOrder(db, "ord-e2e-del-2", SYSTEM);

    expect(await db.select().from(schema.orders).where(eq(schema.orders.id, "ord-e2e-del-2")).get()).toBeUndefined();
  });
});
