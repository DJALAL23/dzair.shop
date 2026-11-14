/**
 * The store's own costs and exchange rates in D1 (migration 0087): a cost is
 * read and written as a series of versions; a summary reads the versions
 * that touch a period, the rates and the per-order counts in one batch, and
 * values them (value.ts).
 */
import { and, asc, desc, eq, gte, isNull, lte, ne, or, sql } from "drizzle-orm";
import type { AppDb } from "../db/client";
import { costs, exchangeRates, products } from "../db/schema";
import { addDays, storeDateOf, storeDayStart } from "../time/store-day";
import { countsKey, isPerOrder, type CostCategory, type CostCharge, type CostVersion, type Currency, type DailyCounts, type ExchangeRate, type ForeignCurrency, type PerOrderCharge } from "./model";
import { valueCosts, type CostsValue } from "./value";

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

/** An amount a cost had before a change from a day. */
export interface CostHistoryEntry {
  charge: CostCharge;
  amountMinor: number;
  currency: Currency;
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
  /** Null for the whole store. A deleted product keeps its name, with no id. */
  product: { id: string | null; name: string } | null;
  /** Earlier amounts, newest first. */
  history: CostHistoryEntry[];
  createdAt: string;
  updatedAt: string;
}

export type CostRefusal = { ok: false; reason: "not_found" | "product_not_found" | "has_history" | "dates" };

function seriesOf(rows: Array<CostRow & { productNow: string | null }>): CostSeries {
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
    product: latest.productName === null ? null : { id: latest.productId, name: latest.productNow ?? latest.productName },
    history: rows
      .slice(0, -1)
      .reverse()
      .map((row) => ({ charge: row.charge, amountMinor: row.amountMinor, currency: row.currency, validFrom: row.validFrom, validTo: row.validTo ?? row.validFrom })),
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
  const grouped = new Map<string, Array<CostRow & { productNow: string | null }>>();
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
    createdAt: now,
    updatedAt: now,
  });
  return { ok: true, cost: (await getCost(db, id))! };
}

/**
 * Changes a cost. What it is (name, category, product) is corrected on every
 * version. Its money (amount, currency, charge) changed from a day after its
 * amount in force started ends that version the day before and starts a new
 * one, so the days before keep what they cost; changed from that day or
 * earlier, or with no day, it is corrected in place. A one-time cost has no
 * history: a cost with earlier amounts cannot become one, nor stop being
 * one. `productId` undefined keeps the product; null makes it the whole
 * store's. Refused, writing nothing, when the days would not follow on.
 */
export async function updateCost(
  db: AppDb,
  id: string,
  input: CostInput & { productId?: string | null; changeFrom?: string | null },
  by: string | null,
): Promise<{ ok: true; cost: CostSeries } | CostRefusal> {
  const rows = (await versionsOf(db, id)).get(id);
  if (!rows) return { ok: false, reason: "not_found" };
  const latest = rows[rows.length - 1]!;
  if (rows.length > 1 && (input.charge === "once") !== (latest.charge === "once")) return { ok: false, reason: "has_history" };

  let product = { productId: latest.productId, productName: latest.productName };
  if (input.productId === null) product = { productId: null, productName: null };
  else if (input.productId !== undefined) {
    const name = input.productId === latest.productId ? latest.productNow : await productName(db, input.productId);
    if (name === null) return { ok: false, reason: "product_not_found" };
    product = { productId: input.productId, productName: name };
  }

  const money = { charge: input.charge, amountMinor: input.amountMinor, currency: input.currency };
  const moneyChanged = money.charge !== latest.charge || money.amountMinor !== latest.amountMinor || money.currency !== latest.currency;
  const split = moneyChanged && latest.charge !== "once" && input.charge !== "once" && input.changeFrom != null && input.changeFrom > latest.validFrom;

  const plan = rows.map((row) => ({ id: row.id, validFrom: row.validFrom, validTo: row.validTo, ...(row === latest && !split ? money : {}) }));
  plan[0]!.validFrom = input.startsOn;
  const stopsOn = input.charge === "once" ? null : input.stopsOn;
  if (split) {
    plan[plan.length - 1]!.validTo = addDays(input.changeFrom!, -1);
    plan.push({ id: crypto.randomUUID(), validFrom: input.changeFrom!, validTo: stopsOn, ...money });
  } else plan[plan.length - 1]!.validTo = stopsOn;
  const followsOn = plan.every((version, index) => (version.validTo === null || version.validTo >= version.validFrom) && (index === 0 || plan[index - 1]!.validTo === addDays(version.validFrom, -1)));
  if (!followsOn) return { ok: false, reason: "dates" };

  const now = new Date().toISOString();
  const labels = { name: input.name, category: input.category, ...product, updatedAt: now };
  const dates = ({ id: _id, ...rest }: (typeof plan)[number]) => rest;
  const statements: BatchStatement[] = plan.map((version) =>
    rows.some((row) => row.id === version.id)
      ? db.update(costs).set({ ...labels, ...dates(version) }).where(eq(costs.id, version.id))
      : db.insert(costs).values({ ...labels, ...money, id: version.id, seriesId: id, validFrom: version.validFrom, validTo: version.validTo, createdBy: by, createdAt: now }),
  );
  await db.batch(statements as [BatchStatement, ...BatchStatement[]]);
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
        productId === null ? undefined : sql`exists (select 1 from order_products op where op.order_id = ${sql.raw(event.order)} and op.product_id = ${productId})`,
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
  forProduct: row.productName !== null,
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
    if (!isPerOrder(version.charge) || (version.forProduct && version.productId === null)) continue;
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
