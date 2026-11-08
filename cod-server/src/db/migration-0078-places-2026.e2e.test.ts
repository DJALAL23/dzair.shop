/**
 * Migration 0078 on real D1: Algeria's places move to law 26-06 (69 wilayas,
 * 1541 communes), and every address, price and driver's fee a store has
 * follows its place — nothing a merchant set is lost.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import { COMMUNES, WILAYAS } from "../../../cod-shared/places";

let d1: TestD1;
const T = "2026-11-08T10:00:00.000Z";

const run = (sql: string, ...binds: unknown[]) => d1.raw.prepare(sql).bind(...binds).run();
const all = async <R = Record<string, unknown>>(sql: string, ...binds: unknown[]) => (await d1.raw.prepare(sql).bind(...binds).all<R>()).results;

const BESBES = "c-07-007"; // Biskra in 1984, Ouled Djellal (51) since 2019
const AFLOU = "c-03-019"; // Laghouat until 2026, Aflou (59)
const TIMIMOUN = "c-01-009";
const TIMIMOUN_COPY = "c-49-001"; // migration 0000's placeholder of Timimoun
const ALGER_CENTRE = "c-16-001";

beforeAll(async () => {
  d1 = await createTestD1({ before: "0078_places_2026.sql" });
  await run("INSERT INTO shipping_profiles (id, name, created_at, updated_at) VALUES ('p1', 'Standard', ?1, ?1)", T);
  for (const [id, wilaya, home] of [["r7", 7, 600], ["r3", 3, 500], ["r49", 49, 1000], ["r16", 16, 400]] as const) {
    await run("INSERT INTO shipping_rules (id, profile_id, wilaya_id, home_price, stop_desk_price, home_enabled, stop_desk_enabled, created_at) VALUES (?1, 'p1', ?2, ?3, 300, 1, 1, ?4)", id, wilaya, home, T);
  }
  // Overrides: on a commune that moved in 2019, one that moves in 2026, a placeholder copy, and a copy and its commune in one rule.
  await run("INSERT INTO shipping_rule_communes (id, rule_id, commune_id, home_price) VALUES ('o-besbes', 'r7', ?1, 700)", BESBES);
  await run("INSERT INTO shipping_rule_communes (id, rule_id, commune_id, home_price) VALUES ('o-aflou', 'r3', ?1, 550)", AFLOU);
  await run("INSERT INTO shipping_rule_communes (id, rule_id, commune_id, home_price) VALUES ('o-copy', 'r49', ?1, 1100)", TIMIMOUN_COPY);
  await run("INSERT INTO shipping_rule_communes (id, rule_id, commune_id, home_price) VALUES ('o-alger', 'r16', ?1, 450)", ALGER_CENTRE);
  await run("INSERT INTO drivers (id, first_name, last_name, phone, created_at, updated_at) VALUES ('d1', 'Amine', 'B', '0550000000', ?1, ?1)", T);
  await run("INSERT INTO driver_compensations (id, driver_id, wilaya_id, fee_per_delivery, created_at, updated_at) VALUES ('dc3', 'd1', 3, 300, ?1, ?1)", T);
  await run("INSERT INTO customers (id, name, phone, wilaya, wilaya_id, commune, commune_id, created_at) VALUES ('cu-copy', 'Salim', '0551111111', 'Timimoun', 49, 'Timimoun', ?1, ?2)", TIMIMOUN_COPY, T);
  await run("INSERT INTO customers (id, name, phone, wilaya, wilaya_id, commune, commune_id, created_at) VALUES ('cu-besbes', 'Nadia', '0552222222', 'Biskra', 7, 'Besbes', ?1, ?2)", BESBES, T);
  await run("INSERT INTO customers (id, name, phone, wilaya, created_at) VALUES ('cu-none', 'Yacine', '0553333333', 'Alger', ?1)", T);
  for (const [id, wilaya, commune] of [["o1", 7, BESBES], ["o2", 3, AFLOU], ["o3", 49, TIMIMOUN_COPY], ["o4", 16, null]] as const) {
    await run("INSERT INTO orders (id, order_number, customer_id, customer_name, phone, price, wilaya_id, commune_id, created_at, updated_at) VALUES (?1, ?1, 'cu-none', 'X', '0550000001', 2500, ?2, ?3, ?4, ?4)", id, wilaya, commune, T);
  }
  await run("INSERT INTO abandoned_orders (id, session_id, customer_name, phone, wilaya_id, commune_id, wilaya_name, commune_name, created_at, updated_at) VALUES ('a1', 's1', 'X', '0550000002', 49, ?1, 'Timimoun', 'Timimoun', ?2, ?2)", TIMIMOUN_COPY, T);
  await run("INSERT INTO carrier_communes (carrier_code, commune_id, carrier_name) VALUES ('yalidine', ?1, 'Besbes')", BESBES);
  await d1.applyRemaining();
}, 180_000);

afterAll(async () => d1?.dispose());

describe("migration 0078: the places", () => {
  it("are the list in cod-shared/places, row for row", async () => {
    expect(await all("SELECT id, name, name_ar AS nameAr FROM wilayas ORDER BY id")).toEqual(WILAYAS.map((w) => ({ ...w })));
    const rows = await all<{ id: string; wilayaId: number; name: string; nameAr: string }>("SELECT id, wilaya_id AS wilayaId, name, name_ar AS nameAr FROM communes");
    const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id);
    expect(rows.sort(byId)).toEqual(COMMUNES.map((c) => ({ ...c })).sort(byId));
  });

  it("no longer hold the placeholder copies", async () => {
    expect(await all("SELECT id FROM communes WHERE id LIKE 'c-49-%' OR id LIKE 'c-5_-001'")).toEqual([]);
  });
});

describe("migration 0078: a store's addresses", () => {
  it("point at the commune, never its copy, in the commune's wilaya", async () => {
    expect(await all("SELECT id, wilaya_id, commune_id FROM orders ORDER BY id")).toEqual([
      { id: "o1", wilaya_id: 51, commune_id: BESBES },
      { id: "o2", wilaya_id: 59, commune_id: AFLOU },
      { id: "o3", wilaya_id: 49, commune_id: TIMIMOUN },
      { id: "o4", wilaya_id: 16, commune_id: null },
    ]);
  });

  it("keep a customer's names in step with the place", async () => {
    expect(await all("SELECT id, wilaya_id, wilaya, commune_id, commune FROM customers ORDER BY id")).toEqual([
      { id: "cu-besbes", wilaya_id: 51, wilaya: "Ouled Djellal", commune_id: BESBES, commune: "Besbes" },
      { id: "cu-copy", wilaya_id: 49, wilaya: "Timimoun", commune_id: TIMIMOUN, commune: "Timimoun" },
      { id: "cu-none", wilaya_id: null, wilaya: "Alger", commune_id: null, commune: null },
    ]);
    expect(await all("SELECT commune_id, wilaya_id, wilaya_name, commune_name FROM abandoned_orders")).toEqual([
      { commune_id: TIMIMOUN, wilaya_id: 49, wilaya_name: "Timimoun", commune_name: "Timimoun" },
    ]);
  });
});

describe("migration 0078: prices and fees", () => {
  const rule = (wilaya: number) => all<{ id: string; home_price: number; stop_desk_price: number }>("SELECT id, home_price, stop_desk_price FROM shipping_rules WHERE profile_id = 'p1' AND wilaya_id = ?1", wilaya);

  it("give a new wilaya the prices of the wilaya it was taken from", async () => {
    const aflou = await rule(59);
    expect(aflou).toHaveLength(1);
    expect(aflou[0]).toMatchObject({ home_price: 500, stop_desk_price: 300 });
    expect(await rule(3)).toEqual([{ id: "r3", home_price: 500, stop_desk_price: 300 }]);
  });

  it("move a commune's override to its wilaya's rule, creating that rule from the old one", async () => {
    const [aflou] = await rule(59);
    const [ouledDjellal] = await rule(51);
    expect(ouledDjellal).toMatchObject({ home_price: 600, stop_desk_price: 300 });
    expect(await all("SELECT id, rule_id, commune_id, home_price FROM shipping_rule_communes ORDER BY id")).toEqual([
      { id: "o-aflou", rule_id: aflou!.id, commune_id: AFLOU, home_price: 550 },
      { id: "o-alger", rule_id: "r16", commune_id: ALGER_CENTRE, home_price: 450 },
      { id: "o-besbes", rule_id: ouledDjellal!.id, commune_id: BESBES, home_price: 700 },
      { id: "o-copy", rule_id: "r49", commune_id: TIMIMOUN, home_price: 1100 },
    ]);
  });

  it("give a driver's fee for a new wilaya the fee of the wilaya it was taken from", async () => {
    expect(await all("SELECT wilaya_id, fee_per_delivery FROM driver_compensations WHERE driver_id = 'd1' ORDER BY wilaya_id")).toEqual([
      { wilaya_id: 3, fee_per_delivery: 300 },
      { wilaya_id: 59, fee_per_delivery: 300 },
    ]);
  });
});

describe("migration 0078: carrier maps", () => {
  it("replace the name caches with one map per company", async () => {
    const tables = (await all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")).map((t) => t.name);
    expect(tables).toContain("carrier_places");
    expect(tables).not.toContain("carrier_communes");
    expect(tables).not.toContain("carrier_wilayas");
    const columns = (table: string) => all<{ name: string }>(`SELECT name FROM pragma_table_info('${table}')`).then((r) => r.map((c) => c.name));
    expect(await columns("delivery_companies")).toEqual(expect.arrayContaining(["places_synced_at", "places_unmatched"]));
    expect(await columns("company_stop_desks")).toContain("commune_id");
  });
});
