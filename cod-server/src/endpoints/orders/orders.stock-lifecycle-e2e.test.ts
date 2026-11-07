/**
 * Stock & customer-stats lifecycle — real D1 (E2E diagnosis matrix)
 *
 * Runs every restock/stats path against real migrations on real D1 (FKs
 * enforced, exactly like production). No mocks for the flows themselves.
 *
 * Invariants under test (senior-dev checklist):
 *   I1  inventory = initial - sold + restocked-from-terminal (never double)
 *   I2  the customer's totalOrders counts their non-deleted orders
 *   I3  the customer's totalSpent counts delivered goods only (none here)
 *   I5  every multi-write flow is atomic — failure leaves NO partial state
 *   I6  stock_movements ledger deltas sum to the real inventory change
 *
 * Fault injection (makeFaultyDb) wraps the REAL d1 and rejects a chosen
 * write — proving atomicity with real SQL rather than mocks.
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
import { makeFaultyDb } from "@/test-utils/faulty-d1";
import {
  createOrder,
  updateOrderStatus,
  setOrderProductReturn,
  deleteOrder,
} from "../../../../cod-shared/queries/orders";

let db: AppDb;
let rawD1: D1Database;

beforeAll(async () => {
  const mf = new Miniflare({
    script: "export default { fetch() { return new Response('ok'); } }",
    modules: true,
    d1Databases: { DB: "test-db" },
  });
  rawD1 = await mf.getD1Database("DB");
  const dir = resolve(__dirname, "../../db/migrations");
  const preparedStatements: D1PreparedStatement[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    const statements = readFileSync(`${dir}/${file}`, "utf8")
      .split("--> statement-breakpoint")
      .flatMap((s) => s.split(/;\s*\n/))
      .map((s) => s.replace(/;+\s*$/, "").trim())
      .filter((s) => s.replace(/--[^\n]*/g, "").trim().length > 0);
    for (const statement of statements) {
      preparedStatements.push(rawD1.prepare(statement));
    }
  }
  for (let i = 0; i < preparedStatements.length; i += 50) {
    await rawD1.batch(preparedStatements.slice(i, i + 50));
  }
  db = drizzle(rawD1 as unknown as D1Database, { schema }) as unknown as AppDb;
  registry.push(mf);
}, 120_000);

const registry: Miniflare[] = [];

afterAll(async () => {
  for (const mf of registry) await mf.dispose();
});

// ─── Fixtures ─────────────────────────────────────────────────────────────────

let seq = 0;

const INITIAL_INVENTORY = 10;

async function seedCustomer() {
  const id = `cust-lc-${++seq}`;
  const now = new Date().toISOString();
  await db.insert(schema.customers).values({
    id, name: "LC Customer", phone: `0555${String(100000 + seq).slice(-6)}`,
    wilaya: "الجزائر",
    createdAt: now,
  });
  return id;
}

async function seedProduct(inventory = INITIAL_INVENTORY) {
  const id = `prod-lc-${++seq}`;
  const now = new Date().toISOString();
  await db.insert(schema.products).values({
    id, name: "LC Product", handle: `lc-product-${seq}`, price: 1000,
    hasVariants: false, inventory, trackInventory: true, lowStockThreshold: 2,
    status: "ACTIVE", visibility: true, showInStore: true,    createdAt: now, updatedAt: now,
  });
  return id;
}

interface SeedOrderOpts {
  qty?: number;
  price?: number;
  codAmount?: number;
}

async function seedOrder(opts: SeedOrderOpts = {}) {
  const { qty = 2, price = 2000, codAmount = 2600 } = opts;
  const customerId = await seedCustomer();
  const productId = await seedProduct();
  const id = `ord-lc-${++seq}`;
  const now = new Date().toISOString();

  await createOrder(
    db,
    {
      id, orderNumber: `ORD-LC-${seq}`, customerId,
      customerName: "LC Customer", phone: "0555000001", price,
      deliveryType: "home", deliveryFee: 0, codAmount,
      createdAt: now, updatedAt: now,
    },
    [{
      id: `op-lc-${seq}`, orderId: id, productId, productName: "LC Product",
      quantity: qty, pricePerUnit: price / qty, lineTotal: price, createdAt: now,
    }], staff("user_1", "Admin")
  );

  return { orderId: id, customerId, productId, lineId: `op-lc-${seq}` };
}

/** The customer received the parcel — the moment units can be refused at the door. */
async function delivered(orderId: string) {
  const now = new Date().toISOString();
  await db.insert(schema.drivers).values({ id: "dr-lc", firstName: "LC", lastName: "Driver", phone: "0661000001", createdAt: now, updatedAt: now }).onConflictDoNothing();
  await db.update(schema.orders).set({ status: "ready" }).where(eq(schema.orders.id, orderId));
  await db.insert(schema.shipments).values({ id: `sh-${orderId}`, orderId, kind: "driver", driverId: "dr-lc", handoffState: "accepted", deliveryType: "home", codAmount: 0, revision: "r", deliveredAt: now, createdAt: now, updatedAt: now });
}

async function inventoryOf(productId: string) {
  return (await db.select({ inv: schema.products.inventory }).from(schema.products)
    .where(eq(schema.products.id, productId)).get())?.inv;
}

/** The customer as the API reads them: their row and the totals read from their orders. */
async function customerOf(customerId: string) {
  const { getCustomerById } = await import("../../../../cod-shared/queries/customers");
  return (await getCustomerById(db, customerId))!;
}

async function lineOf(lineId: string) {
  return (await db.select().from(schema.orderProducts)
    .where(eq(schema.orderProducts.id, lineId)).get())!;
}

async function orderStatus(orderId: string) {
  return (await db.select({ s: schema.orders.status }).from(schema.orders)
    .where(eq(schema.orders.id, orderId)).get())?.s;
}

async function movementsFor(productId: string) {
  const rows = await db.select().from(schema.stockMovements)
    .where(eq(schema.stockMovements.productId, productId)).all();
  // createdAt ties (same-ms ISO) can order arbitrarily — sort, then fall back
  // to numeric-string compare on id for determinism.
  return rows.sort((a, b) =>
    a.createdAt === b.createdAt ? a.id.localeCompare(b.id) : a.createdAt.localeCompare(b.createdAt),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// The matrix
// ─────────────────────────────────────────────────────────────────────────────

describe("stock & customer stats — real D1 lifecycle matrix", () => {
  it("T1: createOrder deducts stock, bumps stats, logs ledger (baseline)", async () => {
    const { orderId, productId, customerId } = await seedOrder();

    expect(await orderStatus(orderId)).toBe("new");
    expect(await inventoryOf(productId)).toBe(INITIAL_INVENTORY - 2); // I1
    expect(await customerOf(customerId)).toMatchObject({ totalOrders: 1, totalSpent: 0 }); // I2/I3: placed, not delivered
    const mv = await movementsFor(productId);
    expect(mv).toHaveLength(1);
    expect(mv[0]).toMatchObject({ type: "ORDER_DEDUCTED", delta: -2, qtyBefore: 10, qtyAfter: 8 }); // I6
  });

  it("T2: manual cancel restocks, rolls back totalSpent, marks lines returned", async () => {
    const { orderId, productId, customerId, lineId } = await seedOrder();

    await updateOrderStatus(db, orderId, "cancelled", SYSTEM);

    expect(await inventoryOf(productId)).toBe(INITIAL_INVENTORY); // I1
    expect(await customerOf(customerId)).toMatchObject({ totalSpent: 0 }); // I3
    expect(await lineOf(lineId)).toMatchObject({ status: "returned", returnedQuantity: 2 });
    const mv = await movementsFor(productId);
    expect(mv.map((m) => m.delta)).toEqual([-2, 2]); // I6
  });

  it("T3: double manual cancel — wasAlreadyTerminal guard prevents double restock", async () => {
    const { orderId, productId } = await seedOrder();

    await updateOrderStatus(db, orderId, "cancelled", SYSTEM);
    await updateOrderStatus(db, orderId, "cancelled", SYSTEM);

    expect(await inventoryOf(productId)).toBe(INITIAL_INVENTORY); // I1
    expect((await movementsFor(productId)).map((m) => m.delta)).toEqual([-2, 2]);
  });

  it("T5: units refused before delivery move nothing; the cancel restocks exactly the sold quantity", async () => {
    const { orderId, productId, lineId } = await seedOrder({ qty: 4, price: 4000 });

    expect(await setOrderProductReturn(db, orderId, lineId, 1, SYSTEM)).toEqual({ ok: false, reason: "not_delivered" });
    expect(await inventoryOf(productId)).toBe(INITIAL_INVENTORY - 4);

    await updateOrderStatus(db, orderId, "cancelled", SYSTEM);
    expect(await inventoryOf(productId)).toBe(INITIAL_INVENTORY); // I1
    expect(await lineOf(lineId)).toMatchObject({ status: "returned", returnedQuantity: 4 });
    expect((await movementsFor(productId)).map((m) => m.delta)).toEqual([-4, 4]); // I6
  });

  it("T6: return correction (2 → 1) on a delivered order — inventory follows the delta", async () => {
    const { orderId, productId, lineId } = await seedOrder({ qty: 4, price: 4000 });
    await delivered(orderId);

    await setOrderProductReturn(db, orderId, lineId, 2, SYSTEM);
    expect(await inventoryOf(productId)).toBe(INITIAL_INVENTORY - 2);

    await setOrderProductReturn(db, orderId, lineId, 1, SYSTEM);
    expect(await inventoryOf(productId)).toBe(INITIAL_INVENTORY - 3); // I1
    expect(await lineOf(lineId)).toMatchObject({ status: "partially_returned", returnedQuantity: 1 });
    expect((await movementsFor(productId)).map((m) => m.delta)).toEqual([-4, 2, -1]); // I6
  });

  it("T9: deleteOrder on an active order — stats and stock fully rolled back", async () => {
    const { orderId, productId, customerId } = await seedOrder();

    await deleteOrder(db, orderId, SYSTEM);

    expect(await inventoryOf(productId)).toBe(INITIAL_INVENTORY); // I1
    expect(await customerOf(customerId)).toMatchObject({ totalOrders: 0, totalSpent: 0 }); // I2/I3
    expect(await db.select().from(schema.orders).where(eq(schema.orders.id, orderId)).get()).toBeUndefined();
  });

  it("T10: cancel THEN delete — the customer's totals are what their remaining orders say", async () => {
    const customerId = await seedCustomer();
    const productId = await seedProduct();
    const orderId = `ord-lc-${++seq}`;
    const now = new Date().toISOString();
    await createOrder(db, {
      id: orderId, orderNumber: `ORD-LC-${seq}`, customerId,
      customerName: "LC Customer", phone: "0555000001", price: 2000,
      deliveryType: "home",
      deliveryFee: 0, codAmount: 2000, createdAt: now, updatedAt: now,
    }, [{
      id: `op-lc-${seq}`, orderId, productId, productName: "LC Product",
      quantity: 2, pricePerUnit: 1000, lineTotal: 2000, createdAt: now,
    }], staff("u1", "A"));

    await updateOrderStatus(db, orderId, "cancelled", SYSTEM);
    await deleteOrder(db, orderId, SYSTEM);

    // I2/I3: the order is gone, so it counts for nothing.
    expect(await customerOf(customerId)).toMatchObject({ totalOrders: 0, totalSpent: 0, lastOrderAt: null });
    expect(await inventoryOf(productId)).toBe(INITIAL_INVENTORY);
  });

  it("T11: oversell (qty > inventory) is rejected atomically — no partial state", async () => {
    const productId = await seedProduct(1); // 1 unit in stock
    const customerId = await seedCustomer();
    const orderId = `ord-lc-${++seq}`;
    const now = new Date().toISOString();

    // qty 2 against 1 unit: the guarded deduction makes the whole batch fail
    await expect(createOrder(db, {
      id: orderId, orderNumber: `ORD-LC-${seq}`, customerId,
      customerName: "LC Customer", phone: "0555000001", price: 2000,
      deliveryType: "home",
      deliveryFee: 0, codAmount: 2000, createdAt: now, updatedAt: now,
    }, [{
      id: `op-lc-${seq}`, orderId, productId, productName: "LC Product",
      quantity: 2, pricePerUnit: 1000, lineTotal: 2000, createdAt: now,
    }], staff("u1", "A"))).rejects.toThrow();

    // Nothing committed: no order, no lines, stats untouched, stock intact
    expect(await db.select().from(schema.orders).where(eq(schema.orders.id, orderId)).get()).toBeUndefined();
    expect(await customerOf(customerId)).toMatchObject({ totalOrders: 0, totalSpent: 0 });
    expect(await inventoryOf(productId)).toBe(1);
    expect(await movementsFor(productId)).toHaveLength(0);
  });

  // ── Atomicity (I5) — real D1 + fault injection ─────────────────────────────

  it("T12: manual cancel fault mid-sequence — must leave NO partial state", async () => {
    const { orderId, productId } = await seedOrder();

    const faulty = makeFaultyDb(rawD1, (sql) =>
      sql.includes('update "products"') && sql.includes("inventory"),
    );

    await expect(
      updateOrderStatus(faulty, orderId, "cancelled", SYSTEM),
    ).rejects.toThrow();

    // I5: if atomic, the status write rolled back too — retry is safe.
    expect(await orderStatus(orderId)).toBe("new");
    expect(await inventoryOf(productId)).toBe(INITIAL_INVENTORY - 2);
  });

  it("T13: createOrder fault mid-sequence — must leave NO ghost order", async () => {
    const customerId = await seedCustomer();
    const productId = await seedProduct();
    const orderId = `ord-lc-${++seq}`;
    const now = new Date().toISOString();

    const faulty = makeFaultyDb(rawD1, (sql) => sql.includes('insert into "order_products"'));

    await expect(
      createOrder(faulty, {
        id: orderId, orderNumber: `ORD-LC-${seq}`, customerId,
        customerName: "LC Customer", phone: "0555000001", price: 2000,
        deliveryType: "home",
        deliveryFee: 0, codAmount: 2000, createdAt: now, updatedAt: now,
      }, [{
        id: `op-lc-${seq}`, orderId, productId, productName: "LC Product",
        quantity: 2, pricePerUnit: 1000, lineTotal: 2000, createdAt: now,
      }], staff("u1", "A")),
    ).rejects.toThrow();

    // I5: the orders row must not exist without its products/stats.
    expect(await db.select().from(schema.orders).where(eq(schema.orders.id, orderId)).get()).toBeUndefined();
    expect(await customerOf(customerId)).toMatchObject({ totalOrders: 0, totalSpent: 0 });
  });

});
