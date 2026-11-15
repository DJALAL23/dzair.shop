/**
 * Migration 0083 on real D1: orders and abandoned checkouts keep every row as
 * it was, an abandoned checkout gains an empty `attribution_json`, and an
 * order's attribution goes with the order.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import * as schema from "@/db/schema";

let d1: TestD1;
const T = "2026-11-11T08:00:00.000Z";
const all = async <R = Record<string, unknown>>(sql: string) => (await d1.raw.prepare(sql).all<R>()).results;
let ordersBefore: unknown[];
let abandonedBefore: Array<Record<string, unknown>>;

beforeAll(async () => {
  d1 = await createTestD1({ before: "0083_order_attribution.sql" });
  await d1.raw.batch(
    [
      "INSERT INTO customers (id, name, phone, wilaya, created_at) VALUES ('c1', 'Amel', '0551234567', 'Alger', ?1)",
      "INSERT INTO orders (id, order_number, customer_id, customer_name, phone, wilaya_id, commune_id, price, status, delivery_type, fbc, created_at, updated_at) VALUES ('o1', 'ORD-1', 'c1', 'Amel', '0551234567', 16, 'c-16-001', 3000, 'new', 'home', 'fb.1.1709136167115.IwAR2F4', ?1, ?1)",
      "INSERT INTO orders (id, order_number, customer_id, customer_name, phone, wilaya_id, commune_id, price, status, delivery_type, created_at, updated_at) VALUES ('o2', 'ORD-2', 'c1', 'Amel', '0551234567', 16, 'c-16-001', 1500, 'new', 'home', ?1, ?1)",
      "INSERT INTO abandoned_orders (id, session_id, customer_name, phone, fbc, status, created_at, updated_at) VALUES ('a1', 's1', 'Amel', '0551234567', 'fb.1.1709136167115.IwAR2F4', 'abandoned', ?1, ?1)",
    ].map((sql) => d1.raw.prepare(sql).bind(T)),
  );
  ordersBefore = await all("SELECT * FROM orders ORDER BY id");
  abandonedBefore = await all("SELECT * FROM abandoned_orders ORDER BY id");
  await d1.applyRemaining();
}, 120_000);

afterAll(async () => {
  await d1?.dispose();
});

describe("migration 0083", () => {
  it("keeps every order as it was", async () => {
    const columns = Object.keys(ordersBefore[0] ?? {});
    expect((await all("SELECT * FROM orders ORDER BY id")).map((row) => Object.fromEntries(columns.map((column) => [column, (row as Record<string, unknown>)[column]])))).toEqual(ordersBefore);
  });

  it("keeps every abandoned checkout, with no attribution yet", async () => {
    expect(await all("SELECT * FROM abandoned_orders ORDER BY id")).toEqual(abandonedBefore.map((row) => ({ ...row, attribution_json: null })));
  });

  it("attributes no order until one is placed", async () => {
    expect(await all("SELECT * FROM order_attribution")).toEqual([]);
  });

  it("stores an attribution the schema describes, and drops it with its order", async () => {
    await d1.db.insert(schema.orderAttribution).values({ orderId: "o2", method: "captured", platform: "meta", adId: "120200000000000001", capturedAt: T, createdAt: T, updatedAt: T });
    expect(await d1.db.select({ adId: schema.orderAttribution.adId }).from(schema.orderAttribution).where(eq(schema.orderAttribution.orderId, "o2")).get()).toEqual({ adId: "120200000000000001" });

    await d1.raw.prepare("DELETE FROM orders WHERE id = 'o2'").run();
    expect(await all("SELECT order_id FROM order_attribution")).toEqual([]);
  });

  it("refuses an attribution for an order that does not exist", async () => {
    await expect(
      d1.raw.prepare("INSERT INTO order_attribution (order_id, method, platform, created_at, updated_at) VALUES ('missing', 'captured', 'direct', ?1, ?1)").bind(T).run(),
    ).rejects.toThrow(/FOREIGN KEY/);
  });

  it("reads and writes an abandoned checkout's attribution through the schema", async () => {
    await d1.db.update(schema.abandonedOrders).set({ attributionJson: '{"first":null}' }).where(eq(schema.abandonedOrders.id, "a1"));
    expect(await d1.db.select().from(schema.abandonedOrders).where(eq(schema.abandonedOrders.id, "a1")).get()).toMatchObject({ attributionJson: '{"first":null}', fbc: "fb.1.1709136167115.IwAR2F4" });
  });
});
