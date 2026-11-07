/**
 * Migration 0074 on real D1: landing_pages loses its render count, and keeps
 * every page with every other value; the orders attributed to a page keep
 * their attribution.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestD1, type TestD1 } from "@/test-utils/d1";

let d1: TestD1;
const T = "2026-11-07T10:00:00.000Z";

const run = (sql: string, ...binds: unknown[]) => d1.raw.prepare(sql).bind(...binds).run();
const all = async <R = Record<string, unknown>>(sql: string, ...binds: unknown[]) => (await d1.raw.prepare(sql).bind(...binds).all<R>()).results;

beforeAll(async () => {
  d1 = await createTestD1({ before: "0074_drop_landing_page_views.sql" });
  await run("INSERT INTO products (id, name, handle, price, created_at, updated_at) VALUES ('p1', 'Zinc', 'zinc', 2500, ?1, ?1)", T);
  await run(
    "INSERT INTO landing_pages (id, slug, name, product_id, status, views, published_at, created_at, updated_at) VALUES ('lp1', 'zinc-v3', 'Zinc v3', 'p1', 'published', 1240, ?1, ?1, ?1)",
    T,
  );
  await run("INSERT INTO customers (id, name, phone, wilaya, created_at) VALUES ('c1', 'Karim', '0551234567', 'Alger', ?1)", T);
  await run(
    "INSERT INTO orders (id, order_number, customer_id, customer_name, phone, price, landing_page_id, created_at, updated_at) VALUES ('o1', 'CF-1', 'c1', 'Karim', '0551234567', 2500, 'lp1', ?1, ?1)",
    T,
  );
  await d1.applyRemaining();
}, 120_000);

afterAll(async () => d1?.dispose());

describe("migration 0074 on a store with landing pages", () => {
  it("drops the render count", async () => {
    const columns = await all<{ name: string }>("SELECT name FROM pragma_table_info('landing_pages')");
    expect(columns.map((c) => c.name)).not.toContain("views");
  });

  it("keeps every page and its other values", async () => {
    expect(await all("SELECT id, slug, name, product_id, status, published_at FROM landing_pages")).toEqual([
      { id: "lp1", slug: "zinc-v3", name: "Zinc v3", product_id: "p1", status: "published", published_at: T },
    ]);
  });

  it("keeps the orders' attribution to the page", async () => {
    expect(await all("SELECT id, landing_page_id FROM orders")).toEqual([{ id: "o1", landing_page_id: "lp1" }]);
  });
});
