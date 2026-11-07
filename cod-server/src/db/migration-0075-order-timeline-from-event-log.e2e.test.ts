/**
 * Migration 0075 on real D1: order_status_history goes, and nothing else
 * does — every order keeps its rows and values, with an empty revision, and
 * its Business Events, which are its timeline from now on.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestD1, type TestD1 } from "@/test-utils/d1";

let d1: TestD1;
const T = "2026-11-07T10:00:00.000Z";

const run = (sql: string, ...binds: unknown[]) => d1.raw.prepare(sql).bind(...binds).run();
const all = async <R = Record<string, unknown>>(sql: string, ...binds: unknown[]) => (await d1.raw.prepare(sql).bind(...binds).all<R>()).results;

beforeAll(async () => {
  d1 = await createTestD1({ before: "0075_order_timeline_from_event_log.sql" });
  await run("INSERT INTO customers (id, name, phone, wilaya, created_at) VALUES ('c1', 'Karim', '0551234567', 'Alger', ?1)", T);
  await run("INSERT INTO orders (id, order_number, customer_id, customer_name, phone, price, status, created_at, updated_at) VALUES ('o1', 'ORD-1', 'c1', 'Karim', '0551234567', 2500, 'confirmed', ?1, ?1)", T);
  await run("INSERT INTO order_status_history (id, order_id, status, timestamp, by) VALUES ('h1', 'o1', 'new', ?1, NULL), ('h2', 'o1', 'confirmed', ?1, 'u1')", T);
  await run(
    "INSERT INTO business_events (id, type, version, subject_type, subject_id, order_id, actor_kind, actor_id, actor_name, origin, occurred_at, recorded_at, data) VALUES ('e1', 'order.confirmed', 1, 'order', 'o1', 'o1', 'staff', 'u1', 'Samira', 'dashboard', ?1, ?1, '{}')",
    T,
  );
  await d1.applyRemaining();
}, 120_000);

afterAll(async () => d1?.dispose());

describe("migration 0075 on a store with orders", () => {
  it("drops order_status_history", async () => {
    expect(await all("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'order_status_history'")).toEqual([]);
  });

  it("keeps every order and its values, with no revision yet", async () => {
    expect(await all("SELECT id, order_number, status, price, revision FROM orders")).toEqual([
      { id: "o1", order_number: "ORD-1", status: "confirmed", price: 2500, revision: null },
    ]);
  });

  it("keeps the order's Business Events, read through their new index", async () => {
    expect(await all("SELECT id, type, actor_name FROM business_events WHERE order_id = 'o1' ORDER BY seq")).toEqual([{ id: "e1", type: "order.confirmed", actor_name: "Samira" }]);
    const plan = await all<{ detail: string }>("EXPLAIN QUERY PLAN SELECT id FROM business_events WHERE order_id = 'o1' ORDER BY seq");
    expect(plan.map((row) => row.detail).join(" ")).toContain("business_events_order");
  });
});
