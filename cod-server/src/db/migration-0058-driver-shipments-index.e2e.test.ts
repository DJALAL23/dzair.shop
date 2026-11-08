/**
 * Migration 0058 on real D1: an index of each driver's shipments, so the
 * driver's page — the recent deliveries, the cash check and what is left to
 * settle — reads that driver's rows instead of scanning every shipment.
 * Nothing is written: the rows before are the rows after.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestD1, type TestD1 } from "@/test-utils/d1";

let d1: TestD1;
const T = "2026-10-24T10:00:00.000Z";
const all = async <R = Record<string, unknown>>(sql: string) => (await d1.raw.prepare(sql).all<R>()).results;
const plan = async (sql: string) => (await all<{ detail: string }>(`EXPLAIN QUERY PLAN ${sql}`)).map((row) => row.detail).join(" | ");
let before: unknown[];

beforeAll(async () => {
  d1 = await createTestD1({ before: "0058_driver_shipments_index.sql" });
  await d1.raw.batch(
    [
      "INSERT INTO customers (id, name, phone, wilaya, created_at) VALUES ('c1', 'Karim', '0551234567', 'Alger', ?1)",
      "INSERT INTO drivers (id, first_name, last_name, phone, created_at, updated_at) VALUES ('d1', 'Samir', 'B', '0661000000', ?1, ?1)",
      "INSERT INTO orders (id, order_number, customer_id, customer_name, phone, address, price, status, created_at, updated_at) VALUES ('o1', 'ORD-1', 'c1', 'Karim', '0551234567', 'Rue', 1500, 'ready', ?1, ?1)",
      "INSERT INTO shipments (id, order_id, kind, driver_id, handoff_state, delivery_type, cod_amount, revision, delivered_at, created_at, updated_at) VALUES ('s1', 'o1', 'driver', 'd1', 'accepted', 'home', 1900, 'r', ?1, ?1, ?1)",
    ].map((sql) => d1.raw.prepare(sql).bind(T)),
  );
  before = await all("select * from shipments");
  await d1.applyRemaining();
}, 120_000);

afterAll(async () => {
  await d1?.dispose();
});

describe("migration 0058", () => {
  it("keeps every shipment as it was", async () => {
    const columns = Object.keys(before[0] as object);
    const after = (await all("select * from shipments")).map((row) => Object.fromEntries(columns.map((c) => [c, row[c]])));
    expect(after).toEqual(before);
  });

  it("reads a driver's recent deliveries in order, without a sort", async () => {
    const recent = await plan("SELECT id FROM shipments WHERE driver_id = 'd1' ORDER BY created_at DESC LIMIT 10");
    expect(recent).toContain("USING INDEX shipments_driver");
    expect(recent).not.toContain("TEMP B-TREE");
  });

  it("reads the cash check and what is left to settle through the driver's rows only", async () => {
    const cash = await plan("SELECT coalesce(sum(cod_amount), 0) FROM shipments WHERE kind = 'driver' AND driver_id = 'd1' AND delivered_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM driver_payment_lines l WHERE l.shipment_id = shipments.id AND l.component = 'cod')");
    const pending = await plan("SELECT s.id FROM shipments s INNER JOIN orders o ON o.id = s.order_id WHERE s.kind = 'driver' AND s.driver_id = 'd1' AND s.delivered_at IS NOT NULL ORDER BY s.delivered_at DESC");
    for (const read of [cash, pending]) {
      expect(read).toMatch(/SEARCH (shipments|s) USING INDEX shipments_driver/);
      expect(read).not.toMatch(/SCAN (shipments|s)\b/);
    }
  });
});
