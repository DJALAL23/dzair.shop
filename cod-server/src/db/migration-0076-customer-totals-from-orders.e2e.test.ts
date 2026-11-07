/**
 * Migration 0076 on real D1: the customers' three running counters go, and
 * every customer keeps every other value, with their orders untouched.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestD1, type TestD1 } from "@/test-utils/d1";

let d1: TestD1;
const T = "2026-11-07T10:00:00.000Z";

const run = (sql: string, ...binds: unknown[]) => d1.raw.prepare(sql).bind(...binds).run();
const all = async <R = Record<string, unknown>>(sql: string, ...binds: unknown[]) => (await d1.raw.prepare(sql).bind(...binds).all<R>()).results;

beforeAll(async () => {
  d1 = await createTestD1({ before: "0076_customer_totals_from_orders.sql" });
  await run("INSERT INTO customers (id, name, phone, wilaya, email, total_orders, total_spent, last_order_at, created_at) VALUES ('c1', 'Karim', '0551234567', 'Alger', 'karim@example.com', 4, 12000, ?1, ?1)", T);
  await run("INSERT INTO orders (id, order_number, customer_id, customer_name, phone, price, created_at, updated_at) VALUES ('o1', 'ORD-1', 'c1', 'Karim', '0551234567', 2500, ?1, ?1)", T);
  await d1.applyRemaining();
}, 120_000);

afterAll(async () => d1?.dispose());

describe("migration 0076 on a store with customers", () => {
  it("drops the three counters", async () => {
    const columns = (await all<{ name: string }>("SELECT name FROM pragma_table_info('customers')")).map((c) => c.name);
    for (const gone of ["total_orders", "total_spent", "last_order_at"]) expect(columns).not.toContain(gone);
  });

  it("keeps every customer, their other values and their orders", async () => {
    expect(await all("SELECT id, name, phone, wilaya, email, created_at FROM customers")).toEqual([
      { id: "c1", name: "Karim", phone: "0551234567", wilaya: "Alger", email: "karim@example.com", created_at: T },
    ]);
    expect(await all("SELECT id, customer_id FROM orders")).toEqual([{ id: "o1", customer_id: "c1" }]);
  });
});
