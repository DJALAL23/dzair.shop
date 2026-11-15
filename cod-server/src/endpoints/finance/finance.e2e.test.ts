/**
 * The store's costs on real D1, through the API: a cost added and refused
 * when it is not one; a change from a day that keeps the days before, of
 * its amount or of what it is for; a correction; moving its days, stopping
 * and deleting; a change refused when the cost changed since it was read,
 * and two changes at once that never both apply; per-order costs counted
 * from real orders and parcels by the store day of their event, for the
 * store or one product, deleted since or not; dollar costs at the rate in
 * force each day and, without one, left out and named; who may read and who
 * may change; random changes written exactly as planned; and the summary's
 * statements going through indexes.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import fc from "fast-check";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { drizzle } from "drizzle-orm/d1";
import { sql } from "drizzle-orm";
import type { AppContext, AuthUser } from "@/types";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import { apiAs, staff } from "@/test-utils/api";
import * as schema from "@/db/schema";
import { SCOPES } from "../../../../cod-shared/rbac/scopes";
import { costsSummary, createCost, deleteCost, updateCost } from "../../../../cod-shared/finance/queries";
import { planChange, type PlannedVersion } from "../../../../cod-shared/finance/versions";
import { addDays } from "../../../../cod-shared/time/store-day";
import financeRouter from "./routes";

let d1: TestD1;
const T = "2026-11-01T08:00:00.000Z";
const ROUTERS: Record<string, OpenAPIHono<AppContext>> = { "/api/finance": financeRouter };
const OWNER: AuthUser = { ...staff([SCOPES.FINANCE_READ, SCOPES.FINANCE_MANAGE]), id: "u-owner", name: "Bilal" };
const owner = () => apiAs(d1, OWNER, ROUTERS);
const as = (scopes: string[]) => apiAs(d1, { ...staff(scopes), id: "u-other", name: "Other" } as AuthUser, ROUTERS);
const run = (statement: string, ...binds: unknown[]) => d1.raw.prepare(statement).bind(...binds).run();

const TODAY = "2026-12-15";

beforeAll(async () => {
  d1 = await createTestD1();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${TODAY}T10:00:00.000Z`));
}, 120_000);
afterAll(async () => {
  vi.useRealTimers();
  await d1?.dispose();
});

beforeEach(async () => {
  for (const table of ["activity_logs", "costs", "exchange_rates", "removed_product_lines", "order_products", "shipments", "orders", "drivers", "delivery_companies", "customers", "products"]) await d1.db.run(sql.raw(`DELETE FROM ${table}`));
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
const read = async (id: string) => (await owner().get("/api/finance/costs")).body.data.find((cost: { id: string }) => cost.id === id);
/** A change to the cost as it is now: what the merchant's screen sends. */
const change = async (id: string, body: Record<string, unknown>) => owner().put(`/api/finance/costs/${id}`, { revision: (await read(id))?.revision ?? "none", ...body });

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
    const raised = await change(id, { ...RENT, amount: 36_000, changeFrom: "2026-11-16" });
    expect(raised.body.data).toMatchObject({ amount: 36_000, startsOn: "2026-09-01", since: "2026-11-16", history: [{ charge: "monthly", amount: 30_000, currency: "DZD", product: null, validFrom: "2026-09-01", validTo: "2026-11-15" }] });
    expect(await summary("2026-10-01", "2026-10-31")).toMatchObject({ total: 30_000, running: 30_000 });
    expect(await summary("2026-11-01", "2026-11-30")).toMatchObject({ total: 15_000 + 18_000 });

    const corrected = await change(id, { ...RENT, amount: 35_000 });
    expect(corrected.body.data).toMatchObject({ amount: 35_000, since: "2026-11-16", history: [{ amount: 30_000 }] });
    expect(await summary("2026-11-01", "2026-11-30")).toMatchObject({ total: 15_000 + 17_500 });
  });

  it("corrects what it is on every amount it had, and dated on or before its start, corrects it in place", async () => {
    const { id } = await add(RENT);
    await change(id, { ...RENT, amount: 36_000, changeFrom: "2026-11-16" });
    await change(id, { ...RENT, name: "Loyer", category: "other", amount: 36_000 });
    expect(await d1.db.select({ name: schema.costs.name, category: schema.costs.category }).from(schema.costs).all()).toEqual([
      { name: "Loyer", category: "other" },
      { name: "Loyer", category: "other" },
    ]);

    const fresh = await add({ ...RENT, name: "Abonnement", category: "software", amount: 4_000, startsOn: "2026-11-05" });
    expect((await change(fresh.id, { ...RENT, name: "Abonnement", category: "software", amount: 4_500, startsOn: "2026-11-05", changeFrom: "2026-11-05" })).body.data).toMatchObject({ amount: 4_500, since: "2026-11-05", history: [] });

    const once = await add({ ...RENT, name: "Shooting", category: "content", charge: "once", amount: 25_000, startsOn: "2026-11-03" });
    expect((await change(once.id, { ...RENT, name: "Shooting", category: "content", charge: "once", amount: 20_000, startsOn: "2026-11-03", changeFrom: "2026-11-10" })).body.data).toMatchObject({ amount: 20_000, history: [] });
  });

  it("of what it is for, from a day, keeps the days before on the product they were for", async () => {
    const packaging = await add({ name: "Emballage", category: "packaging", charge: "per_shipped", amount: 80, currency: "DZD", startsOn: "2026-11-01", productId: "robe" });
    const moved = await change(packaging.id, { name: "Emballage", category: "packaging", charge: "per_shipped", amount: 80, currency: "DZD", startsOn: "2026-11-01", productId: "sac", changeFrom: "2026-11-04" });
    expect(moved.body.data).toMatchObject({ product: { id: "sac", name: "Sac" }, since: "2026-11-04", history: [{ product: { id: "robe", name: "Robe" }, validFrom: "2026-11-01", validTo: "2026-11-03" }] });
  });

  it("saved as it is changes nothing", async () => {
    const { id } = await add(RENT);
    await change(id, { ...RENT, amount: 36_000, changeFrom: "2026-11-16" });
    const versions = () => d1.db.select({ id: schema.costs.id, from: schema.costs.validFrom, to: schema.costs.validTo, amount: schema.costs.amountMinor }).from(schema.costs).orderBy(schema.costs.validFrom).all();
    const before = await versions();
    expect((await change(id, { ...RENT, amount: 36_000, changeFrom: "2026-12-01" })).status).toBe(200);
    expect(await versions()).toEqual(before);
  });

  it("is refused after today, after the cost stops, or when a cost with history would become one-time", async () => {
    const { id } = await add({ ...RENT, stopsOn: "2026-11-30" });
    expect((await change(id, { ...RENT, stopsOn: "2026-11-30", amount: 40_000, changeFrom: "2026-12-05" })).body).toMatchObject({ code: "COST_DATES_INVALID" });
    const running = await add({ ...RENT, name: "Loyer 2" });
    expect((await change(running.id, { ...RENT, name: "Loyer 2", amount: 40_000, changeFrom: "2026-12-16" })).body).toMatchObject({ code: "COST_DATES_INVALID" });
    expect((await change(running.id, { ...RENT, name: "Loyer 2", amount: 40_000, changeFrom: TODAY })).status).toBe(200);
    await change(id, { ...RENT, stopsOn: "2026-11-30", amount: 36_000, changeFrom: "2026-11-16" });
    expect((await change(id, { ...RENT, charge: "once", stopsOn: null, amount: 36_000 })).body).toMatchObject({ code: "COST_HAS_HISTORY" });
    expect((await owner().put("/api/finance/costs/nothing", { ...RENT, revision: "r" })).body).toMatchObject({ code: "COST_NOT_FOUND" });
    expect(await read(id)).toMatchObject({ amount: 36_000, startsOn: "2026-09-01", stopsOn: "2026-11-30" });
  });

  it("is refused, writing nothing, when the cost changed since it was read: a change is never applied twice", async () => {
    const { id } = await add(RENT);
    const seen = (await read(id)).revision;
    expect((await owner().put(`/api/finance/costs/${id}`, { ...RENT, amount: 36_000, changeFrom: "2026-11-16", revision: seen })).status).toBe(200);
    const again = await owner().put(`/api/finance/costs/${id}`, { ...RENT, amount: 36_000, changeFrom: "2026-11-16", revision: seen });
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ code: "COST_CHANGED" });
    expect(await read(id)).toMatchObject({ amount: 36_000, since: "2026-11-16", history: [{ amount: 30_000 }] });
    expect((await owner().put(`/api/finance/costs/${id}`, { ...RENT, amount: 36_000 })).status).toBe(400);
  });

  it("is refused as changed meanwhile, never for what the other change made of it, when the cost changed since it was read", async () => {
    const { id } = await add(RENT);
    const seen = (await read(id)).revision;
    await change(id, { ...RENT, amount: 36_000, changeFrom: "2026-11-16" });
    const late = await owner().put(`/api/finance/costs/${id}`, { ...RENT, charge: "once", revision: seen });
    expect(late.status, JSON.stringify(late.body)).toBe(409);
    expect(late.body).toMatchObject({ code: "COST_CHANGED" });
    expect(await read(id)).toMatchObject({ charge: "monthly", amount: 36_000, since: "2026-11-16", history: [{ amount: 30_000 }] });
  });
});

describe("moving a cost's days", () => {
  it("keeps each day's amount: started after a change, what came before goes", async () => {
    const { id } = await add(RENT);
    await change(id, { ...RENT, amount: 36_000, changeFrom: "2026-11-16" });
    expect((await change(id, { ...RENT, amount: 36_000, startsOn: "2026-11-20" })).body.data).toMatchObject({ amount: 36_000, startsOn: "2026-11-20", since: "2026-11-20", history: [] });
    expect(await summary("2026-11-01", "2026-11-30")).toMatchObject({ total: 11 * 1_200 });
  });
});

describe("two changes at once", () => {
  const racing = (during: () => Promise<unknown>) => {
    let fired = false;
    const raw = new Proxy(d1.raw, {
      get(target, key) {
        if (key === "batch") {
          return async (statements: D1PreparedStatement[]) => {
            if (!fired) {
              fired = true;
              await during();
            }
            return target.batch(statements);
          };
        }
        const value = (target as never)[key] as unknown;
        return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
      },
    });
    return drizzle(raw as D1Database, { schema });
  };
  const input = { name: "Loyer", category: "rent", charge: "monthly", amountMinor: 3_000_000, currency: "DZD", startsOn: "2026-09-01", stopsOn: null } as const;
  const rows = () => d1.db.select({ from: schema.costs.validFrom, to: schema.costs.validTo, amount: schema.costs.amountMinor }).from(schema.costs).orderBy(schema.costs.validFrom).all();

  it("never both apply: the second is refused and the cost is the first one's", async () => {
    const created = await createCost(d1.db, { ...input, productId: null }, "u-owner");
    if (!created.ok) throw new Error("not created");
    const { revision } = created.cost;
    const meanwhile = () => updateCost(d1.db, created.cost.id, { ...input, amountMinor: 3_600_000, changeFrom: "2026-11-16", revision }, "u-a", TODAY);
    const late = await updateCost(racing(meanwhile), created.cost.id, { ...input, amountMinor: 4_000_000, changeFrom: "2026-11-01", revision }, "u-b", TODAY);
    expect(late).toEqual({ ok: false, reason: "changed" });
    expect(await rows()).toEqual([
      { from: "2026-09-01", to: "2026-11-15", amount: 3_000_000 },
      { from: "2026-11-16", to: null, amount: 3_600_000 },
    ]);
  });

  it("never brings back a cost deleted meanwhile", async () => {
    const created = await createCost(d1.db, { ...input, productId: null }, "u-owner");
    if (!created.ok) throw new Error("not created");
    const late = await updateCost(racing(() => deleteCost(d1.db, created.cost.id)), created.cost.id, { ...input, amountMinor: 4_000_000, changeFrom: "2026-11-01", revision: created.cost.revision }, "u-b", TODAY);
    expect(late).toEqual({ ok: false, reason: "changed" });
    expect(await rows()).toEqual([]);
  });
});

describe("any changes of a cost", () => {
  it("are written exactly as planned, one revision on every version", async () => {
    const DAY0 = "2026-09-01";
    const on = (n: number) => addDays(DAY0, n);
    const moneyArb = fc.record({ charge: fc.constantFrom("daily", "monthly", "per_delivered" as const), amountMinor: fc.constantFrom(10_000, 20_000), currency: fc.constantFrom("DZD", "USD" as const) });
    const stepArb = fc.record({
      start: fc.integer({ min: 0, max: 40 }),
      length: fc.option(fc.integer({ min: 0, max: 60 }), { nil: null }),
      money: moneyArb,
      productId: fc.option(fc.constantFrom(null, "robe", "sac"), { nil: undefined }),
      from: fc.option(fc.integer({ min: 0, max: 110 }), { nil: null }),
    });
    const today = on(105);
    const names: Record<string, string> = { robe: "Robe", sac: "Sac" };
    await fc.assert(
      fc.asyncProperty(moneyArb, fc.array(stepArb, { minLength: 1, maxLength: 4 }), async (first, steps) => {
        await d1.db.run(sql`DELETE FROM costs`);
        const created = await createCost(d1.db, { name: "Cost", category: "other", ...first, startsOn: on(0), stopsOn: null, productId: null }, null);
        if (!created.ok) throw new Error("not created");
        const id = created.cost.id;
        const stored = () => d1.db.select().from(schema.costs).where(sql`series_id = ${id}`).orderBy(schema.costs.validFrom).all();
        for (const step of steps) {
          const before = await stored();
          const current: PlannedVersion[] = before.map((row) => ({ id: row.id, validFrom: row.validFrom, validTo: row.validTo, charge: row.charge, amountMinor: row.amountMinor, currency: row.currency, productId: row.productId, productName: row.productName }));
          const target = step.productId === undefined ? undefined : { productId: step.productId, productName: step.productId === null ? null : names[step.productId]! };
          const asked = { startsOn: on(step.start), stopsOn: step.length === null ? null : on(step.start + step.length), money: step.money, target, from: step.from === null ? null : on(step.from) };
          const planned = planChange(current, asked, today);
          const result = await updateCost(d1.db, id, { name: "Cost", category: "other", ...step.money, startsOn: asked.startsOn, stopsOn: asked.stopsOn, productId: step.productId, changeFrom: asked.from, revision: before[0]!.revision }, null, today);
          const after = await stored();
          if (!planned.ok) {
            expect(result).toEqual(planned);
            expect(after).toEqual(before);
            continue;
          }
          expect(result.ok).toBe(true);
          expect(after.map((row) => [row.validFrom, row.validTo, row.charge, row.amountMinor, row.currency, row.productId, row.productName])).toEqual(
            planned.versions.map((v) => [v.validFrom, v.validTo, v.charge, v.amountMinor, v.currency, v.productId, v.productName]),
          );
          for (const [index, version] of planned.versions.entries()) if (version.id !== null) expect(after[index]!.id).toBe(version.id);
          expect(new Set(after.map((row) => row.revision)).size).toBe(1);
          expect(after[0]!.revision).not.toBe(before[0]!.revision);
        }
      }),
      { numRuns: 40 },
    );
  }, 120_000);
});

describe("stopping and deleting", () => {
  it("a stopped cost counts until its last day; a deleted one counts nowhere", async () => {
    const { id } = await add(RENT);
    expect((await change(id, { ...RENT, stopsOn: "2026-11-20" })).body.data).toMatchObject({ stopsOn: "2026-11-20" });
    expect(await summary("2026-11-01", "2026-11-30")).toMatchObject({ total: 20_000 });
    expect((await owner().delete(`/api/finance/costs/${id}`)).status).toBe(200);
    expect(await summary("2026-09-01", "2026-11-30")).toMatchObject({ total: 0, costs: [] });
    expect((await owner().delete(`/api/finance/costs/${id}`)).body).toMatchObject({ code: "COST_NOT_FOUND" });
  });

  it("stopped on a day before a change, ends there with the amount it had that day", async () => {
    const { id } = await add(RENT);
    await change(id, { ...RENT, amount: 36_000, changeFrom: "2026-11-16" });
    expect((await change(id, { ...RENT, amount: 36_000, stopsOn: "2026-11-15" })).body.data).toMatchObject({ amount: 30_000, stopsOn: "2026-11-15", history: [] });
  });
});

describe("the summary", () => {
  it("counts in whole dinars, its lines adding up to its total", async () => {
    await add({ ...RENT, startsOn: "2026-12-01" });
    await add({ ...RENT, name: "Gardien", category: "salaries", amount: 25_000.5, startsOn: "2026-12-01" });
    const december = await summary("2026-12-01", "2026-12-14");
    expect(december.costs.map((line: { amount: number }) => line.amount).sort()).toEqual([11_291, 13_548]);
    expect(december).toMatchObject({ total: 11_291 + 13_548, running: 11_291 + 13_548 });
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

  it("keeps counting a deleted product's orders, so no past month changes, and keeps its name", async () => {
    const packaging = await add({ name: "Emballage robe", category: "packaging", charge: "per_shipped", amount: 80, currency: "DZD", startsOn: "2026-11-01", productId: "robe" });
    const before = await summary("2026-11-01", "2026-11-30");
    expect(before).toMatchObject({ total: 160, costs: [{ id: packaging.id, orders: 2 }] });
    await run("UPDATE products SET name = 'Robe longue' WHERE id = 'robe'");
    await run("DELETE FROM products WHERE id = 'robe'");
    expect(await read(packaging.id)).toMatchObject({ product: { id: null, name: "Robe longue" } });
    expect(await summary("2026-11-01", "2026-11-30")).toEqual(before);
    expect((await change(packaging.id, { name: "Emballage", category: "packaging", charge: "per_shipped", amount: 80, currency: "DZD", startsOn: "2026-11-01" })).body.data).toMatchObject({ name: "Emballage", product: { id: null, name: "Robe longue" } });
    expect(await summary("2026-11-01", "2026-11-30")).toEqual(before);
  });

  it("keeps a deleted product's cost on it when a change sends back the product as it was read before the deletion", async () => {
    const packaging = await add({ name: "Emballage robe", category: "packaging", charge: "per_shipped", amount: 80, currency: "DZD", startsOn: "2026-11-01", productId: "robe" });
    const seen = await read(packaging.id);
    expect(seen.product).toEqual({ id: "robe", name: "Robe" });
    const before = await summary("2026-11-01", "2026-11-30");
    await run("DELETE FROM products WHERE id = 'robe'");
    const kept = await owner().put(`/api/finance/costs/${packaging.id}`, { name: "Emballage", category: "packaging", charge: "per_shipped", amount: 80, currency: "DZD", startsOn: "2026-11-01", productId: seen.product.id, revision: seen.revision });
    expect(kept.status, JSON.stringify(kept.body)).toBe(200);
    expect(kept.body.data).toMatchObject({ name: "Emballage", product: { id: null, name: "Robe" }, history: [] });
    expect(await summary("2026-11-01", "2026-11-30")).toEqual(before);
  });

  it("counts, after a change of product from a day, each day's orders of the product it was for that day", async () => {
    const packaging = await add({ name: "Emballage", category: "packaging", charge: "per_shipped", amount: 80, currency: "DZD", startsOn: "2026-11-01", productId: "robe" });
    await change(packaging.id, { name: "Emballage", category: "packaging", charge: "per_shipped", amount: 80, currency: "DZD", startsOn: "2026-11-01", productId: "sac", changeFrom: "2026-11-04" });
    expect(await summary("2026-11-01", "2026-11-30")).toMatchObject({ total: 160, costs: [{ id: packaging.id, orders: 2 }] });
    expect(await summary("2026-11-04", "2026-11-30")).toMatchObject({ total: 80, costs: [{ id: packaging.id, orders: 1 }] });
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
    expect((await reader.put(`/api/finance/costs/${id}`, { ...RENT, revision: (await read(id)).revision })).status).toBe(403);
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
