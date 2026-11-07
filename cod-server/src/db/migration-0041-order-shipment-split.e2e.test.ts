/**
 * Migration 0041 on real D1, from a database in the old shape: every order
 * that went to delivery the old way gets the shipment it would have had —
 * carrier parcel or driver, milestones, history, webhook reports, settlement
 * links — nothing is run again (stock, spend and the drivers' counters stay,
 * so their cash drift is the same), and the old columns and tables go. A
 * delivery that cannot be told for sure stops it with nothing changed.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { eq, getTableColumns } from "drizzle-orm";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import * as schema from "@/db/schema";
import { buildCarrier } from "@/carriers/registry";
import { getDriverCashReconciliation } from "../../../cod-shared/queries/drivers";

const BEFORE = "0041_order_shipment_split.sql";
const T = (minute: number) => new Date(Date.parse("2026-09-01T08:00:00.000Z") + minute * 60_000).toISOString();

type Row = Record<string, string | number | null>;
const insert = (d1: TestD1, table: string, row: Row) => {
  const cols = Object.keys(row);
  return d1.raw.prepare(`INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`).bind(...cols.map((c) => row[c]));
};

/** An order in the old shape: delivery fields on the order itself. */
const order = (id: string, status: string, extra: Row = {}): Row => ({
  id, order_number: `ORD-${id}`, customer_id: "c1", customer_name: "Karim", phone: "0551234567", wilaya_id: 16,
  price: 3000, delivery_fee: 500, cod_amount: 3500, driver_fee: 0, delivery_type: "home", status, created_at: T(0), updated_at: T(100), ...extra,
});
const history = (orderId: string, rows: Array<[string, number]>) =>
  rows.map(([status, minute], i) => ({ id: `h-${orderId}-${i}`, order_id: orderId, status, timestamp: T(minute), by: i === 0 ? null : "u1" }));
const parcel = (id: string, orderId: string, companyId: string, tracking: string, extra: Row = {}): Row => ({
  id, order_id: orderId, company_id: companyId, tracking_number: tracking, validated: 0, created_at: T(10), updated_at: T(12), ...extra,
});
const yalidineReport = (eventId: string, orderId: string, tracking: string, status: string, local: string): Row => ({
  id: `w-${eventId}`, provider: "yalidine", event_id: eventId, company_id: "yal", order_id: orderId, tracking, event_type: "parcel_status_updated",
  raw_payload: JSON.stringify({ type: "parcel_status_updated", event: { event_id: eventId, occurred_at: local, data: { tracking, status } } }),
  result: "ok", new_status: "delivered", created_at: T(200),
});

const ZR_RAW = JSON.stringify({ createRes: { id: "zr-uuid-1" }, parcel: { id: "zr-uuid-1", trackingNumber: "ZR-T1" }, parcelId: "zr-uuid-1" });
const ZR_MAPPING = JSON.stringify({ delivered: ["Livrée chez client"], assigned: ["Au hub", " "], out_for_delivery: ["En route"], new: "not a list" });

async function seedCommon(d1: TestD1) {
  await d1.raw.batch([
    insert(d1, "customers", { id: "c1", name: "Karim", phone: "0551234567", wilaya: "Alger", total_orders: 12, total_spent: 30000, created_at: T(0) }),
    insert(d1, "drivers", { id: "dr1", first_name: "Amine", last_name: "B", phone: "0661111111", total_delivered: 2, total_earnings: 600, pending_cash: 3800, total_paid: 3500, created_at: T(0), updated_at: T(0) }),
    insert(d1, "delivery_companies", { id: "yal", name: "Yalidine", name_ar: "-", code: "yalidine", provider: "yalidine", created_at: T(0), updated_at: T(0) }),
    insert(d1, "delivery_companies", { id: "zr", name: "ZR", name_ar: "-", code: "zr_express", provider: "zr_express", webhook_status_mapping: ZR_MAPPING, provider_config: null, api_token: "k", api_user_guid: "t", created_at: T(0), updated_at: T(0) }),
    insert(d1, "products", { id: "p1", name: "Robe", handle: "robe", price: 3000, has_variants: 0, inventory: 7, track_inventory: 1, low_stock_threshold: 1, status: "ACTIVE", visibility: 1, show_in_store: 1, store_featured: 0, created_at: T(0), updated_at: T(0) }),
  ]);
}

/** The operator's check scripts (scripts/preflight-0041.sql, verify-0041.sql), run as wrangler would. */
async function runScript(db: TestD1, file: string): Promise<Map<string, number>> {
  const text = readFileSync(resolve(__dirname, "../../scripts", file), "utf8");
  const statements = text.split(/;\s*\n/).map((x) => x.replace(/--[^\n]*/g, "").trim()).filter(Boolean);
  const out = new Map<string, number>();
  for (const statement of statements) {
    const { results } = await db.raw.prepare(statement).all<{ check_name: string; k: string | null; n: number }>();
    for (const r of results) out.set(r.k === null ? r.check_name : `${r.check_name}:${r.k}`, Number(r.n));
  }
  return out;
}

let d1: TestD1;
let driftBefore: number;
let preflight: Map<string, number>;

beforeAll(async () => {
  d1 = await createTestD1({ before: BEFORE });
  await seedCommon(d1);
  const statements = [
    // A Yalidine parcel delivered, validated, with its whole history and webhook reports.
    insert(d1, "orders", order("delivered", "delivered", { delivery_attempts: 1, tracking_number: "yal-D1", company_id: "yal", delivery_method: "company" })),
    insert(d1, "company_shipments", parcel("cs-delivered", "delivered", "yal", "yal-D1", { validated: 1, label_url: "https://yal/label/D1" })),
    ...history("delivered", [["new", 0], ["confirmed", 5], ["ready", 8], ["dispatched", 10], ["out_for_delivery", 60], ["delivered", 90]]).map((h) => insert(d1, "order_status_history", h)),
    insert(d1, "webhook_events", yalidineReport("e1", "delivered", "yal-D1", "Sorti en livraison", "2026-09-01 10:00:00")),
    insert(d1, "webhook_events", yalidineReport("e2", "delivered", "yal-D1", "Livré", "2026-09-01 10:30:00")),
    insert(d1, "webhook_events", yalidineReport("e3", "delivered", "yal-D1", "Livré", "2026-09-01 10:30:00")),
    // A ZR parcel on its way: the parcel id from the create response; the label was a marker.
    insert(d1, "orders", order("zr", "dispatched", { tracking_number: "ZR-T1", company_id: "zr", delivery_type: "stop_desk", station_code: "16A" })),
    insert(d1, "company_shipments", parcel("cs-zr", "zr", "zr", "ZR-T1", { raw_response: ZR_RAW, label_url: "deferred" })),
    // Cancelled at the carrier once, sent again: the second parcel is the order's.
    insert(d1, "orders", order("again", "out_for_delivery", { tracking_number: "yal-A2", company_id: "yal" })),
    insert(d1, "company_shipments", parcel("cs-again-1", "again", "yal", "yal-A1", { created_at: T(10) })),
    insert(d1, "company_shipments", parcel("cs-again-2", "again", "yal", "yal-A2", { created_at: T(20) })),
    ...history("again", [["new", 0], ["dispatched", 10], ["dispatched", 20], ["out_for_delivery", 70]]).map((h) => insert(d1, "order_status_history", h)),
    // Returned by the carrier; delivered with no delivered history.
    insert(d1, "orders", order("returned", "returned", { tracking_number: "yal-R1", company_id: "yal" })),
    insert(d1, "company_shipments", parcel("cs-returned", "returned", "yal", "yal-R1")),
    ...history("returned", [["new", 0], ["dispatched", 10], ["out_for_delivery", 50], ["returned", 80]]).map((h) => insert(d1, "order_status_history", h)),
    insert(d1, "orders", order("late", "delivered", { tracking_number: "yal-L1", company_id: "yal", delivery_time: T(95) })),
    insert(d1, "company_shipments", parcel("cs-late", "late", "yal", "yal-L1")),
    // Cancelled orders keep no shipment: a parcel and a driver, voided.
    insert(d1, "orders", order("dropped", "cancelled", { tracking_number: "yal-X1", company_id: "yal" })),
    insert(d1, "company_shipments", parcel("cs-dropped", "dropped", "yal", "yal-X1")),
    ...history("dropped", [["new", 0], ["dispatched", 10], ["cancelled", 30]]).map((h) => insert(d1, "order_status_history", h)),
    // The store's driver: delivered and settled; delivered, not settled; assigned; planned before ready.
    insert(d1, "driver_payments", { id: "pay-cod", driver_id: "dr1", type: "cod_remittance", amount: 3500, order_count: 1, created_by: "u1", created_by_name: "Staff", created_at: T(300) }),
    insert(d1, "driver_payments", { id: "pay-fee", driver_id: "dr1", type: "fee_payment", amount: 300, order_count: 1, created_by: "u1", created_by_name: "Staff", created_at: T(300) }),
    insert(d1, "orders", order("settled", "delivered", { driver_id: "dr1", driver_fee: 300, delivery_method: "driver", assigned_at: T(9), assigned_by: "u1", cod_payment_id: "pay-cod", fee_payment_id: "pay-fee" })),
    ...history("settled", [["new", 0], ["assigned", 9], ["out_for_delivery", 40], ["delivered", 70]]).map((h) => insert(d1, "order_status_history", h)),
    insert(d1, "orders", order("owed", "delivered", { driver_id: "dr1", driver_fee: 300, cod_amount: 3800, assigned_at: T(9) })),
    insert(d1, "orders", order("assigned", "assigned", { driver_id: "dr1", driver_fee: 300, assigned_at: T(9) })),
    insert(d1, "orders", order("planned", "confirmed", { driver_id: "dr1", driver_fee: 300 })),
    // Sent, then its status edited back by hand: the parcel is still the order's.
    insert(d1, "orders", order("edited", "confirmed", { tracking_number: "yal-E1", company_id: "yal" })),
    insert(d1, "company_shipments", parcel("cs-edited", "edited", "yal", "yal-E1")),
    // Not sent anywhere: untouched.
    insert(d1, "orders", order("fresh", "new")),
    insert(d1, "order_products", { id: "l-fresh", order_id: "fresh", product_id: "p1", product_name: "Robe", quantity: 1, price_per_unit: 3000, line_total: 3000, created_at: T(0) }),
  ];
  for (let i = 0; i < statements.length; i += 40) await d1.raw.batch(statements.slice(i, i + 40));
  driftBefore = Number(
    (await d1.raw.prepare("SELECT d.pending_cash - coalesce((SELECT sum(o.cod_amount) FROM orders o WHERE o.driver_id = d.id AND o.status = 'delivered' AND o.cod_payment_id IS NULL), 0) AS drift FROM drivers d WHERE d.id = 'dr1'").first<{ drift: number }>())!.drift,
  );
  preflight = await runScript(d1, "preflight-0041.sql");
  await d1.applyRemaining();
}, 120_000);

afterAll(async () => {
  await d1?.dispose();
});

const shipmentOf = (orderId: string) => d1.db.select().from(schema.shipments).where(eq(schema.shipments.orderId, orderId)).get();
const eventsOf = async (orderId: string) => {
  const s = await shipmentOf(orderId);
  return s ? d1.db.select().from(schema.shipmentEvents).where(eq(schema.shipmentEvents.shipmentId, s.id)).orderBy(schema.shipmentEvents.occurredAt).all() : [];
};
const orderOf = (id: string) => d1.db.select().from(schema.orders).where(eq(schema.orders.id, id)).get();
const voided = async (orderId: string) =>
  (await d1.db.select().from(schema.activityLogs).where(eq(schema.activityLogs.entityId, orderId)).all()).filter((a) => a.action === "shipment.voided").map((a) => JSON.parse(a.metadata!));

describe("carrier parcels become carrier shipments", () => {
  it("a delivered Yalidine parcel: its identity, label, validation, milestones and attempts", async () => {
    expect(await shipmentOf("delivered")).toMatchObject({
      id: "cs-delivered", kind: "carrier", companyId: "yal", driverId: null, handoffState: "accepted", carrierParcelId: "yal-D1", trackingNumber: "yal-D1",
      labelUrl: "https://yal/label/D1", carrierData: null, codAmount: 3500, driverFee: 0, validatedAt: T(12),
      outForDeliveryAt: T(60), deliveredAt: T(90), returnedAt: null, cancelledAt: null, deliveryAttempts: 1, createdAt: T(10),
    });
  });

  it("its history and its carrier's reports, the same report once, the newest one its status", async () => {
    const events = (await eventsOf("delivered")).sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.source.localeCompare(b.source));
    expect(events.map((e) => [e.occurredAt, e.source, e.vocabulary, e.providerStatus, e.interpretation, e.milestone])).toEqual([
      [T(10), "legacy", "legacy", "dispatched", "progress", null],
      [T(60), "legacy", "legacy", "out_for_delivery", "milestone", "out_for_delivery"],
      [T(60), "webhook", "status", "Sorti en livraison", null, null],
      [T(90), "legacy", "legacy", "delivered", "milestone", "delivered"],
      [T(90), "webhook", "status", "Livré", null, null],
    ]);
    const webhook = events.filter((e) => e.source === "webhook");
    expect(webhook.map((e) => e.occurredAt)).toEqual(["2026-09-01T09:00:00.000Z", "2026-09-01T09:30:00.000Z"]);
    expect(webhook[1].eventKey).toBe("status:Livré@2026-09-01T09:30:00.000Z");
    expect(webhook.map((e) => e.webhookEventId)).toEqual(["w-e1", "w-e2"]);
    expect(events.find((e) => e.providerStatus === "delivered")!.actorId).toBe("u1");
    expect(await shipmentOf("delivered")).toMatchObject({ providerStatus: "Livré", providerStatusKind: "unknown", providerStatusAt: "2026-09-01T09:30:00.000Z" });

    const inbox = await d1.db.select().from(schema.webhookEvents).all();
    expect(inbox.filter((w) => w.shipmentId === "cs-delivered").map((w) => w.id).sort()).toEqual(["w-e1", "w-e2", "w-e3"]);
  });

  it("a ZR parcel is addressed by its own id; its label was a marker; stop desk kept", async () => {
    expect(await shipmentOf("zr")).toMatchObject({
      carrierParcelId: "zr-uuid-1", trackingNumber: "ZR-T1", carrierData: JSON.stringify({ parcelId: "zr-uuid-1" }), labelUrl: null,
      validatedAt: null, outForDeliveryAt: null, deliveredAt: null, deliveryType: "stop_desk", stationCode: "16A",
    });
  });

  it("an order sent again keeps its current parcel; the earlier one is voided in the activity log", async () => {
    expect(await shipmentOf("again")).toMatchObject({ id: "cs-again-2", trackingNumber: "yal-A2", outForDeliveryAt: T(70), deliveredAt: null });
    expect(await voided("again")).toEqual([{ source: "migration", kind: "carrier", companyId: "yal", trackingNumber: "yal-A1" }]);
  });

  it("returned, and delivered without a delivered step", async () => {
    expect(await shipmentOf("returned")).toMatchObject({ outForDeliveryAt: T(50), returnedAt: T(80), deliveredAt: null });
    expect(await shipmentOf("late")).toMatchObject({ deliveredAt: T(95), outForDeliveryAt: null });
  });
});

describe("the store's driver", () => {
  it("delivered and settled: the shipment, its frozen cash and fee, its settlement lines", async () => {
    const s = await shipmentOf("settled");
    expect(s).toMatchObject({ kind: "driver", driverId: "dr1", companyId: null, handoffState: "accepted", codAmount: 3500, driverFee: 300, createdBy: "u1", createdAt: T(9), outForDeliveryAt: T(40), deliveredAt: T(70), providerStatus: "delivered", providerStatusKind: "milestone" });
    const lines = await d1.db.select().from(schema.driverPaymentLines).where(eq(schema.driverPaymentLines.shipmentId, s!.id)).all();
    expect(lines.map((l) => [l.paymentId, l.component, l.amount]).sort()).toEqual([["pay-cod", "cod", 3500], ["pay-fee", "fee", 300]]);
  });

  it("delivered, not settled; and assigned", async () => {
    expect(await shipmentOf("owed")).toMatchObject({ kind: "driver", codAmount: 3800, deliveredAt: T(100) });
    expect(await d1.db.select().from(schema.driverPaymentLines).where(eq(schema.driverPaymentLines.shipmentId, (await shipmentOf("owed"))!.id)).all()).toEqual([]);
    expect(await shipmentOf("assigned")).toMatchObject({ kind: "driver", createdAt: T(9), outForDeliveryAt: null, deliveredAt: null, providerStatus: null });
  });

  it("the cash drift is what it was; no counter moved", async () => {
    expect((await getDriverCashReconciliation(d1.db, "dr1")).drift).toBe(driftBefore);
    expect(await d1.db.select().from(schema.drivers).where(eq(schema.drivers.id, "dr1")).get()).toMatchObject({ totalDelivered: 2, totalEarnings: 600, pendingCash: 3800, totalPaid: 3500 });
  });

  it("a driver planned for an order not yet ready is voided; so is a cancelled order's parcel", async () => {
    expect(await shipmentOf("planned")).toBeUndefined();
    expect(await voided("planned")).toEqual([{ source: "migration", kind: "driver", driverId: "dr1" }]);
    expect(await shipmentOf("dropped")).toBeUndefined();
    expect(await voided("dropped")).toEqual([{ source: "migration", kind: "carrier", companyId: "yal", trackingNumber: "yal-X1" }]);
  });
});

describe("orders", () => {
  it("every order that went to delivery is ready; the others keep their status", async () => {
    for (const id of ["delivered", "zr", "again", "returned", "late", "edited", "settled", "owed", "assigned"]) expect((await orderOf(id))!.status, id).toBe("ready");
    expect(await shipmentOf("edited")).toMatchObject({ id: "cs-edited", kind: "carrier" });
    expect((await orderOf("planned"))!.status).toBe("confirmed");
    expect((await orderOf("dropped"))!.status).toBe("cancelled");
    expect((await orderOf("fresh"))!.status).toBe("new");
  });

  it("no effect ran again: stock and the customer's spend are as they were", async () => {
    expect((await d1.db.select().from(schema.products).where(eq(schema.products.id, "p1")).get())!.inventory).toBe(7);
    expect(await d1.db.select().from(schema.customers).get()).toMatchObject({ totalOrders: 12, totalSpent: 30000 });
    expect(await d1.db.select().from(schema.stockMovements).all()).toEqual([]);
  });
});

describe("companies", () => {
  it("ZR's state names move into its settings, by meaning; blank and malformed entries are dropped", async () => {
    const zr = (await d1.db.select().from(schema.deliveryCompanies).where(eq(schema.deliveryCompanies.id, "zr")).get())!;
    expect(JSON.parse(zr.providerConfig!)).toEqual({ statusMap: { delivered: ["Livrée chez client"], progress: ["Au hub"], out_for_delivery: ["En route"] } });
    const adapter = buildCarrier(zr);
    expect(adapter.interpret({ vocabulary: "state", value: "Livrée chez client" })).toEqual({ kind: "milestone", milestone: "delivered" });
    expect(adapter.interpret({ vocabulary: "state", value: "Au hub" })).toEqual({ kind: "progress" });
    expect((await d1.db.select().from(schema.deliveryCompanies).where(eq(schema.deliveryCompanies.id, "yal")).get())!.providerConfig).toBeNull();
  });
});

describe("the old columns and tables", () => {
  const columnsOf = async (table: string) => (await d1.raw.prepare(`SELECT name FROM pragma_table_info('${table}')`).all<{ name: string }>()).results.map((r) => r.name).sort();
  const drizzle = (table: Parameters<typeof getTableColumns>[0]) => Object.values(getTableColumns(table)).map((c) => c.name);

  it("are gone — but for three a FOREIGN KEY clause holds, left empty", async () => {
    expect(await columnsOf("orders")).toEqual([...drizzle(schema.orders), "driver_id", "company_id"].sort());
    expect(await columnsOf("webhook_events")).toEqual([...drizzle(schema.webhookEvents), "order_id"].sort());
    expect(await columnsOf("delivery_companies")).toEqual(drizzle(schema.deliveryCompanies).sort());
    const filled = await d1.raw.prepare("SELECT (SELECT count(*) FROM orders WHERE driver_id IS NOT NULL OR company_id IS NOT NULL) + (SELECT count(*) FROM webhook_events WHERE order_id IS NOT NULL) AS n").first<{ n: number }>();
    expect(filled!.n).toBe(0);
  });

  it("the old tables, the migration's own and the dead indexes are gone", async () => {
    const { results } = await d1.raw.prepare("SELECT type, name FROM sqlite_master WHERE name LIKE '%0041%' OR name IN ('company_shipments', 'order_assignments', 'idx_orders_tracking', 'idx_orders_driver', 'idx_orders_company', 'idx_orders_active')").all();
    expect(results).toEqual([]);
  });

  it("a driver and a company the old orders named can now be deleted", async () => {
    await d1.raw.prepare("INSERT INTO drivers (id, first_name, last_name, phone, created_at, updated_at) VALUES ('dr-old', 'Old', 'D', '0662222222', ?, ?)").bind(T(0), T(0)).run();
    await d1.raw.batch([d1.raw.prepare("DELETE FROM drivers WHERE id = 'dr-old'")]);
    expect(await d1.raw.prepare("SELECT id FROM drivers WHERE id = 'dr-old'").first()).toBeNull();
  });
});

describe("the operator's scripts", () => {
  it("preflight: the guard passes, and says what will move", () => {
    for (const guard of ["guard_stranded_deliveries", "guard_driver_and_carrier", "guard_unmatched_settlements"]) expect(preflight.get(guard), guard).toBe(0);
    expect([...preflight.keys()].filter((k) => k.startsWith("guard_duplicate_parcels"))).toEqual([]);
    expect(preflight.get("carrier_shipments_to_create")).toBe(6);
    expect(preflight.get("driver_shipments_to_create")).toBe(3);
    expect(preflight.get("settlement_links")).toBe(2);
    expect(preflight.get("driver_cash_drift:dr1")).toBe(driftBefore);
  });

  it("verify: what moved is what preflight said, and nothing is left behind", async () => {
    const verify = await runScript(d1, "verify-0041.sql");
    expect(verify.get("orders_in_an_old_status")).toBe(0);
    expect(verify.get("shipments_of_orders_not_ready")).toBe(0);
    expect(verify.get("shipments_by_kind:carrier")).toBe(preflight.get("carrier_shipments_to_create"));
    expect(verify.get("shipments_by_kind:driver")).toBe(preflight.get("driver_shipments_to_create"));
    expect(verify.get("settlement_lines")).toBe(preflight.get("settlement_links"));
    expect(verify.get("driver_cash_drift:dr1")).toBe(preflight.get("driver_cash_drift:dr1"));
    expect(verify.get("emptied_columns_holding_a_value")).toBe(0);
    expect(verify.get("zr_companies_with_a_status_map:zr_express")).toBe(preflight.get("zr_companies_with_a_mapping:zr_express"));
  });
});

describe("what stops the migration, with nothing changed", () => {
  const cases: Array<[string, (db: TestD1) => D1PreparedStatement[]]> = [
    ["stranded_deliveries", (db) => [insert(db, "orders", order("lost", "delivered"))]],
    ["driver_and_carrier", (db) => [insert(db, "orders", order("both", "out_for_delivery", { driver_id: "dr1", tracking_number: "yal-B" })), insert(db, "company_shipments", parcel("cs-b", "both", "yal", "yal-B"))]],
    ["duplicate_parcels", (db) => [
      insert(db, "orders", order("d1", "dispatched", { tracking_number: "yal-SAME" })), insert(db, "company_shipments", parcel("cs-d1", "d1", "yal", "yal-SAME")),
      insert(db, "orders", order("d2", "dispatched", { tracking_number: "yal-SAME" })), insert(db, "company_shipments", parcel("cs-d2", "d2", "yal", "yal-SAME")),
    ]],
    ["unmatched_settlements", (db) => [insert(db, "orders", order("paid", "delivered", { driver_id: "dr1", cod_payment_id: "nope" }))]],
    ["unmatched_settlements", (db) => [
      insert(db, "driver_payments", { id: "pay-x", driver_id: "dr1", type: "cod_remittance", amount: 3500, order_count: 1, created_by: "u1", created_by_name: "Staff", created_at: T(300) }),
      insert(db, "orders", order("paid", "returned", { driver_id: "dr1", cod_payment_id: "pay-x" })),
    ]],
  ];

  for (const [i, [constraint, seed]] of cases.entries()) {
    it(`${constraint} (${i + 1})`, async () => {
      const db = await createTestD1({ before: BEFORE });
      try {
        await seedCommon(db);
        await db.raw.batch(seed(db));
        const flagged = await runScript(db, "preflight-0041.sql");
        expect([...flagged].some(([k, n]) => k.startsWith(`guard_${constraint}`) && n > 0), `preflight flags ${constraint}`).toBe(true);
        await expect(db.applyRemaining()).rejects.toThrow(new RegExp(`CHECK constraint failed: ${constraint}`));
        const { results } = await db.raw.prepare("SELECT name FROM sqlite_master WHERE name LIKE '%0041%'").all();
        expect(results).toEqual([]);
        expect(await db.raw.prepare("SELECT count(*) AS n FROM shipments").first<{ n: number }>()).toEqual({ n: 0 });
        expect((await db.raw.prepare("SELECT name FROM pragma_table_info('orders') WHERE name = 'tracking_number'").all()).results).toHaveLength(1);
      } finally {
        await db.dispose();
      }
    }, 60_000);
  }
});
