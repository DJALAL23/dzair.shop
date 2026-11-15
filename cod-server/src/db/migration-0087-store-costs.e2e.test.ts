/**
 * Migration 0087 on real D1: the store's own costs and exchange rates. Every
 * existing row stays as it was; the new tables start empty; an amount or a
 * rate is never zero or negative, a cost never ends before it starts and
 * has one version per day at most, a rate is set once per currency and day;
 * and when a product is deleted its cost keeps the product with its last
 * name, and which order lines were of it is kept.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestD1, type TestD1 } from "@/test-utils/d1";

let d1: TestD1;
const T = "2026-11-14T08:00:00.000Z";
const all = async <R = Record<string, unknown>>(sql: string, ...binds: unknown[]) => (await d1.raw.prepare(sql).bind(...binds).all<R>()).results;
const run = (sql: string, ...binds: unknown[]) => d1.raw.prepare(sql).bind(...binds).run();
const plan = async (sql: string) => (await all<{ detail: string }>(`EXPLAIN QUERY PLAN ${sql}`)).map((row) => row.detail).join(" | ");
let before: { products: unknown[]; shipments: unknown[]; lines: Array<Record<string, unknown>> };

const cost = (id: string, over: Record<string, unknown> = {}) => {
  const row = { id, series_id: id, name: "Loyer", category: "rent", charge: "monthly", amount_minor: 3_000_000, currency: "DZD", valid_from: "2026-11-01", valid_to: null, product_id: null, product_name: null, revision: "r", created_at: T, updated_at: T, ...over };
  const columns = Object.keys(row);
  return run(`INSERT INTO costs (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`, ...Object.values(row));
};

beforeAll(async () => {
  d1 = await createTestD1({ before: "0087_store_costs.sql" });
  await d1.raw.batch(
    [
      `INSERT INTO products (id, name, handle, sku, price, status, visibility, show_in_store, track_inventory, inventory, created_at, updated_at) VALUES ('robe', 'Robe', 'robe', 'R-1', 3000, 'ACTIVE', 1, 1, 0, 0, '${T}', '${T}')`,
      `INSERT INTO products (id, name, handle, sku, price, status, visibility, show_in_store, track_inventory, inventory, created_at, updated_at) VALUES ('sac', 'Sac', 'sac', 'S-1', 2000, 'ACTIVE', 1, 1, 0, 0, '${T}', '${T}')`,
      `INSERT INTO customers (id, name, phone, wilaya, created_at) VALUES ('c1', 'Amel', '0551234567', 'Alger', '${T}')`,
      `INSERT INTO orders (id, order_number, customer_id, customer_name, phone, wilaya_id, commune_id, price, status, delivery_type, created_at, updated_at) VALUES ('o1', 'N-1', 'c1', 'Amel', '0551234567', 16, 'c-16-001', 5000, 'ready', 'home', '${T}', '${T}')`,
      `INSERT INTO order_products (id, order_id, product_id, product_name, quantity, price_per_unit, line_total, created_at) VALUES ('l1', 'o1', 'robe', 'Robe', 1, 3000, 3000, '${T}')`,
      `INSERT INTO order_products (id, order_id, product_id, product_name, quantity, price_per_unit, line_total, created_at) VALUES ('l2', 'o1', 'sac', 'Sac', 1, 2000, 2000, '${T}')`,
      `INSERT INTO drivers (id, first_name, last_name, phone, created_at, updated_at) VALUES ('d1', 'Sofiane', 'B', '0661111111', '${T}', '${T}')`,
      `INSERT INTO shipments (id, order_id, kind, driver_id, handoff_state, delivery_type, cod_amount, revision, created_at, updated_at) VALUES ('s1', 'o1', 'driver', 'd1', 'accepted', 'home', 5400, 'r1', '${T}', '${T}')`,
    ].map((sql) => d1.raw.prepare(sql)),
  );
  before = { products: await all("SELECT * FROM products"), shipments: await all("SELECT * FROM shipments"), lines: await all("SELECT * FROM order_products ORDER BY id") };
  await d1.applyRemaining();
}, 120_000);

afterAll(async () => {
  await d1?.dispose();
});

describe("migration 0087", () => {
  it("keeps every product, shipment and order line as it was, and starts with no cost and no rate", async () => {
    expect(await all("SELECT * FROM products")).toEqual(before.products);
    expect(await all("SELECT * FROM shipments")).toEqual(before.shipments);
    expect(await all("SELECT * FROM order_products ORDER BY id")).toEqual(before.lines);
    for (const table of ["costs", "exchange_rates", "removed_product_lines"]) expect(await all(`SELECT count(*) AS n FROM ${table}`)).toEqual([{ n: 0 }]);
  });

  it("refuses an amount of nothing, a cost that ends before it starts, and two versions of a cost on one day", async () => {
    await expect(cost("zero", { amount_minor: 0 })).rejects.toThrow(/CHECK/);
    await expect(cost("backwards", { valid_to: "2026-10-31" })).rejects.toThrow(/CHECK/);
    await cost("one-day", { valid_to: "2026-11-01" });
    await expect(cost("one-day-again", { series_id: "one-day" })).rejects.toThrow(/UNIQUE/);
    await cost("one-day-next", { series_id: "one-day", valid_from: "2026-11-02" });
  });

  it("keeps a deleted product's cost on that product with its last name, and which order lines were of it", async () => {
    await cost("robe-ads", { category: "ads", charge: "daily", product_id: "robe", product_name: "Robe" });
    await run(`INSERT INTO orders (id, order_number, customer_id, customer_name, phone, wilaya_id, commune_id, price, status, delivery_type, created_at, updated_at) VALUES ('o2', 'N-2', 'c1', 'Amel', '0551234567', 16, 'c-16-001', 3000, 'new', 'home', '${T}', '${T}')`);
    await run(`INSERT INTO order_products (id, order_id, product_id, product_name, quantity, price_per_unit, line_total, created_at) VALUES ('l3', 'o2', 'robe', 'Robe', 1, 3000, 3000, '${T}')`);
    await run("UPDATE products SET name = 'Robe longue' WHERE id = 'robe'");
    await run("DELETE FROM products WHERE id = 'robe'");
    expect(await all("SELECT product_id, product_name FROM costs WHERE id = 'robe-ads'")).toEqual([{ product_id: "robe", product_name: "Robe longue" }]);
    expect(await all("SELECT id, product_id, product_name FROM order_products ORDER BY id")).toEqual([
      { id: "l1", product_id: null, product_name: "Robe" },
      { id: "l2", product_id: "sac", product_name: "Sac" },
      { id: "l3", product_id: null, product_name: "Robe" },
    ]);
    expect(await all("SELECT order_product_id, product_id FROM removed_product_lines ORDER BY order_product_id")).toEqual([
      { order_product_id: "l1", product_id: "robe" },
      { order_product_id: "l3", product_id: "robe" },
    ]);
    await run("DELETE FROM orders WHERE id = 'o2'");
    expect(await all("SELECT order_product_id FROM removed_product_lines")).toEqual([{ order_product_id: "l1" }]);
  });

  it("takes one rate per currency and day, never zero", async () => {
    const rate = (id: string, currency: string, centimes: number, day: string) =>
      run("INSERT INTO exchange_rates (id, currency, centimes_per_unit, valid_from, created_at) VALUES (?, ?, ?, ?, ?)", id, currency, centimes, day, T);
    await rate("r1", "USD", 25_000, "2026-11-01");
    await rate("r2", "EUR", 28_000, "2026-11-01");
    await expect(rate("r3", "USD", 26_000, "2026-11-01")).rejects.toThrow(/UNIQUE/);
    await expect(rate("r4", "USD", 0, "2026-11-02")).rejects.toThrow(/CHECK/);
  });

  it("counts shipped and returned parcels by day through their own indexes", async () => {
    expect(await plan("SELECT count(*) FROM shipments s WHERE s.handoff_state = 'accepted' AND s.created_at >= '2026-11-01' AND s.created_at < '2026-12-01'")).toContain("shipments_shipped");
    expect(await plan("SELECT count(*) FROM shipments s WHERE s.returned_at >= '2026-11-01' AND s.returned_at < '2026-12-01'")).toContain("shipments_returned");
  });
});
