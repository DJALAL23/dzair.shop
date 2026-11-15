/**
 * Migration 0088 on real D1: calls without an answer. Every order keeps its
 * data. Each order's count is read from the no-answer moves the Event Log
 * still keeps, its own and no other order's; an order on no answer now has
 * had at least one call, even when the log no longer says so. Every other
 * order starts at none.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestD1, type TestD1 } from "@/test-utils/d1";

let d1: TestD1;
const T = "2026-11-14T08:00:00.000Z";
const all = async <R = Record<string, unknown>>(sql: string, ...binds: unknown[]) => (await d1.raw.prepare(sql).bind(...binds).all<R>()).results;
const plan = async (sql: string) => (await all<{ detail: string }>(`EXPLAIN QUERY PLAN ${sql}`)).map((row) => row.detail).join(" | ");
let before: Array<Record<string, unknown>>;

const order = (id: string, status: string) =>
  `INSERT INTO orders (id, order_number, customer_id, customer_name, phone, wilaya_id, commune_id, price, status, delivery_type, created_at, updated_at) VALUES ('${id}', 'N-${id}', 'c1', 'Amel', '0551234567', 16, 'c-16-001', 3000, '${status}', 'home', '${T}', '${T}')`;
let seq = 0;
const event = (orderId: string, type: string) =>
  `INSERT INTO business_events (id, type, version, subject_type, subject_id, order_id, actor_kind, actor_id, actor_name, origin, occurred_at, recorded_at, data) VALUES ('e${++seq}', '${type}', 1, 'order', '${orderId}', '${orderId}', 'staff', 'u-samira', 'Samira', 'dashboard', '${T}', '${T}', '{}')`;

beforeAll(async () => {
  d1 = await createTestD1({ before: "0088_unanswered_calls.sql" });
  await d1.raw.batch(
    [
      "INSERT INTO customers (id, name, phone, wilaya, created_at) VALUES ('c1', 'Amel', '0551234567', 'Alger', '2026-11-01T00:00:00.000Z')",
      order("o-new", "new"),
      order("o-twice", "unreachable"),
      order("o-pruned", "unreachable"),
      order("o-thrice-cancelled", "cancelled"),
      order("o-once-confirmed", "confirmed"),
      order("o-confirmed", "confirmed"),
      order("o-cancelled", "cancelled"),
      event("o-new", "order.created"),
      event("o-twice", "order.created"),
      event("o-twice", "order.unreachable"),
      event("o-twice", "order.unreachable"),
      event("o-thrice-cancelled", "order.unreachable"),
      event("o-thrice-cancelled", "order.unreachable"),
      event("o-thrice-cancelled", "order.unreachable"),
      event("o-thrice-cancelled", "order.cancelled"),
      event("o-once-confirmed", "order.unreachable"),
      event("o-once-confirmed", "order.confirmed"),
      event("o-confirmed", "order.confirmed"),
      event("o-cancelled", "order.cancelled"),
    ].map((sql) => d1.raw.prepare(sql)),
  );
  before = await all("SELECT * FROM orders ORDER BY id");
  await d1.applyRemaining();
}, 120_000);

afterAll(async () => {
  await d1?.dispose();
});

const calls = async () => Object.fromEntries((await all<{ id: string; unanswered_calls: number }>("SELECT id, unanswered_calls FROM orders ORDER BY id")).map((row) => [row.id, row.unanswered_calls]));

describe("migration 0088", () => {
  it("keeps every order as it was", async () => {
    const after = await all("SELECT * FROM orders ORDER BY id");
    expect(after.map(({ unanswered_calls: _calls, ...row }) => row)).toEqual(before);
  });

  it("counts each order's own calls without an answer from the Event Log, and none for an order that had none", async () => {
    expect(await calls()).toEqual({
      "o-cancelled": 0,
      "o-confirmed": 0,
      "o-new": 0,
      "o-once-confirmed": 1,
      "o-pruned": 1,
      "o-thrice-cancelled": 3,
      "o-twice": 2,
    });
  });

  it("gives an order on no answer whose calls the log no longer holds its one call at least", async () => {
    expect((await all("SELECT unanswered_calls FROM orders WHERE id = 'o-pruned'"))[0]).toEqual({ unanswered_calls: 1 });
  });

  it("starts a new order at none", async () => {
    await d1.raw.prepare(order("o-after", "new")).run();
    expect((await all("SELECT unanswered_calls FROM orders WHERE id = 'o-after'"))[0]).toEqual({ unanswered_calls: 0 });
  });

  it("reads each order's events by the Event Log's order index, never the whole log", async () => {
    expect(await plan("SELECT count(*) FROM business_events e WHERE e.order_id = 'o-twice' AND e.type = 'order.unreachable'")).toMatch(/USING (COVERING )?INDEX business_events_order/);
  });
});
