/**
 * The store's own costs and exchange rates in D1 (migration 0087): a cost is
 * read and written as a series of versions (versions.ts plans a change); a
 * summary reads the versions that touch a period, the rates and the
 * per-order counts in one batch, and values them (value.ts).
 */
import { and, asc, desc, eq, gte, isNull, lte, ne, or, sql } from "drizzle-orm";
import type { AppDb } from "../db/client";
import { insertSelectRow } from "../db/insert-select";
import { costs, exchangeRates, products } from "../db/schema";
import { addDays, storeDateOf, storeDayStart } from "../time/store-day";
import { countsKey, isPerOrder, type CostCategory, type CostCharge, type CostVersion, type Currency, type DailyCounts, type ExchangeRate, type ForeignCurrency, type PerOrderCharge } from "./model";
import { valueCosts, type CostsValue } from "./value";
import { planChange, type CostTarget, type PlannedVersion } from "./versions";

type BatchStatement = Parameters<AppDb["batch"]>[0][number];
type CostRow = typeof costs.$inferSelect;

/** What a cost is and what it costs, as the merchant sets it. */
export interface CostInput {
  name: string;
  category: CostCategory;
  charge: CostCharge;
  amountMinor: number;
  currency: Currency;
  /** The first day it counts; for a one-time cost, the day it was paid. */
  startsOn: string;
  /** Its last day; null while it runs, and always for a one-time cost. */
  stopsOn: string | null;
}

/** A product a cost is for. A deleted product keeps its name, with no id. */
export type CostProduct = { id: string | null; name: string } | null;

/** What a cost was before a change from a day: its amount, and what it was for. */
export interface CostHistoryEntry {
  charge: CostCharge;
  amountMinor: number;
  currency: Currency;
  product: CostProduct;
  validFrom: string;
  validTo: string;
}

/** A cost as the merchant sees it: what it is, its amount in force, and the amounts it had before. */
export interface CostSeries {
  id: string;
  name: string;
  category: CostCategory;
  charge: CostCharge;
  amountMinor: number;
  currency: Currency;
  startsOn: string;
  /** The day the amount in force started: later than `startsOn` once the amount changed. */
  since: string;
  stopsOn: string | null;
  /** Null for the whole store. */
  product: CostProduct;
  /** What it was before, newest first. */
  history: CostHistoryEntry[];
  /** What a change names to say which state of the cost it was made to (`updateCost`). */
  revision: string;
  createdAt: string;
  updatedAt: string;
}

export type CostRefusal = { ok: false; reason: "not_found" | "product_not_found" | "has_history" | "dates" | "changed" };

type VersionRow = CostRow & { productNow: string | null };

const productOf = (row: VersionRow): CostProduct => (row.productId === null ? null : { id: row.productNow === null ? null : row.productId, name: row.productNow ?? row.productName ?? "" });

function seriesOf(rows: VersionRow[]): CostSeries {
  const first = rows[0]!;
  const latest = rows[rows.length - 1]!;
  return {
    id: latest.seriesId,
    name: latest.name,
    category: latest.category,
    charge: latest.charge,
    amountMinor: latest.amountMinor,
    currency: latest.currency,
    startsOn: first.validFrom,
    since: latest.validFrom,
    stopsOn: latest.validTo,
    product: productOf(latest),
    history: rows
      .slice(0, -1)
      .reverse()
      .map((row) => ({ charge: row.charge, amountMinor: row.amountMinor, currency: row.currency, product: productOf(row), validFrom: row.validFrom, validTo: row.validTo ?? row.validFrom })),
    revision: latest.revision,
    createdAt: first.createdAt,
    updatedAt: latest.updatedAt,
  };
}

const withProductNow = { cost: costs, productNow: products.name };

async function versionsOf(db: AppDb, seriesId?: string) {
  const rows = await db
    .select(withProductNow)
    .from(costs)
    .leftJoin(products, eq(products.id, costs.productId))
    .where(seriesId === undefined ? undefined : eq(costs.seriesId, seriesId))
    .orderBy(asc(costs.seriesId), asc(costs.validFrom))
    .all();
  const grouped = new Map<string, VersionRow[]>();
  for (const { cost, productNow } of rows) grouped.set(cost.seriesId, [...(grouped.get(cost.seriesId) ?? []), { ...cost, productNow }]);
  return grouped;
}

/** Every cost, by name. */
export async function listCosts(db: AppDb): Promise<CostSeries[]> {
  return [...(await versionsOf(db)).values()].map(seriesOf).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

export async function getCost(db: AppDb, id: string): Promise<CostSeries | null> {
  const rows = (await versionsOf(db, id)).get(id);
  return rows ? seriesOf(rows) : null;
}

async function productName(db: AppDb, productId: string): Promise<string | null> {
  return (await db.select({ name: products.name }).from(products).where(eq(products.id, productId)).get())?.name ?? null;
}

export async function createCost(db: AppDb, input: CostInput & { productId: string | null }, createdBy: string | null): Promise<{ ok: true; cost: CostSeries } | CostRefusal> {
  const name = input.productId === null ? null : await productName(db, input.productId);
  if (input.productId !== null && name === null) return { ok: false, reason: "product_not_found" };
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.insert(costs).values({
    id,
    seriesId: id,
    name: input.name,
    category: input.category,
    charge: input.charge,
    amountMinor: input.amountMinor,
    currency: input.currency,
    validFrom: input.startsOn,
    validTo: input.charge === "once" ? null : input.stopsOn,
    productId: input.productId,
    productName: name,
    createdBy,
    revision: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
  });
  return { ok: true, cost: (await getCost(db, id))! };
}

const changed = (result: unknown) => ((result as { meta?: { changes?: number } }).meta?.changes ?? 0) > 0;

/**
 * Changes a cost (versions.ts): its name and category on every version;
 * what it costs and what it is for from a day, today at the latest, the
 * days before keeping theirs; with no day, from the day the terms in force
 * started. `productId` left out keeps what it is for; null makes it the
 * whole store's. The change names the `revision` it was made to: a cost
 * changed since, by anyone, is refused (`changed`) and nothing is written,
 * so a change is never applied to a cost its author did not see, nor twice.
 * Written in one batch that applies only while that revision stands.
 * Refused, writing nothing, when the days would not fit.
 */
export async function updateCost(
  db: AppDb,
  id: string,
  input: CostInput & { productId?: string | null; changeFrom?: string | null; revision: string },
  by: string | null,
  today: string,
): Promise<{ ok: true; cost: CostSeries } | CostRefusal> {
  const rows = (await versionsOf(db, id)).get(id);
  if (!rows) return { ok: false, reason: "not_found" };
  if (rows.some((row) => row.revision !== input.revision)) return { ok: false, reason: "changed" };

  let target: CostTarget | undefined;
  if (input.productId === null) target = { productId: null, productName: null };
  else if (input.productId !== undefined) {
    const known = rows.find((row) => row.productId === input.productId);
    const name = known ? (known.productNow ?? known.productName) : await productName(db, input.productId);
    if (name === null) return { ok: false, reason: "product_not_found" };
    target = { productId: input.productId, productName: name };
  }

  const current: PlannedVersion[] = rows.map((row) => ({
    id: row.id,
    validFrom: row.validFrom,
    validTo: row.validTo,
    charge: row.charge,
    amountMinor: row.amountMinor,
    currency: row.currency,
    productId: row.productId,
    productName: row.productName,
  }));
  const plan = planChange(current, { startsOn: input.startsOn, stopsOn: input.stopsOn, money: { charge: input.charge, amountMinor: input.amountMinor, currency: input.currency }, target, from: input.changeFrom }, today);
  if (!plan.ok) return plan;

  const now = new Date().toISOString();
  const revision = crypto.randomUUID();
  const anchor = plan.versions.find((version) => version.id !== null)!;
  const stands = sql`exists (select 1 from costs held where held.id = ${anchor.id} and held.revision = ${revision})`;
  const fields = (version: PlannedVersion) => ({
    name: input.name,
    category: input.category,
    charge: version.charge,
    amountMinor: version.amountMinor,
    currency: version.currency,
    validFrom: version.validFrom,
    validTo: version.validTo,
    productId: version.productId,
    productName: version.productName,
    revision,
    updatedAt: now,
  });
  const kept = new Set(plan.versions.map((version) => version.id));
  const statements: BatchStatement[] = [
    db.update(costs).set(fields(anchor)).where(and(eq(costs.id, anchor.id!), eq(costs.revision, input.revision))),
    ...rows.filter((row) => !kept.has(row.id)).map((row) => db.delete(costs).where(and(eq(costs.id, row.id), stands))),
    ...plan.versions.filter((version) => version.id !== null && version !== anchor).map((version) => db.update(costs).set(fields(version)).where(and(eq(costs.id, version.id!), stands))),
    ...plan.versions
      .filter((version) => version.id === null)
      .map((version) => {
        const values = { ...fields(version), id: crypto.randomUUID(), seriesId: id, createdBy: by, createdAt: now };
        return db.insert(costs).select(
          db
            .select(insertSelectRow(costs, Object.fromEntries(Object.entries(values).map(([key, value]) => [key, sql`${value}`]))) as never)
            .from(sql`(select 1)`)
            .where(stands),
        );
      }),
  ];
  const [first] = await db.batch(statements as [BatchStatement, ...BatchStatement[]]);
  if (!changed(first)) return { ok: false, reason: "changed" };
  return { ok: true, cost: (await getCost(db, id))! };
}

/** Removes a cost and every amount it had: it was a mistake. Null when there is none. */
export async function deleteCost(db: AppDb, id: string): Promise<{ name: string } | null> {
  const removed = await db.delete(costs).where(eq(costs.seriesId, id)).returning({ name: costs.name }).all();
  return removed[0] ?? null;
}

export interface RateRow extends ExchangeRate {
  id: string;
  createdAt: string;
}

/** Every rate, each currency's newest first. */
export async function listRates(db: AppDb): Promise<RateRow[]> {
  return db
    .select({ id: exchangeRates.id, currency: exchangeRates.currency, centimesPerUnit: exchangeRates.centimesPerUnit, validFrom: exchangeRates.validFrom, createdAt: exchangeRates.createdAt })
    .from(exchangeRates)
    .orderBy(asc(exchangeRates.currency), desc(exchangeRates.validFrom))
    .all();
}

/** Sets what a currency costs from a day; the same currency and day again replaces it. */
export async function setRate(db: AppDb, input: { currency: ForeignCurrency; centimesPerUnit: number; validFrom: string; createdBy: string | null }): Promise<RateRow> {
  const now = new Date().toISOString();
  return (await db
    .insert(exchangeRates)
    .values({ id: crypto.randomUUID(), ...input, createdAt: now })
    .onConflictDoUpdate({ target: [exchangeRates.currency, exchangeRates.validFrom], set: { centimesPerUnit: input.centimesPerUnit, createdBy: input.createdBy, createdAt: now } })
    .returning({ id: exchangeRates.id, currency: exchangeRates.currency, centimesPerUnit: exchangeRates.centimesPerUnit, validFrom: exchangeRates.validFrom, createdAt: exchangeRates.createdAt })
    .get())!;
}

export async function removeRate(db: AppDb, id: string): Promise<RateRow | null> {
  return (
    (await db
      .delete(exchangeRates)
      .where(eq(exchangeRates.id, id))
      .returning({ id: exchangeRates.id, currency: exchangeRates.currency, centimesPerUnit: exchangeRates.centimesPerUnit, validFrom: exchangeRates.validFrom, createdAt: exchangeRates.createdAt })
      .get()) ?? null
  );
}

/** Where each per-order event is read: the instant it happened, the order it is of, and what makes it count. */
const EVENTS: Record<PerOrderCharge, { table: string; at: string; order: string; only?: string }> = {
  per_confirmed: { table: "orders o", at: "o.confirmed_at", order: "o.id" },
  per_shipped: { table: "shipments s", at: "s.created_at", order: "s.order_id", only: "s.handoff_state = 'accepted'" },
  per_delivered: { table: "shipments s", at: "s.delivered_at", order: "s.order_id" },
  per_returned: { table: "shipments s", at: "s.returned_at", order: "s.order_id" },
};

/** How many orders an event touched each store day of a period, for the whole store or the orders holding one product. */
function countStatement(db: AppDb, charge: PerOrderCharge, productId: string | null, from: string, to: string) {
  const event = EVENTS[charge];
  const at = sql.raw(event.at);
  const day = storeDateOf(event.at);
  return db
    .select({ day: sql<string>`${day}`, orders: sql<number>`count(*)` })
    .from(sql.raw(event.table))
    .where(
      and(
        sql`${at} >= ${storeDayStart(from)}`,
        sql`${at} < ${storeDayStart(addDays(to, 1))}`,
        event.only ? sql.raw(event.only) : undefined,
        productId === null
          ? undefined
          : sql`exists (select 1 from order_products op left join removed_product_lines r on r.order_product_id = op.id where op.order_id = ${sql.raw(event.order)} and coalesce(op.product_id, r.product_id) = ${productId})`,
      ),
    )
    .groupBy(day);
}

const versionOf = (row: CostRow): CostVersion => ({
  id: row.id,
  seriesId: row.seriesId,
  category: row.category,
  charge: row.charge,
  amountMinor: row.amountMinor,
  currency: row.currency,
  validFrom: row.validFrom,
  validTo: row.validTo,
  productId: row.productId,
});

/**
 * The store's costs over store days `from` to `to` (both included): what each
 * cost counts, the three groups and the total in dinar centimes, and the
 * rates missing. One trip to the database for the rates and every count.
 */
export async function costsSummary(db: AppDb, from: string, to: string): Promise<CostsValue> {
  const rows = await db
    .select()
    .from(costs)
    .where(and(lte(costs.validFrom, to), or(isNull(costs.validTo), gte(costs.validTo, from)), or(ne(costs.charge, "once"), gte(costs.validFrom, from))))
    .all();
  const versions = rows.map(versionOf);
  const pairs = new Map<string, { charge: PerOrderCharge; productId: string | null }>();
  for (const version of versions) {
    if (!isPerOrder(version.charge)) continue;
    pairs.set(countsKey(version.charge, version.productId), { charge: version.charge, productId: version.productId });
  }
  const foreign = versions.some((version) => version.currency !== "DZD");
  const statements: BatchStatement[] = [
    ...(foreign ? [db.select({ currency: exchangeRates.currency, centimesPerUnit: exchangeRates.centimesPerUnit, validFrom: exchangeRates.validFrom }).from(exchangeRates)] : []),
    ...[...pairs.values()].map(({ charge, productId }) => countStatement(db, charge, productId, from, to)),
  ];
  const results = statements.length > 0 ? ((await db.batch(statements as [BatchStatement, ...BatchStatement[]])) as unknown[]) : [];
  const rates = (foreign ? results.shift() : []) as ExchangeRate[];
  const counts = new Map<string, DailyCounts>([...pairs.keys()].map((key, index) => [key, new Map((results[index] as Array<{ day: string; orders: number }>).map((row) => [row.day, row.orders]))]));
  return valueCosts(versions, rates, counts, from, to);
}
