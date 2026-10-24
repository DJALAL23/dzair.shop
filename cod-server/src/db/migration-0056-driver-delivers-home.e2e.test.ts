/**
 * Migration 0056 on real D1: the store's own driver delivers to the
 * customer's door, so the database refuses a driver shipment that is not
 * home delivery or that names a stop desk — whatever code path writes it.
 *
 * Proved here, at the SQL level: rows written before the migration keep
 * every value, and a driver shipment recorded as stop desk before it still
 * records its delivery; afterwards no driver shipment can be inserted, or
 * changed, into a stop-desk one, while carrier shipments keep their desks.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestD1, type TestD1 } from "@/test-utils/d1";

let d1: TestD1;
const T = "2026-10-24T10:00:00.000Z";

const run = (sql: string, ...binds: unknown[]) => d1.raw.prepare(sql).bind(...binds).run();
const all = async <R = Record<string, unknown>>(sql: string, ...binds: unknown[]) => (await d1.raw.prepare(sql).bind(...binds).all<R>()).results;

const order = (id: string) =>
  `INSERT INTO orders (id, order_number, customer_id, customer_name, phone, address, price, status, created_at, updated_at) VALUES ('${id}', 'ORD-${id}', 'c1', 'Karim', '0551234567', '12 rue Didouche', 1500, 'ready', ?1, ?1)`;
const shipment = (id: string, orderId: string, who: string, deliveryType: string, station: string | null) =>
  `INSERT INTO shipments (id, order_id, kind, ${who.startsWith("d") ? "driver_id" : "company_id"}, handoff_state, carrier_parcel_id, tracking_number, delivery_type, station_code, cod_amount, revision, created_at, updated_at) VALUES ('${id}', '${orderId}', '${who.startsWith("d") ? "driver" : "carrier"}', '${who}', 'accepted', ${who.startsWith("d") ? "NULL" : `'P-${id}'`}, ${who.startsWith("d") ? "NULL" : `'T-${id}'`}, '${deliveryType}', ${station === null ? "NULL" : `'${station}'`}, 1900, 'r1', ?1, ?1)`;

beforeAll(async () => {
  d1 = await createTestD1({ before: "0056_driver_delivers_home.sql" });
  const seed = [
    "INSERT INTO customers (id, name, phone, wilaya, created_at) VALUES ('c1', 'Karim', '0551234567', 'Alger', ?1)",
    "INSERT INTO drivers (id, first_name, last_name, phone, created_at, updated_at) VALUES ('d1', 'Samir', 'B', '0661000000', ?1, ?1)",
    "INSERT INTO delivery_companies (id, name, name_ar, code, provider, created_at, updated_at) VALUES ('co1', 'Yalidine', 'Yalidine', 'yalidine', 'yalidine', ?1, ?1)",
    ...["o1", "o2", "o3", "o4", "o5", "o6", "o7"].map(order),
    // Recorded before the migration: a driver shipment written as stop desk, and a carrier one at a desk.
    shipment("sOld", "o1", "d1", "stop_desk", "16001"),
    shipment("sCarrier", "o2", "co1", "stop_desk", "16001"),
  ];
  await d1.raw.batch(seed.map((sql) => d1.raw.prepare(sql).bind(T)));
  await d1.applyRemaining();
}, 120_000);

afterAll(async () => {
  await d1?.dispose();
});

describe("migration 0056 keeps what was there", () => {
  it("keeps every shipment row as it was", async () => {
    expect(await all("select id, kind, delivery_type, station_code, cod_amount from shipments order by id")).toEqual([
      { id: "sCarrier", kind: "carrier", delivery_type: "stop_desk", station_code: "16001", cod_amount: 1900 },
      { id: "sOld", kind: "driver", delivery_type: "stop_desk", station_code: "16001", cod_amount: 1900 },
    ]);
  });

  it("lets a driver shipment recorded before it record its delivery", async () => {
    await run("UPDATE shipments SET delivered_at = ?1, provider_status = 'delivered', updated_at = ?1 WHERE id = 'sOld'", T);
    expect(await all("select delivered_at from shipments where id = 'sOld'")).toEqual([{ delivered_at: T }]);
  });
});

describe("after migration 0056 a driver delivers to the door", () => {
  it("refuses a new driver shipment at a stop desk, or one naming a desk", async () => {
    await expect(run(shipment("sDesk", "o3", "d1", "stop_desk", "16001"), T)).rejects.toThrow(/DRIVER_DELIVERS_HOME/);
    await expect(run(shipment("sCode", "o3", "d1", "home", "16001"), T)).rejects.toThrow(/DRIVER_DELIVERS_HOME/);
    expect(await all("select id from shipments where order_id = 'o3'")).toEqual([]);
  });

  it("takes a driver shipment for home delivery", async () => {
    await run(shipment("sHome", "o4", "d1", "home", null), T);
    expect(await all("select kind, delivery_type, station_code from shipments where id = 'sHome'")).toEqual([{ kind: "driver", delivery_type: "home", station_code: null }]);
  });

  it("refuses changing a driver shipment to a stop desk, or a stop-desk shipment to a driver's", async () => {
    await expect(run("UPDATE shipments SET delivery_type = 'stop_desk' WHERE id = 'sHome'")).rejects.toThrow(/DRIVER_DELIVERS_HOME/);
    await expect(run("UPDATE shipments SET station_code = '16001' WHERE id = 'sHome'")).rejects.toThrow(/DRIVER_DELIVERS_HOME/);
    await run(shipment("sCarrier2", "o5", "co1", "stop_desk", "31001"), T);
    await expect(run("UPDATE shipments SET kind = 'driver', driver_id = 'd1', company_id = NULL WHERE id = 'sCarrier2'")).rejects.toThrow(/DRIVER_DELIVERS_HOME/);
    expect(await all("select id, kind, delivery_type, station_code from shipments where id in ('sHome', 'sCarrier2') order by id")).toEqual([
      { id: "sCarrier2", kind: "carrier", delivery_type: "stop_desk", station_code: "31001" },
      { id: "sHome", kind: "driver", delivery_type: "home", station_code: null },
    ]);
  });

  it("leaves carrier shipments free to use stop desks", async () => {
    await run(shipment("sCarrier3", "o6", "co1", "stop_desk", "16002"), T);
    await run("UPDATE shipments SET station_code = '16003' WHERE id = 'sCarrier3'");
    expect(await all("select delivery_type, station_code from shipments where id = 'sCarrier3'")).toEqual([{ delivery_type: "stop_desk", station_code: "16003" }]);
  });
});
