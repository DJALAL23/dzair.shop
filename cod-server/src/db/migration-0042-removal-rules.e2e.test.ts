/**
 * Migration 0042 on real D1: rows written before it keep everything they had,
 * and afterwards the database itself decides what a removal takes with it.
 *
 * Proved here, at the SQL level so no code path can get around it: removing a
 * product keeps the order lines that sold it (without the link) and takes its
 * variants, images, reviews, offers, stock history and landing pages; an order
 * never handed to delivery takes its lines and logs; an order with a shipment
 * cannot be removed at all; and no row is left pointing at something gone —
 * through a foreign key or through the columns that have none.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestD1, type TestD1 } from "@/test-utils/d1";

let d1: TestD1;
const T = "2026-10-16T10:00:00.000Z";

const run = (sql: string, ...binds: unknown[]) => d1.raw.prepare(sql).bind(...binds).run();
const all = async <R = Record<string, unknown>>(sql: string, ...binds: unknown[]) => (await d1.raw.prepare(sql).bind(...binds).all<R>()).results;
const count = async (sql: string, ...binds: unknown[]) => Number((await all<{ n: number }>(sql, ...binds))[0].n);

/** Every row pointing at an id that no longer exists, foreign key or not. */
async function danglingReferences(): Promise<string[]> {
  const checks: Array<[string, string]> = [
    ["order_products.product_id", "select count(*) n from order_products where product_id is not null and product_id not in (select id from products)"],
    ["order_products.variant_id", "select count(*) n from order_products where variant_id is not null and variant_id not in (select id from product_variants)"],
    ["abandoned_orders.product_id", "select count(*) n from abandoned_orders where product_id is not null and product_id not in (select id from products)"],
    ["abandoned_orders.variant_id", "select count(*) n from abandoned_orders where variant_id is not null and variant_id not in (select id from product_variants)"],
    ["abandoned_orders.converted_order_id", "select count(*) n from abandoned_orders where converted_order_id is not null and converted_order_id not in (select id from orders)"],
    ["orders.landing_page_id", "select count(*) n from orders where landing_page_id is not null and landing_page_id not in (select id from landing_pages)"],
    ["translations(product)", "select count(*) n from translations where resource_type = 'product' and resource_id not in (select id from products)"],
  ];
  const found: string[] = [];
  for (const [name, sql] of checks) if ((await count(sql)) > 0) found.push(name);
  const { results } = await d1.raw.prepare("PRAGMA foreign_key_check").all();
  for (const row of results as Array<{ table: string; parent: string }>) found.push(`${row.table} -> ${row.parent}`);
  return found;
}

beforeAll(async () => {
  d1 = await createTestD1({ before: "0042_removal_rules.sql" });
  const seed = [
    "INSERT INTO stores (id, name, created_at, updated_at) VALUES ('s1', 'Store', ?1, ?1)",
    "INSERT INTO customers (id, name, phone, wilaya, created_at) VALUES ('c1', 'Karim', '0551234567', 'Alger', ?1)",
    "INSERT INTO delivery_companies (id, name, name_ar, code, provider, created_at, updated_at) VALUES ('co1', 'ZR', 'ZR', 'zr_express', 'zr_express', ?1, ?1)",
    "INSERT INTO products (id, name, handle, price, has_variants, inventory, track_inventory, created_at, updated_at) VALUES ('p1', 'Robe', 'robe', 1500, 1, 0, 1, ?1, ?1)",
    "INSERT INTO products (id, name, handle, price, created_at, updated_at) VALUES ('p2', 'Foulard', 'foulard', 500, ?1, ?1)",
    "INSERT INTO product_variants (id, product_id, variations, price, sku, inventory, created_at, updated_at) VALUES ('v1', 'p1', '{\"Taille\":\"M\"}', 1500, 'ROBE-M', 4, ?1, ?1)",
    "INSERT INTO product_images (id, product_id, src, r2_key, created_at, updated_at) VALUES ('img1', 'p1', 'https://media/products/a.webp', 'products/a.webp', ?1, ?1)",
    "INSERT INTO stock_movements (id, product_id, variant_id, type, delta, qty_before, qty_after, created_by, created_by_name, created_at) VALUES ('sm1', 'p1', 'v1', 'PURCHASE', 5, 0, 5, 'u', 'U', ?1)",
    "INSERT INTO offers (id, name, trigger_product_id, reward_product_id, created_at, updated_at) VALUES ('of1', 'Gift', 'p2', 'p1', ?1, ?1)",
    "INSERT INTO translations (resource_type, resource_id, locale, key, value, source_digest, updated_at) VALUES ('product', 'p1', 'fr', 'name', 'Robe FR', 'd', ?1)",
    "INSERT INTO landing_pages (id, slug, name, product_id, created_at, updated_at) VALUES ('lp1', 'robe-ete', 'Robe été', 'p1', ?1, ?1)",
    "INSERT INTO landing_page_images (id, landing_page_id, r2_key, src, created_at) VALUES ('lpi1', 'lp1', 'landing/x.webp', 'https://media/landing/x.webp', ?1)",
    "INSERT INTO landing_page_pixel_config (landing_page_id, pixel_id, access_token, created_at, updated_at) VALUES ('lp1', 'px', 'tok', ?1, ?1)",
    // Order A: never handed to delivery, placed from the landing page, with logs.
    "INSERT INTO orders (id, order_number, customer_id, customer_name, phone, price, landing_page_id, created_at, updated_at) VALUES ('oA', 'ORD-A', 'c1', 'Karim', '0551234567', 1500, 'lp1', ?1, ?1)",
    "INSERT INTO order_products (id, order_id, product_id, product_name, variant_id, variant_label, sku, quantity, price_per_unit, line_total, created_at) VALUES ('lA', 'oA', 'p1', 'Robe', 'v1', 'M', 'ROBE-M', 1, 1500, 1500, ?1)",
    "INSERT INTO capi_event_log (id, order_id, event_name, status, sent_at) VALUES ('ce1', 'oA', 'Purchase', 'sent', ?1)",
    "INSERT INTO company_api_logs (id, company_id, order_id, action, method, endpoint, created_at) VALUES ('al1', 'co1', 'oA', 'createShipment', 'POST', '/parcels', ?1)",
    "INSERT INTO reviews (id, store_id, product_id, order_id, order_number, customer_name, rating, body, created_at, updated_at) VALUES ('r1', 's1', 'p1', 'oA', 'ORD-A', 'Karim', 5, 'Top', ?1, ?1)",
    // Order B: delivered by a carrier.
    "INSERT INTO orders (id, order_number, customer_id, customer_name, phone, price, status, created_at, updated_at) VALUES ('oB', 'ORD-B', 'c1', 'Karim', '0551234567', 1500, 'ready', ?1, ?1)",
    "INSERT INTO order_products (id, order_id, product_id, product_name, variant_id, variant_label, sku, quantity, price_per_unit, line_total, created_at) VALUES ('lB', 'oB', 'p1', 'Robe', 'v1', 'M', 'ROBE-M', 2, 1500, 3000, ?1)",
    "INSERT INTO shipments (id, order_id, kind, company_id, handoff_state, carrier_parcel_id, delivery_type, cod_amount, revision, delivered_at, created_at, updated_at) VALUES ('shB', 'oB', 'carrier', 'co1', 'accepted', 'P-1', 'home', 1900, 1, ?1, ?1, ?1)",
    // A checkout left on the product, and one that became order A.
    "INSERT INTO abandoned_orders (id, session_id, customer_name, phone, product_id, product_name, variant_id, created_at, updated_at) VALUES ('ab1', 'sess1', 'Lina', '0661234567', 'p1', 'Robe', 'v1', ?1, ?1)",
    "INSERT INTO abandoned_orders (id, session_id, customer_name, phone, status, converted_order_id, converted_order_number, created_at, updated_at) VALUES ('ab2', 'sess2', 'Karim', '0551234567', 'converted', 'oA', 'ORD-A', ?1, ?1)",
  ];
  await d1.raw.batch(seed.map((sql) => d1.raw.prepare(sql).bind(T)));
  await d1.applyRemaining();
}, 120_000);

afterAll(async () => {
  await d1?.dispose();
});

describe("migration 0042 keeps what was there", () => {
  it("keeps every order line, log and checkout, unchanged", async () => {
    expect(await all("select id, order_id, product_id, product_name, variant_id, variant_label, sku, quantity, price_per_unit, line_total, status, returned_quantity from order_products order by id")).toEqual([
      { id: "lA", order_id: "oA", product_id: "p1", product_name: "Robe", variant_id: "v1", variant_label: "M", sku: "ROBE-M", quantity: 1, price_per_unit: 1500, line_total: 1500, status: "fulfilled", returned_quantity: 0 },
      { id: "lB", order_id: "oB", product_id: "p1", product_name: "Robe", variant_id: "v1", variant_label: "M", sku: "ROBE-M", quantity: 2, price_per_unit: 1500, line_total: 3000, status: "fulfilled", returned_quantity: 0 },
    ]);
    expect(await all("select id, order_id, event_name, status, stage from capi_event_log")).toEqual([{ id: "ce1", order_id: "oA", event_name: "Purchase", status: "sent", stage: "delivered" }]);
    expect(await count("select count(*) n from company_api_logs where order_id = 'oA'")).toBe(1);
    expect(await danglingReferences()).toEqual([]);
  });

  it("adds archived_at, drops deleted_at, and keeps the indexes the reads use", async () => {
    const orderColumns = (await all<{ name: string }>("select name from pragma_table_info('orders')")).map((c) => c.name);
    const productColumns = (await all<{ name: string }>("select name from pragma_table_info('products')")).map((c) => c.name);
    expect(orderColumns).toContain("archived_at");
    expect(productColumns).not.toContain("deleted_at");
    const indexes = (await all<{ name: string }>("select name from sqlite_master where type = 'index'")).map((i) => i.name);
    expect(indexes).toEqual(expect.arrayContaining(["idx_order_products_order", "idx_order_products_product", "idx_capi_event_log_claim", "idx_orders_archived_created_id"]));
  });
});

describe("after 0042, the database decides what a removal takes", () => {
  it("refuses to remove an order that has a shipment, even by hand", async () => {
    await expect(run("DELETE FROM orders WHERE id = 'oB'")).rejects.toThrow(/ORDER_HAS_SHIPMENT/);
    expect(await count("select count(*) n from orders where id = 'oB'")).toBe(1);
  });

  it("removing a product keeps the lines that sold it and takes everything that was its own", async () => {
    await run("DELETE FROM products WHERE id = 'p1'");

    expect(await all("select id, product_id, variant_id, product_name, variant_label, sku, line_total from order_products order by id")).toEqual([
      { id: "lA", product_id: null, variant_id: null, product_name: "Robe", variant_label: "M", sku: "ROBE-M", line_total: 1500 },
      { id: "lB", product_id: null, variant_id: null, product_name: "Robe", variant_label: "M", sku: "ROBE-M", line_total: 3000 },
    ]);
    for (const [table, where] of [
      ["product_variants", "product_id = 'p1'"],
      ["product_images", "product_id = 'p1'"],
      ["reviews", "product_id = 'p1'"],
      ["stock_movements", "product_id = 'p1'"],
      ["offers", "id = 'of1'"],
      ["landing_pages", "id = 'lp1'"],
      ["landing_page_images", "landing_page_id = 'lp1'"],
      ["landing_page_pixel_config", "landing_page_id = 'lp1'"],
      ["translations", "resource_id = 'p1'"],
    ]) {
      expect(await count(`select count(*) n from ${table} where ${where}`), table).toBe(0);
    }
    expect(await all("select id, landing_page_id from orders order by id")).toEqual([{ id: "oA", landing_page_id: null }, { id: "oB", landing_page_id: null }]);
    expect(await all("select id, product_id, variant_id, product_name from abandoned_orders where id = 'ab1'")).toEqual([{ id: "ab1", product_id: null, variant_id: null, product_name: "Robe" }]);
    expect(await count("select count(*) n from products where id = 'p2'")).toBe(1);
    expect(await danglingReferences()).toEqual([]);
  });

  it("removing an order never handed to delivery takes its lines, history and logs", async () => {
    await run("DELETE FROM orders WHERE id = 'oA'");
    expect(await count("select count(*) n from order_products where order_id = 'oA'")).toBe(0);
    expect(await count("select count(*) n from capi_event_log where order_id = 'oA'")).toBe(0);
    expect(await count("select count(*) n from company_api_logs where order_id = 'oA'")).toBe(0);
    expect(await all("select id, status, converted_order_id, converted_order_number from abandoned_orders where id = 'ab2'")).toEqual([
      { id: "ab2", status: "converted", converted_order_id: null, converted_order_number: "ORD-A" },
    ]);
    expect(await danglingReferences()).toEqual([]);
  });

  it("removing a variant keeps the lines and checkouts that named it", async () => {
    await run("INSERT INTO product_variants (id, product_id, variations, price, sku, created_at, updated_at) VALUES ('v2', 'p2', '{}', 500, 'F-1', ?1, ?1)", T);
    await run("INSERT INTO abandoned_orders (id, session_id, customer_name, phone, product_id, product_name, variant_id, created_at, updated_at) VALUES ('ab3', 'sess3', 'Lina', '0661234567', 'p2', 'Foulard', 'v2', ?1, ?1)", T);
    await run("UPDATE order_products SET product_id = 'p2', variant_id = 'v2' WHERE id = 'lB'");
    await run("DELETE FROM product_variants WHERE id = 'v2'");
    expect(await all("select product_id, variant_id from order_products where id = 'lB'")).toEqual([{ product_id: "p2", variant_id: null }]);
    expect(await all("select product_id, variant_id from abandoned_orders where id = 'ab3'")).toEqual([{ product_id: "p2", variant_id: null }]);
    expect(await danglingReferences()).toEqual([]);
  });
});
