/**
 * Migration 0085 on real D1: every row stays as it was, a variant can have its
 * own cost, and each order line written from then on freezes its product's
 * unit cost (the variant's, else the product's) at the moment it is written.
 * An unknown cost stays null, never zero.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestD1, type TestD1 } from "@/test-utils/d1";

let d1: TestD1;
const T = "2026-11-14T08:00:00.000Z";
const all = async <R = Record<string, unknown>>(sql: string) => (await d1.raw.prepare(sql).all<R>()).results;
const run = (sql: string, ...binds: unknown[]) => d1.raw.prepare(sql).bind(...binds).run();
let before: Record<string, Array<Record<string, unknown>>>;

const line = (id: string, product: string | null, variant: string | null, extra = "") =>
  run(
    `INSERT INTO order_products (id, order_id, product_id, product_name, variant_id, quantity, price_per_unit, line_total, created_at${extra ? ", " + extra.split("=")[0] : ""}) VALUES (?1, 'o1', ?2, 'Robe', ?3, 2, 3000, 6000, ?4${extra ? ", " + extra.split("=")[1] : ""})`,
    id,
    product,
    variant,
    T,
  );
const costOf = async (id: string) => (await all<{ unit_cost: number | null; unit_cost_source: string | null }>(`SELECT unit_cost, unit_cost_source FROM order_products WHERE id = '${id}'`))[0];

beforeAll(async () => {
  d1 = await createTestD1({ before: "0085_order_line_cost.sql" });
  await d1.raw.batch(
    [
      "INSERT INTO customers (id, name, phone, wilaya, created_at) VALUES ('c1', 'Amel', '0551234567', 'Alger', ?1)",
      "INSERT INTO orders (id, order_number, customer_id, customer_name, phone, wilaya_id, commune_id, price, status, delivery_type, created_at, updated_at) VALUES ('o1', 'ORD-1', 'c1', 'Amel', '0551234567', 16, 'c-16-001', 6000, 'new', 'home', ?1, ?1)",
      "INSERT INTO products (id, name, handle, price, cost_price, has_variants, created_at, updated_at) VALUES ('robe', 'Robe', 'robe', 3000, 1200, 1, ?1, ?1)",
      "INSERT INTO products (id, name, handle, price, cost_price, created_at, updated_at) VALUES ('sac', 'Sac', 'sac', 2000, 800, ?1, ?1)",
      "INSERT INTO products (id, name, handle, price, created_at, updated_at) VALUES ('lampe', 'Lampe', 'lampe', 2500, ?1, ?1)",
      "INSERT INTO product_variants (id, product_id, variations, price, sku, created_at, updated_at) VALUES ('robe-s', 'robe', '{\"Taille\":\"S\"}', 3000, 'ROBE-S', ?1, ?1)",
      "INSERT INTO product_variants (id, product_id, variations, price, sku, created_at, updated_at) VALUES ('robe-xl', 'robe', '{\"Taille\":\"XL\"}', 3200, 'ROBE-XL', ?1, ?1)",
      "INSERT INTO order_products (id, order_id, product_id, product_name, variant_id, quantity, price_per_unit, line_total, created_at) VALUES ('old', 'o1', 'robe', 'Robe', 'robe-s', 1, 3000, 3000, ?1)",
    ].map((sql) => d1.raw.prepare(sql).bind(T)),
  );
  before = {
    products: await all("SELECT * FROM products ORDER BY id"),
    product_variants: await all("SELECT * FROM product_variants ORDER BY id"),
    order_products: await all("SELECT * FROM order_products ORDER BY id"),
  };
  await d1.applyRemaining();
  await run("UPDATE product_variants SET cost_price = 1500 WHERE id = 'robe-xl'");
}, 120_000);

afterAll(async () => {
  await d1?.dispose();
});

describe("migration 0085", () => {
  it("keeps every product as it was", async () => {
    expect(await all("SELECT * FROM products ORDER BY id")).toEqual(before.products);
  });

  it("keeps every variant, with no cost of its own yet", async () => {
    expect(await all("SELECT * FROM product_variants WHERE id = 'robe-s'")).toEqual(before.product_variants.filter((v) => (v as { id: string }).id === "robe-s").map((v) => ({ ...v, cost_price: null })));
  });

  it("keeps every order line written before, with no cost: it is not known what the product cost then", async () => {
    expect(await all("SELECT * FROM order_products WHERE id = 'old'")).toEqual(before.order_products.map((l) => ({ ...l, unit_cost: null, unit_cost_source: null })));
  });

  it("freezes a variant's own cost on a new line", async () => {
    await line("l-xl", "robe", "robe-xl");
    expect(await costOf("l-xl")).toEqual({ unit_cost: 1500, unit_cost_source: "catalog" });
  });

  it("freezes the product's cost for a variant without its own", async () => {
    await line("l-s", "robe", "robe-s");
    expect(await costOf("l-s")).toEqual({ unit_cost: 1200, unit_cost_source: "catalog" });
  });

  it("freezes the product's cost on a line with no variant", async () => {
    await line("l-sac", "sac", null);
    expect(await costOf("l-sac")).toEqual({ unit_cost: 800, unit_cost_source: "catalog" });
  });

  it("freezes a free gift's real cost: the merchant still pays for what it gives", async () => {
    await run("INSERT INTO order_products (id, order_id, product_id, product_name, quantity, price_per_unit, line_total, reward, created_at) VALUES ('gift', 'o1', 'sac', 'Sac', 1, 0, 0, 1, ?1)", T);
    expect(await costOf("gift")).toEqual({ unit_cost: 800, unit_cost_source: "catalog" });
  });

  it("leaves the cost unknown, never zero, when the product has none or is gone", async () => {
    await line("l-lampe", "lampe", null);
    await line("l-gone", null, null);
    expect(await costOf("l-lampe")).toEqual({ unit_cost: null, unit_cost_source: null });
    expect(await costOf("l-gone")).toEqual({ unit_cost: null, unit_cost_source: null });
  });

  it("keeps a cost written with the line", async () => {
    await line("l-given", "sac", null, "unit_cost=650");
    expect(await costOf("l-given")).toEqual({ unit_cost: 650, unit_cost_source: null });
  });

  it("never rewrites a past line when the catalog's cost changes", async () => {
    await run("UPDATE products SET cost_price = 999 WHERE id IN ('robe', 'sac')");
    await run("UPDATE product_variants SET cost_price = 1999 WHERE id = 'robe-xl'");
    expect(await costOf("l-xl")).toEqual({ unit_cost: 1500, unit_cost_source: "catalog" });
    expect(await costOf("l-s")).toEqual({ unit_cost: 1200, unit_cost_source: "catalog" });
    expect(await costOf("l-sac")).toEqual({ unit_cost: 800, unit_cost_source: "catalog" });
    await line("l-after", "sac", null);
    expect(await costOf("l-after")).toEqual({ unit_cost: 999, unit_cost_source: "catalog" });
  });
});
