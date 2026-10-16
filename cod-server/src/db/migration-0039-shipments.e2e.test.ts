/**
 * Migration 0039 on real D1: the shipment tables match their Drizzle
 * definitions column for column, and the database itself refuses every
 * shipment the model calls impossible — so a bug in code cannot store one.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { getTableColumns, getTableName } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import * as schema from "@/db/schema";

let d1: TestD1;
const NOW = "2026-10-14T10:00:00.000Z";

beforeAll(async () => {
  d1 = await createTestD1();
}, 120_000);

afterAll(async () => {
  await d1?.dispose();
});

beforeEach(async () => {
  await d1.raw.batch([
    d1.raw.prepare("DELETE FROM driver_payment_lines"),
    d1.raw.prepare("DELETE FROM shipment_events"),
    d1.raw.prepare("DELETE FROM shipments"),
    d1.raw.prepare("DELETE FROM driver_payments"),
    d1.raw.prepare("DELETE FROM orders"),
    d1.raw.prepare("DELETE FROM customers"),
    d1.raw.prepare("DELETE FROM drivers"),
    d1.raw.prepare("DELETE FROM delivery_companies"),
  ]);
  await d1.raw.batch([
    d1.raw.prepare("INSERT INTO customers (id, name, phone, wilaya, created_at) VALUES ('c1', 'Karim', '0551234567', 'Alger', ?)").bind(NOW),
    d1.raw.prepare("INSERT INTO orders (id, order_number, customer_id, customer_name, phone, price, created_at, updated_at) VALUES ('o1', 'ORD-1', 'c1', 'Karim', '0551234567', 1000, ?, ?)").bind(NOW, NOW),
    d1.raw.prepare("INSERT INTO orders (id, order_number, customer_id, customer_name, phone, price, created_at, updated_at) VALUES ('o2', 'ORD-2', 'c1', 'Karim', '0551234567', 1000, ?, ?)").bind(NOW, NOW),
    d1.raw.prepare("INSERT INTO delivery_companies (id, name, name_ar, code, provider, created_at, updated_at) VALUES ('co1', 'Yalidine', 'ياليدين', 'yalidine', 'yalidine', ?, ?)").bind(NOW, NOW),
    d1.raw.prepare("INSERT INTO drivers (id, first_name, last_name, phone, created_at, updated_at) VALUES ('dr1', 'Amine', 'B', '0661111111', ?, ?)").bind(NOW, NOW),
  ]);
});

type Row = Record<string, string | number | null>;
const CARRIER: Row = { kind: "carrier", company_id: "co1", handoff_state: "accepted", carrier_parcel_id: "yal-1", tracking_number: "yal-1" };
const DRIVER: Row = { kind: "driver", driver_id: "dr1", handoff_state: "accepted" };

function insertShipment(row: Row, id = "s1", orderId = "o1") {
  const full: Row = { id, order_id: orderId, delivery_type: "home", cod_amount: 1400, revision: `r-${id}`, created_at: NOW, updated_at: NOW, ...row };
  const cols = Object.keys(full);
  return d1.raw.prepare(`INSERT INTO shipments (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`).bind(...cols.map((c) => full[c])).run();
}

function insertEvent(row: Row, id = "e1") {
  const full: Row = { id, shipment_id: "s1", source: "webhook", event_key: "status:Livré@2026", occurred_at: NOW, recorded_at: NOW, ...row };
  const cols = Object.keys(full);
  return d1.raw.prepare(`INSERT INTO shipment_events (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`).bind(...cols.map((c) => full[c])).run();
}

async function refused(write: Promise<unknown>) {
  await expect(write).rejects.toThrow(/constraint/i);
}

describe("the tables match their Drizzle definitions", () => {
  it.each([schema.shipments, schema.shipmentEvents, schema.driverPaymentLines, schema.deliveryCompanies] as SQLiteTable[])("%#", async (table) => {
    const name = getTableName(table);
    const { results } = await d1.raw.prepare(`SELECT name FROM pragma_table_info('${name}')`).all<{ name: string }>();
    const actual = results.map((r) => r.name).sort();
    const declared = Object.values(getTableColumns(table)).map((c) => c.name).sort();
    expect(actual, name).toEqual(declared);
  });
});

describe("shipments the database refuses", () => {
  it("accepts a well-formed carrier shipment and a driver shipment", async () => {
    await insertShipment(CARRIER);
    await insertShipment(DRIVER, "s2", "o2");
  });

  it("a second shipment for the same order", async () => {
    await insertShipment(CARRIER);
    await refused(insertShipment({ ...CARRIER, carrier_parcel_id: "yal-2" }, "s2"));
  });

  it("a carrier shipment without a company, or with a driver", async () => {
    await refused(insertShipment({ ...CARRIER, company_id: null }));
    await refused(insertShipment({ ...CARRIER, driver_id: "dr1" }));
  });

  it("an accepted carrier shipment without the carrier's parcel id — but a reservation may lack one", async () => {
    await refused(insertShipment({ ...CARRIER, carrier_parcel_id: null }));
    await insertShipment({ ...CARRIER, handoff_state: "submitting", carrier_parcel_id: null, tracking_number: null });
  });

  it("a driver shipment without a driver, with a company, or not accepted", async () => {
    await refused(insertShipment({ ...DRIVER, driver_id: null }));
    await refused(insertShipment({ ...DRIVER, company_id: "co1" }));
    await refused(insertShipment({ ...DRIVER, handoff_state: "submitting" }));
  });

  it("two outcomes at once", async () => {
    await refused(insertShipment({ ...CARRIER, delivered_at: NOW, returned_at: NOW }));
    await refused(insertShipment({ ...CARRIER, delivered_at: NOW, cancelled_at: NOW }));
    await refused(insertShipment({ ...CARRIER, returned_at: NOW, cancelled_at: NOW }));
  });

  it("a cancellation after the final mile", async () => {
    await refused(insertShipment({ ...CARRIER, out_for_delivery_at: NOW, cancelled_at: NOW }));
  });

  it("values outside the vocabulary", async () => {
    await refused(insertShipment({ ...CARRIER, kind: "manual" }));
    await refused(insertShipment({ ...CARRIER, handoff_state: "pending" }));
    await refused(insertShipment({ ...CARRIER, delivery_type: "express" }));
    await refused(insertShipment({ ...CARRIER, provider_status_kind: "delivered" }));
  });

  it("the same parcel id twice at one carrier", async () => {
    await insertShipment(CARRIER);
    await refused(insertShipment(CARRIER, "s2", "o2"));
  });
});

describe("shipment events", () => {
  beforeEach(async () => {
    await insertShipment(CARRIER);
  });

  it("the same fact twice is refused", async () => {
    await insertEvent({ interpretation: "milestone", milestone: "delivered" });
    await refused(insertEvent({ interpretation: "milestone", milestone: "delivered" }, "e2"));
  });

  it("a milestone must agree with its interpretation", async () => {
    await refused(insertEvent({ interpretation: "milestone", milestone: null }));
    await refused(insertEvent({ interpretation: "progress", milestone: "delivered" }));
    await refused(insertEvent({ interpretation: "milestone", milestone: "dispatched" }));
    await refused(insertEvent({ source: "carrier", interpretation: "progress" }));
  });

  it("legacy rows may carry no interpretation", async () => {
    await insertEvent({ source: "legacy", interpretation: null, milestone: null });
  });

  it("removing a shipment removes every event; its order cannot be removed while it has one (0042)", async () => {
    await insertEvent({ interpretation: "progress" });
    await expect(d1.raw.prepare("DELETE FROM orders WHERE id = 'o1'").run()).rejects.toThrow(/ORDER_HAS_SHIPMENT/);
    await d1.raw.prepare("DELETE FROM shipments WHERE order_id = 'o1'").run();
    expect((await d1.raw.prepare("SELECT count(*) n FROM shipment_events").first<{ n: number }>())?.n).toBe(0);
  });
});

describe("driver payment lines", () => {
  beforeEach(async () => {
    await insertShipment(DRIVER);
    await d1.raw
      .prepare("INSERT INTO driver_payments (id, driver_id, type, amount, order_count, created_by, created_by_name, created_at) VALUES ('p1', 'dr1', 'cod_remittance', 1400, 1, 'u1', 'Admin', ?)")
      .bind(NOW)
      .run();
  });

  const line = (id: string, component: string, payment = "p1") =>
    d1.raw.prepare("INSERT INTO driver_payment_lines (id, payment_id, shipment_id, component, amount) VALUES (?, ?, 's1', ?, 1400)").bind(id, payment, component).run();

  it("settle each part of a shipment once", async () => {
    await line("l1", "cod");
    await line("l2", "fee");
    await refused(line("l3", "cod"));
    await refused(line("l4", "tip"));
  });
});
