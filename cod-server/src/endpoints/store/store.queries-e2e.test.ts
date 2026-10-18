/**
 * createStoreOrder + findOrCreateCustomer — Slice 3 real-D1 E2E.
 *
 * Runs the real migrations on an in-memory miniflare D1 and proves:
 *   • findOrCreateCustomer: concurrent same-phone calls converge to ONE row
 *     (UNIQUE index + ON CONFLICT), stats never split
 *   • createStoreOrder: one atomic batch — order + lines + history + customer
 *     stats + deduction movements all land together
 *   • guarded deduction: inventory goes down by exactly the ordered qty,
 *     movement log carries correct qtyBefore/qtyAfter
 *   • BC-2 oversell: when inventory can't cover the order, the guarded
 *     UPDATE writes 0 rows and the order is rejected whole (no partial writes)
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { Miniflare } from "miniflare";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import type { AppDb } from "@/db";
import {
  findOrCreateCustomer,
  createStoreOrder,
} from "../../../../cod-shared/queries/store";
import { createOrder } from "../../../../cod-shared/queries/orders";
import { assertOrderAddress } from "@/lib/order-address";
import { getPageDocument } from "../../../../cod-shared/queries/page-documents";

const registry: Miniflare[] = [];
let db: AppDb;

beforeAll(async () => {
  const mf = new Miniflare({
    script: "export default { fetch() { return new Response('ok'); } }",
    modules: true,
    d1Databases: { DB: "test-db" },
  });
  registry.push(mf);
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
}, 120_000);

afterAll(async () => {
  for (const mf of registry) await mf.dispose();
});

describe("findOrCreateCustomer — race-free upsert (BC-1)", () => {
  it("converges concurrent same-phone calls to one customer row", async () => {
    const rows = await Promise.all(
      Array.from({ length: 5 }, () =>
        findOrCreateCustomer(db, {
          phone: "0777000001",
          name: "Race Tester",
          wilayaId: 16,
        }),
      ),
    );

    const all = await db
      .select()
      .from(schema.customers)
      .where(eq(schema.customers.phone, "0777000001"))
      .all();
    expect(all).toHaveLength(1);
    expect(new Set(rows.map((r) => r.id)).size).toBe(1);
    expect(rows[0]).toMatchObject({ phone: "0777000001", name: "Race Tester" });
  });

  it("updates the name on an existing phone but keeps stats", async () => {
    const first = await findOrCreateCustomer(db, {
      phone: "0777000002",
      name: "Original Name",
      wilayaId: 16,
    });
    await db
      .update(schema.customers)
      .set({ totalOrders: 5, totalSpent: 9000 })
      .where(eq(schema.customers.id, first.id));

    const second = await findOrCreateCustomer(db, {
      phone: "0777000002",
      name: "Updated Name",
      wilayaId: 16,
    });

    expect(second.id).toBe(first.id);
    expect(second.name).toBe("Updated Name");
    expect(second.totalOrders).toBe(5);
  });
});

describe("createStoreOrder — atomic commit + guarded deduction (BC-2)", () => {
  const phone = "0661234567";

  async function seedTrackedProduct(overrides: Partial<typeof schema.products.$inferInsert> = {}) {
    const id = `prod-${crypto.randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();
    await db.insert(schema.products).values({
      id,
      name: "E2E Product",
      handle: `e2e-${id}`,
      price: 1500,
      hasVariants: false,
      inventory: 10,
      trackInventory: true,
      lowStockThreshold: 2,
      status: "ACTIVE",
      visibility: true,
      showInStore: true,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    });
    return id;
  }

  async function seedCustomer(p: string) {
    return findOrCreateCustomer(db, {
      phone: p,
      name: "E2E Buyer",
      wilayaId: 16,
    });
  }

  it("commits order + line + history + stats + deduction in one batch", async () => {
    const productId = await seedTrackedProduct();
    const customer = await seedCustomer(phone);

    const result = await createStoreOrder(db, {
      customerName: customer.name,
      phone,
      wilayaId: 16,
      communeId: "c-16-001",
      deliveryType: "home",
      productId,
      productName: "E2E Product",
      quantity: 3,
      pricePerUnit: 1500,
      customerId: customer.id,
      deliveryFee: 400,
    });

    expect(result.price).toBe(4500);
    expect(result.deliveryFee).toBe(400);
    expect(result.orderNumber).toMatch(/^ORD-\d{8}-\d{4}$/);

    const order = await db.select().from(schema.orders).where(eq(schema.orders.id, result.id)).get();
    expect(order).toMatchObject({
      status: "new",
      codAmount: 4900,
      customerId: customer.id,
    });

    const lines = await db
      .select()
      .from(schema.orderProducts)
      .where(eq(schema.orderProducts.orderId, result.id))
      .all();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ quantity: 3, lineTotal: 4500 });

    const history = await db
      .select()
      .from(schema.orderStatusHistory)
      .where(eq(schema.orderStatusHistory.orderId, result.id))
      .all();
    expect(history).toHaveLength(1);
    expect(history[0].status).toBe("new");

    const cust = await db.select().from(schema.customers).where(eq(schema.customers.id, customer.id)).get();
    expect(cust?.totalOrders).toBe(1);
    expect(cust?.totalSpent).toBe(4500);

    const product = await db.select().from(schema.products).where(eq(schema.products.id, productId)).get();
    expect(product?.inventory).toBe(7);

    const movements = await db
      .select()
      .from(schema.stockMovements)
      .where(eq(schema.stockMovements.reference, result.id))
      .all();
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({
      type: "ORDER_DEDUCTED",
      delta: -3,
      qtyBefore: 10,
      qtyAfter: 7,
    });
  });

  it("rejects the whole order when inventory cannot cover it (no partial writes)", async () => {
    const productId = await seedTrackedProduct({ inventory: 1 });
    const customer = await seedCustomer("0661234599");

    const ordersBefore = await db.select({ id: schema.orders.id }).from(schema.orders).all();
    const movementsBefore = await db
      .select({ id: schema.stockMovements.id })
      .from(schema.stockMovements)
      .all();

    let failed = false;
    try {
      await createStoreOrder(db, {
        customerName: customer.name,
        phone: "0661234599",
        wilayaId: 16,
        communeId: "c-16-001",
        deliveryType: "home",
        productId,
        productName: "E2E Product",
        quantity: 3,
        pricePerUnit: 1500,
        customerId: customer.id,
        deliveryFee: 400,
      });
    } catch {
      failed = true;
    }

    expect(failed).toBe(true);

    const ordersAfter = await db.select({ id: schema.orders.id }).from(schema.orders).all();
    expect(ordersAfter.length).toBe(ordersBefore.length);

    const movementsAfter = await db
      .select({ id: schema.stockMovements.id })
      .from(schema.stockMovements)
      .all();
    expect(movementsAfter.length).toBe(movementsBefore.length);

    const product = await db.select().from(schema.products).where(eq(schema.products.id, productId)).get();
    expect(product?.inventory).toBe(1);

    const cust = await db.select().from(schema.customers).where(eq(schema.customers.id, customer.id)).get();
    expect(cust?.totalOrders).toBe(0);
    expect(cust?.totalSpent).toBe(0);
  });
});

describe("createStoreOrder — a taken order number is drawn again", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("commits under a fresh number when the first draw is already taken", async () => {
    const productId = `prod-${crypto.randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();
    await db.insert(schema.products).values({
      id: productId,
      name: "Draw Product",
      handle: `draw-${productId}`,
      price: 1500,
      hasVariants: false,
      inventory: 50,
      trackInventory: true,
      lowStockThreshold: 2,
      status: "ACTIVE",
      visibility: true,
      showInStore: true,
      createdAt: now,
      updatedAt: now,
    });
    const phone = "0662345678";
    const customer = await findOrCreateCustomer(db, { phone, name: "Draw Buyer", wilayaId: 16 });
    const order = {
      customerName: customer.name,
      phone,
      wilayaId: 16,
      communeId: "c-16-001",
      deliveryType: "home" as const,
      productId,
      productName: "Draw Product",
      quantity: 1,
      pricePerUnit: 1500,
      customerId: customer.id,
      deliveryFee: 400,
    };

    const first = await createStoreOrder(db, order);

    // The next draw lands on the first order's number; the retry must draw again.
    const taken = Number(first.orderNumber.slice(-4));
    const random = vi.spyOn(Math, "random").mockReturnValueOnce((taken + 0.5) / 10000);
    const second = await createStoreOrder(db, order);

    expect(random.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(second.orderNumber).not.toBe(first.orderNumber);
    expect(second.orderNumber).toMatch(/^ORD-\d{8}-\d{4}$/);
    const saved = await db
      .select({ orderNumber: schema.orders.orderNumber })
      .from(schema.orders)
      .where(eq(schema.orders.orderNumber, second.orderNumber));
    expect(saved).toHaveLength(1);
  });
});

describe("createOrder (dashboard) — a taken order number is drawn again", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("saves the order under a fresh number and returns the number it saved", async () => {
    const phone = "0663456789";
    const customer = await findOrCreateCustomer(db, { phone, name: "Desk Buyer", wilayaId: 16 });
    const now = new Date().toISOString();
    const row = (id: string, orderNumber: string) => ({
      id,
      orderNumber,
      customerId: customer.id,
      customerName: customer.name,
      phone,
      wilayaId: 16,
      price: 1000,
      status: "new" as const,
      createdAt: now,
      updatedAt: now,
    });
    const taken = `ORD-${now.split("T")[0].replace(/-/g, "")}-0077`;
    await createOrder(db, row(crypto.randomUUID(), taken), []);

    const random = vi.spyOn(Math, "random").mockReturnValueOnce(0.5);
    const second = await createOrder(db, row(crypto.randomUUID(), taken), []);

    expect(random).toHaveBeenCalled();
    expect(second.orderNumber).not.toBe(taken);
    expect(second.orderNumber).toMatch(/^ORD-\d{8}-\d{4}$/);
    const saved = await db
      .select({ orderNumber: schema.orders.orderNumber })
      .from(schema.orders)
      .where(eq(schema.orders.id, second.id!))
      .get();
    expect(saved?.orderNumber).toBe(second.orderNumber);
  });
});

describe("assertOrderAddress — an order's wilaya and commune against the reference tables", () => {
  it("accepts a commune of the selected wilaya", async () => {
    await expect(assertOrderAddress(db, { wilayaId: 16, communeId: "c-16-001" })).resolves.toBeUndefined();
  });

  it("refuses a commune from another wilaya as a 400, not a saved contradiction", async () => {
    await expect(assertOrderAddress(db, { wilayaId: 1, communeId: "c-16-001" })).rejects.toMatchObject({
      statusCode: 400,
      code: "MISSING_WILAYA_COMMUNE",
    });
  });

  it("refuses an unknown commune as a 400, not a server error", async () => {
    await expect(assertOrderAddress(db, { wilayaId: 1, communeId: "c-99-999" })).rejects.toMatchObject({
      statusCode: 400,
      code: "MISSING_WILAYA_COMMUNE",
    });
  });

  it("refuses an unknown wilaya", async () => {
    await expect(assertOrderAddress(db, { wilayaId: 77 })).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe("getPageDocument — the store's saved document for one theme and surface", () => {
  async function seedStore(id: string) {
    const now = new Date().toISOString();
    await db.insert(schema.stores).values({ id, name: id, createdAt: now, updatedAt: now } as any).onConflictDoNothing();
  }
  async function save(storeId: string, surface: string, document: string, themeKey = "theme-00", updatedAt = new Date().toISOString()) {
    await db.insert(schema.pageDocuments).values({ id: `pd-${storeId}-${themeKey}-${surface}`, storeId, themeKey, surface, document, createdAt: updatedAt, updatedAt });
  }
  const home = (marker: string) => ({ version: 1, surface: "home", sections: [{ type: "hero", id: marker }] });

  it("is null when the store has never saved one", async () => {
    await seedStore("pd-store-empty");
    expect(await getPageDocument(db, "pd-store-empty", "home")).toBeNull();
    expect(await getPageDocument(db, "pd-store-empty", "home", "theme-00")).toBeNull();
  });

  it("returns the saved document verbatim", async () => {
    await seedStore("pd-store-a");
    const doc = { version: 1, surface: "home", sections: [{ type: "hero", id: "h1" }], meta: { by: "studio" } };
    await save("pd-store-a", "home", JSON.stringify(doc));
    expect(await getPageDocument(db, "pd-store-a", "home", "theme-00")).toEqual(doc);
  });

  it("keeps each theme's document: the requesting theme gets its own", async () => {
    await seedStore("pd-store-t");
    await save("pd-store-t", "home", JSON.stringify(home("zero")), "theme-00", "2026-10-18T10:00:00.000Z");
    await save("pd-store-t", "home", JSON.stringify(home("aurora")), "aurora", "2026-10-18T11:00:00.000Z");
    expect(await getPageDocument(db, "pd-store-t", "home", "theme-00")).toEqual(home("zero"));
    expect(await getPageDocument(db, "pd-store-t", "home", "aurora")).toEqual(home("aurora"));
    expect(await getPageDocument(db, "pd-store-t", "home", "other")).toBeNull();
  });

  it("gives a reader that names no theme the most recently saved document", async () => {
    await seedStore("pd-store-r");
    await save("pd-store-r", "home", JSON.stringify(home("newer")), "aurora", "2026-10-18T12:00:00.000Z");
    await save("pd-store-r", "home", JSON.stringify(home("older")), "theme-00", "2026-10-18T09:00:00.000Z");
    expect(await getPageDocument(db, "pd-store-r", "home")).toEqual(home("newer"));
  });

  it("treats a row that is not a document for this surface as none", async () => {
    await seedStore("pd-store-b");
    await save("pd-store-b", "lp:summer", JSON.stringify({ version: 1, surface: "home", sections: [] }));
    await save("pd-store-b", "home", JSON.stringify({ version: "1", surface: "home", sections: [] }));
    expect(await getPageDocument(db, "pd-store-b", "lp:summer", "theme-00")).toBeNull();
    expect(await getPageDocument(db, "pd-store-b", "home", "theme-00")).toBeNull();
  });

  it("can never hold a row that is not a JSON object", async () => {
    await seedStore("pd-store-j");
    for (const document of ["{not json", "[]", "\"home\""]) {
      await expect(save("pd-store-j", "home", document)).rejects.toThrow();
    }
  });

  it("never answers with another store's document", async () => {
    await seedStore("pd-store-c");
    expect(await getPageDocument(db, "pd-store-c", "home")).toBeNull();
  });
});

