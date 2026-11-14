/**
 * The store's costs on real D1, through the API: a cost added and refused
 * when it is not one; a change from a day that keeps the days before; a
 * correction; stopping and deleting; per-order costs counted from real
 * orders and parcels by the store day of their event, for the store or one
 * product; dollar costs at the rate in force each day and, without one,
 * left out and named; who may read and who may change; and the summary's
 * statements going through indexes.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { drizzle } from "drizzle-orm/d1";
import { sql } from "drizzle-orm";
import type { AppContext, AuthUser } from "@/types";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import { apiAs, staff } from "@/test-utils/api";
import * as schema from "@/db/schema";
import { SCOPES } from "../../../../cod-shared/rbac/scopes";
import { costsSummary } from "../../../../cod-shared/finance/queries";
import financeRouter from "./routes";

let d1: TestD1;
const T = "2026-11-01T08:00:00.000Z";
const ROUTERS: Record<string, OpenAPIHono<AppContext>> = { "/api/finance": financeRouter };
const OWNER: AuthUser = { ...staff([SCOPES.FINANCE_READ, SCOPES.FINANCE_MANAGE]), id: "u-owner", name: "Bilal" };
const owner = () => apiAs(d1, OWNER, ROUTERS);
const as = (scopes: string[]) => apiAs(d1, { ...staff(scopes), id: "u-other", name: "Other" } as AuthUser, ROUTERS);
const run = (statement: string, ...binds: unknown[]) => d1.raw.prepare(statement).bind(...binds).run();

beforeAll(async () => {
  d1 = await createTestD1();
}, 120_000);
afterAll(async () => d1?.dispose());

beforeEach(async () => {
  for (const table of ["activity_logs", "costs", "exchange_rates", "order_products", "shipments", "orders", "drivers", "delivery_companies", "customers", "products"]) await d1.db.run(sql.raw(`DELETE FROM ${table}`));
  await run("INSERT INTO delivery_companies (id, name, name_ar, code, provider, created_at, updated_at) VALUES ('zr', 'ZR', 'ZR', 'zr_express', 'zr_express', ?, ?)", T, T);
  await run("INSERT INTO customers (id, name, phone, wilaya, created_at) VALUES ('c1', 'Amel', '0551234567', 'Alger', ?)", T);
  await run("INSERT INTO drivers (id, first_name, last_name, phone, created_at, updated_at) VALUES ('d1', 'Ali', 'B', '0661000000', ?, ?)", T, T);
  for (const [id, name] of [["robe", "Robe"], ["sac", "Sac"]]) {
    await run("INSERT INTO products (id, name, handle, sku, price, status, visibility, show_in_store, track_inventory, inventory, created_at, updated_at) VALUES (?, ?, ?, ?, 3000, 'ACTIVE', 1, 1, 0, 0, ?, ?)", id, name, id, id, T, T);
  }
});

const RENT = { name: "Loyer du local", category: "rent", charge: "monthly", amount: 30_000, currency: "DZD", startsOn: "2026-09-01" };
const summary = async (from: string, to: string) => (await owner().get(`/api/finance/costs/summary?from=${from}&to=${to}`)).body.data;
const add = async (cost: Record<string, unknown>) => {
  const answer = await owner().post("/api/finance/costs", cost);
  expect(answer.status, JSON.stringify(answer.body)).toBe(201);
  return answer.body.data as { id: string };
};

describe("a cost", () => {
  it("is added, listed with its amount in force, and logged", async () => {
    const { id } = await add(RENT);
    const { body } = await owner().get("/api/finance/costs");
    expect(body.data).toEqual([
      expect.objectContaining({ id, name: "Loyer du local", category: "rent", charge: "monthly", amount: 30_000, currency: "DZD", startsOn: "2026-09-01", since: "2026-09-01", stopsOn: null, product: null, history: [] }),
    ]);
    expect(await d1.db.select({ action: schema.activityLogs.action, label: schema.activityLogs.entityLabel }).from(schema.activityLogs).all()).toEqual([{ action: "finance.cost_added", label: "Loyer du local" }]);
  });

  it("is refused when it is not one: nothing to pay, a third decimal, an end before its start, an end on a one-time cost, a day that does not exist, an unknown product", async () => {
    for (const wrong of [
      { ...RENT, amount: 0 },
      { ...RENT, amount: 12.345 },
      { ...RENT, stopsOn: "2026-08-31" },
      { ...RENT, charge: "once", stopsOn: "2026-09-30" },
      { ...RENT, startsOn: "2026-02-31" },
      { ...RENT, category: "taxes" },
      { ...RENT, name: "  " },
    ]) {
      expect((await owner().post("/api/finance/costs", wrong)).status, JSON.stringify(wrong)).toBe(400);
    }
    expect((await owner().post("/api/finance/costs", { ...RENT, productId: "nothing" })).body).toMatchObject({ code: "PRODUCT_NOT_FOUND" });
    expect((await owner().get("/api/finance/costs")).body.data).toEqual([]);
  });
});

describe("a change of a cost's money", () => {
  it("from a day keeps the days before at the old amount, and a correction changes its amount in force", async () => {
    const { id } = await add(RENT);
    const raised = await owner().put(`/api/finance/costs/${id}`, { ...RENT, amount: 36_000, changeFrom: "2026-11-16" });
    expect(raised.body.data).toMatchObject({ amount: 36_000, startsOn: "2026-09-01", since: "2026-11-16", history: [{ charge: "monthly", amount: 30_000, currency: "DZD", validFrom: "2026-09-01", validTo: "2026-11-15" }] });
    expect(await summary("2026-10-01", "2026-10-31")).toMatchObject({ total: 30_000, running: 30_000 });
    expect(await summary("2026-11-01", "2026-11-30")).toMatchObject({ total: 15_000 + 18_000 });

    const corrected = await owner().put(`/api/finance/costs/${id}`, { ...RENT, amount: 35_000 });
    expect(corrected.body.data).toMatchObject({ amount: 35_000, since: "2026-11-16", history: [{ amount: 30_000 }] });
    expect(await summary("2026-11-01", "2026-11-30")).toMatchObject({ total: 15_000 + 17_500 });
  });

  it("corrects what it is on every amount it had, and dated on or before its start, corrects it in place", async () => {
    const { id } = await add(RENT);
    await owner().put(`/api/finance/costs/${id}`, { ...RENT, amount: 36_000, changeFrom: "2026-11-16" });
    await owner().put(`/api/finance/costs/${id}`, { ...RENT, name: "Loyer", category: "other", amount: 36_000 });
    expect(await d1.db.select({ name: schema.costs.name, category: schema.costs.category }).from(schema.costs).all()).toEqual([
      { name: "Loyer", category: "other" },
      { name: "Loyer", category: "other" },
    ]);

    const fresh = await add({ ...RENT, name: "Abonnement", category: "software", amount: 4_000, startsOn: "2026-11-05" });
    expect((await owner().put(`/api/finance/costs/${fresh.id}`, { ...RENT, name: "Abonnement", category: "software", amount: 4_500, startsOn: "2026-11-05", changeFrom: "2026-11-05" })).body.data).toMatchObject({ amount: 4_500, since: "2026-11-05", history: [] });

    const once = await add({ ...RENT, name: "Shooting", category: "content", charge: "once", amount: 25_000, startsOn: "2026-11-03" });
    expect((await owner().put(`/api/finance/costs/${once.id}`, { ...RENT, name: "Shooting", category: "content", charge: "once", amount: 20_000, startsOn: "2026-11-03", changeFrom: "2026-11-10" })).body.data).toMatchObject({ amount: 20_000, history: [] });
  });

  it("is refused when the days would not follow on, or a cost with history would become one-time", async () => {
    const { id } = await add({ ...RENT, stopsOn: "2026-11-30" });
    expect((await owner().put(`/api/finance/costs/${id}`, { ...RENT, stopsOn: "2026-11-30", amount: 40_000, changeFrom: "2026-12-05" })).body).toMatchObject({ code: "COST_DATES_INVALID" });
    await owner().put(`/api/finance/costs/${id}`, { ...RENT, stopsOn: "2026-11-30", amount: 36_000, changeFrom: "2026-11-16" });
    expect((await owner().put(`/api/finance/costs/${id}`, { ...RENT, startsOn: "2026-11-20", stopsOn: "2026-11-30", amount: 36_000 })).body).toMatchObject({ code: "COST_DATES_INVALID" });
    expect((await owner().put(`/api/finance/costs/${id}`, { ...RENT, stopsOn: "2026-11-10", amount: 36_000 })).body).toMatchObject({ code: "COST_DATES_INVALID" });
    expect((await owner().put(`/api/finance/costs/${id}`, { ...RENT, charge: "once", stopsOn: null, amount: 36_000 })).body).toMatchObject({ code: "COST_HAS_HISTORY" });
    expect((await owner().put("/api/finance/costs/nothing", RENT)).body).toMatchObject({ code: "COST_NOT_FOUND" });
    expect((await owner().get("/api/finance/costs")).body.data[0]).toMatchObject({ amount: 36_000, startsOn: "2026-09-01", stopsOn: "2026-11-30" });
  });
});

describe("stopping and deleting", () => {
  it("a stopped cost counts until its last day; a deleted one counts nowhere", async () => {
    const { id } = await add(RENT);
    expect((await owner().put(`/api/finance/costs/${id}`, { ...RENT, stopsOn: "2026-11-20" })).body.data).toMatchObject({ stopsOn: "2026-11-20" });
    expect(await summary("2026-11-01", "2026-11-30")).toMatchObject({ total: 20_000 });
    expect((await owner().delete(`/api/finance/costs/${id}`)).status).toBe(200);
    expect(await summary("2026-09-01", "2026-11-30")).toMatchObject({ total: 0, costs: [] });
    expect((await owner().delete(`/api/finance/costs/${id}`)).body).toMatchObject({ code: "COST_NOT_FOUND" });
  });
});

describe("a cost per order", () => {
  let n = 0;
  async function order(fields: { confirmedAt?: string; shippedAt?: string; deliveredAt?: string; returnedAt?: string; products?: string[]; stillSubmitting?: boolean }) {
    const id = `o-${++n}`;
    await run(
      "INSERT INTO orders (id, order_number, customer_id, customer_name, phone, wilaya_id, commune_id, price, status, delivery_type, confirmed_at, created_at, updated_at) VALUES (?, ?, 'c1', 'Amel', '0551234567', 16, 'c-16-001', 3000, 'confirmed', 'home', ?, ?, ?)",
      id, `N-${id}`, fields.confirmedAt ?? null, T, T,
    );
    for (const product of fields.products ?? []) {
      await run("INSERT INTO order_products (id, order_id, product_id, product_name, quantity, price_per_unit, line_total, created_at) VALUES (?, ?, ?, ?, 1, 3000, 3000, ?)", `${id}-${product}`, id, product, product, T);
    }
    if (fields.shippedAt && fields.stillSubmitting) {
      await run(
        "INSERT INTO shipments (id, order_id, kind, company_id, handoff_state, delivery_type, cod_amount, revision, created_at, updated_at) VALUES (?, ?, 'carrier', 'zr', 'submitting', 'home', 3400, 'r', ?, ?)",
        `s-${id}`, id, fields.shippedAt, fields.shippedAt,
      );
    } else if (fields.shippedAt) {
      await run(
        "INSERT INTO shipments (id, order_id, kind, driver_id, handoff_state, delivery_type, cod_amount, delivered_at, returned_at, revision, created_at, updated_at) VALUES (?, ?, 'driver', 'd1', 'accepted', 'home', 3400, ?, ?, 'r', ?, ?)",
        `s-${id}`, id, fields.deliveredAt ?? null, fields.returnedAt ?? null, fields.shippedAt, fields.shippedAt,
      );
    }
  }

  beforeEach(async () => {
    await order({ confirmedAt: "2026-11-02T09:00:00.000Z", shippedAt: "2026-11-03T09:00:00.000Z", deliveredAt: "2026-11-05T09:00:00.000Z", products: ["robe"] });
    await order({ confirmedAt: "2026-11-02T10:00:00.000Z", shippedAt: "2026-11-03T10:00:00.000Z", returnedAt: "2026-11-09T10:00:00.000Z", products: ["sac"] });
    await order({ confirmedAt: "2026-11-04T10:00:00.000Z", shippedAt: "2026-11-30T22:30:00.000Z", products: ["robe", "sac"] });
    await order({ confirmedAt: "2026-11-30T23:30:00.000Z" });
    await order({ confirmedAt: "2026-10-31T22:59:00.000Z" });
    await order({ shippedAt: "2026-11-06T10:00:00.000Z", products: ["robe"], stillSubmitting: true });
  });

  it("counts the orders its event touched on each store day of Algeria it runs, for the store or one product", async () => {
    const calls = await add({ name: "Centre d'appel", category: "calls", charge: "per_delivered", amount: 150, currency: "DZD", startsOn: "2026-11-01" });
    const confirmations = await add({ name: "Crédit téléphone", category: "calls", charge: "per_confirmed", amount: 20, currency: "DZD", startsOn: "2026-11-01" });
    const packaging = await add({ name: "Emballage robe", category: "packaging", charge: "per_shipped", amount: 80, currency: "DZD", startsOn: "2026-11-01", productId: "robe" });
    const returns = await add({ name: "Retours", category: "other", charge: "per_returned", amount: 100, currency: "DZD", startsOn: "2026-11-01", stopsOn: "2026-11-08" });

    const november = await summary("2026-11-01", "2026-11-30");
    const line = (id: string) => november.costs.find((cost: { id: string }) => cost.id === id);
    expect(line(calls.id)).toMatchObject({ amount: 150, orders: 1 });
    expect(line(confirmations.id)).toMatchObject({ amount: 60, orders: 3 });
    expect(line(packaging.id)).toMatchObject({ amount: 160, orders: 2 });
    expect(line(returns.id)).toMatchObject({ amount: 0, orders: 0 });
    expect(november).toMatchObject({ total: 370, perOrder: 370, running: 0, ads: 0 });

    expect((await summary("2026-12-01", "2026-12-01")).costs.find((cost: { id: string }) => cost.id === confirmations.id)).toMatchObject({ orders: 1 });
    expect((await summary("2026-10-31", "2026-10-31")).costs.find((cost: { id: string }) => cost.id === confirmations.id)).toBeUndefined();
  });

  it("keeps a deleted product's cost and its name, and counts no order for it from then", async () => {
    const packaging = await add({ name: "Emballage robe", category: "packaging", charge: "per_shipped", amount: 80, currency: "DZD", startsOn: "2026-11-01", productId: "robe" });
    await run("DELETE FROM products WHERE id = 'robe'");
    expect((await owner().get("/api/finance/costs")).body.data[0]).toMatchObject({ id: packaging.id, product: { id: null, name: "Robe" } });
    expect(await summary("2026-11-01", "2026-11-30")).toMatchObject({ total: 0, costs: [{ id: packaging.id, orders: 0 }] });
  });
});

describe("a cost in dollars", () => {
  const FB = { name: "Facebook ads", category: "ads", charge: "daily", amount: 20, currency: "USD", startsOn: "2026-11-01" };

  it("is left out and named until the dollar has a rate; then each day takes the rate in force", async () => {
    const { id } = await add(FB);
    expect(await summary("2026-11-01", "2026-11-10")).toMatchObject({ total: 0, ads: 0, costs: [{ id, amount: 0, ownAmount: 200, missingFrom: "2026-11-01" }], missing: [{ currency: "USD", from: "2026-11-01", costIds: [id] }] });

    const set = await owner().post("/api/finance/rates", { currency: "USD", dzdPerUnit: 250, validFrom: "2026-11-01" });
    expect(set.body.data).toMatchObject({ currency: "USD", dzdPerUnit: 250, validFrom: "2026-11-01" });
    expect(await summary("2026-11-01", "2026-11-10")).toMatchObject({ total: 50_000, ads: 50_000, missing: [] });

    await owner().post("/api/finance/rates", { currency: "USD", dzdPerUnit: 262.5, validFrom: "2026-11-06" });
    expect(await summary("2026-11-01", "2026-11-10")).toMatchObject({ total: 5 * 20 * 250 + 5 * 20 * 262.5 });

    await owner().post("/api/finance/rates", { currency: "USD", dzdPerUnit: 260, validFrom: "2026-11-06" });
    const rates = (await owner().get("/api/finance/rates")).body.data;
    expect(rates.map((rate: { dzdPerUnit: number; validFrom: string }) => [rate.validFrom, rate.dzdPerUnit])).toEqual([
      ["2026-11-06", 260],
      ["2026-11-01", 250],
    ]);

    expect((await owner().delete(`/api/finance/rates/${rates[1].id}`)).status).toBe(200);
    expect(await summary("2026-11-01", "2026-11-10")).toMatchObject({ total: 5 * 20 * 260, missing: [{ currency: "USD", from: "2026-11-01" }] });
    expect((await owner().delete(`/api/finance/rates/${rates[1].id}`)).body).toMatchObject({ code: "EXCHANGE_RATE_NOT_FOUND" });
  });

  it("refuses a rate of nothing, a third decimal and a currency without rates", async () => {
    for (const wrong of [
      { currency: "USD", dzdPerUnit: 0, validFrom: "2026-11-01" },
      { currency: "USD", dzdPerUnit: 250.123, validFrom: "2026-11-01" },
      { currency: "DZD", dzdPerUnit: 1, validFrom: "2026-11-01" },
    ]) expect((await owner().post("/api/finance/rates", wrong)).status, JSON.stringify(wrong)).toBe(400);
  });
});

describe("who may see and change the costs", () => {
  it("reads with finance:read, changes only with finance:manage, and sees nothing without either", async () => {
    const { id } = await add(RENT);
    const reader = as([SCOPES.FINANCE_READ]);
    expect((await reader.get("/api/finance/costs")).status).toBe(200);
    expect((await reader.get("/api/finance/costs/summary?from=2026-11-01&to=2026-11-30")).status).toBe(200);
    expect((await reader.get("/api/finance/rates")).status).toBe(200);
    expect((await reader.post("/api/finance/costs", RENT)).status).toBe(403);
    expect((await reader.put(`/api/finance/costs/${id}`, RENT)).status).toBe(403);
    expect((await reader.delete(`/api/finance/costs/${id}`)).status).toBe(403);
    expect((await reader.post("/api/finance/rates", { currency: "USD", dzdPerUnit: 250, validFrom: "2026-11-01" })).status).toBe(403);
    const stranger = as([SCOPES.ORDERS_READ]);
    expect((await stranger.get("/api/finance/costs")).status).toBe(403);
    expect((await stranger.get("/api/finance/rates")).status).toBe(403);
  });

  it("refuses a summary over a period that runs backwards or longer than a year", async () => {
    expect((await owner().get("/api/finance/costs/summary?from=2026-11-30&to=2026-11-01")).status).toBe(400);
    expect((await owner().get("/api/finance/costs/summary?from=2025-01-01&to=2026-11-30")).status).toBe(400);
  });
});

describe("the summary's reads", () => {
  it("count orders and parcels through indexes, never by reading every order or shipment", async () => {
    for (const charge of ["per_confirmed", "per_shipped", "per_delivered", "per_returned"]) {
      await add({ name: charge, category: "other", charge, amount: 10, currency: "DZD", startsOn: "2026-11-01" });
      await add({ name: `${charge} robe`, category: "other", charge, amount: 10, currency: "DZD", startsOn: "2026-11-01", productId: "robe" });
    }
    await add({ name: "Facebook ads", category: "ads", charge: "daily", amount: 20, currency: "USD", startsOn: "2026-11-01" });
    const statements: string[] = [];
    const recording = new Proxy(d1.raw, {
      get(target, key) {
        if (key === "prepare") return (query: string) => (statements.push(query), target.prepare(query));
        const value = (target as never)[key] as unknown;
        return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
      },
    });
    await costsSummary(drizzle(recording as D1Database, { schema }), "2026-11-01", "2026-11-30");
    const counts = statements.filter((statement) => /from (orders|shipments) /i.test(statement));
    expect(counts).toHaveLength(8);
    for (const statement of counts) {
      const binds = (statement.match(/\?/g) ?? []).map((_, index) => (index < 2 ? "2026-11-01" : "robe"));
      const plan = (await d1.raw.prepare(`EXPLAIN QUERY PLAN ${statement}`).bind(...binds).all<{ detail: string }>()).results.map((row) => row.detail).join(" | ");
      expect(plan, statement).not.toMatch(/SCAN (o|s)\b(?! USING)/);
    }
  });
});
