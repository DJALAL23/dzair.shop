/**
 * Analytics Queries
 *
 * Read-only queries for the dashboard and reporting endpoints, each one
 * database round-trip with no client-side aggregation.
 */

import { and, count, eq, gte, ne, sql } from "drizzle-orm";
import type { AppDb } from "../db/client";
import { orders, shipments } from "../db/schema";
import type { OrderStage } from "../orders/stage";
import { orderNeedsAttentionSql, orderStageSql } from "../orders/stage-sql";

export interface OrderStageStats {
  /** Orders per stage — archived ones too, unless left out; only stages with at least one order. */
  stages: Array<{ stage: OrderStage; count: number }>;
  /** Orders whose delivery needs the merchant, whatever their stage. */
  needsAttention: number;
  /** Orders the merchant archived. */
  archived: number;
  /** Of the parcels whose delivery ended, the share delivered (`deliveryRate`). */
  deliveryRate: number | null;
}

/**
 * Of the parcels whose delivery ended — delivered or returned — the share
 * delivered, as a whole percent; null before any ended. A return under way
 * can still end delivered, and a parcel the carrier cancelled never reached
 * the customer: neither counts, for or against.
 */
export function deliveryRate(stages: ReadonlyArray<{ stage: OrderStage; count: number }>): number | null {
  const count = (stage: OrderStage) => stages.find((entry) => entry.stage === stage)?.count ?? 0;
  const delivered = count("delivered");
  const ended = delivered + count("returned");
  return ended === 0 ? null : Math.round((delivered / ended) * 100);
}

/**
 * Orders by the stage the merchant sees, how many need attention, how many
 * are archived, and the delivery rate. Every order counts;
 * `archived: "exclude"` gives the working lists' counts instead, which leave
 * archived orders out. The delivery rate always reads every order: archiving
 * a finished order never changes how its delivery ended.
 */
export async function getOrderStageStats(db: AppDb, options: { archived?: "include" | "exclude" } = {}): Promise<OrderStageStats> {
  const stage = orderStageSql();
  const attention = orderNeedsAttentionSql();
  const isArchived = sql`(${orders.archivedAt} is not null)`;
  const rows = await db
    .select({
      stage,
      all: count(),
      archived: sql<number>`sum(${isArchived})`,
      attention: sql<number>`sum(${attention})`,
      archivedAttention: sql<number>`sum(${attention} and ${isArchived})`,
    })
    .from(orders)
    .leftJoin(shipments, eq(shipments.orderId, orders.id))
    .groupBy(stage)
    .all();
  const exclude = options.archived === "exclude";
  const every = rows.map((r) => ({ stage: r.stage, count: Number(r.all) }));
  const stages = rows
    .map((r) => ({ stage: r.stage, count: Number(r.all) - (exclude ? Number(r.archived ?? 0) : 0) }))
    .filter((entry) => entry.count > 0);
  return {
    stages,
    needsAttention: rows.reduce((sum, r) => sum + Number(r.attention ?? 0) - (exclude ? Number(r.archivedAttention ?? 0) : 0), 0),
    archived: rows.reduce((sum, r) => sum + Number(r.archived ?? 0), 0),
    deliveryRate: deliveryRate(every),
  };
}

/** The windows the overview offers, in days. */
export const ACTIVITY_WINDOWS = [7, 30, 90] as const;
export type ActivityWindow = (typeof ACTIVITY_WINDOWS)[number];

/** Algeria keeps UTC+1 all year: a store's day starts at 23:00 UTC the evening before. */
const STORE_UTC_OFFSET_HOURS = 1;

export interface OrderActivityDay {
  /** The store's calendar day, YYYY-MM-DD. */
  date: string;
  orders: number;
  /** What those orders are worth to the store: price plus delivery fee. */
  orderValue: number;
}

export interface OrderActivity {
  /** First day of the window, YYYY-MM-DD, store time. */
  from: string;
  /** Today, store time — the window's last day. */
  to: string;
  /** Days with at least one order, oldest first; a missing day had none. */
  days: OrderActivityDay[];
  /** The same number of days just before the window, for comparison. */
  previous: { orders: number; orderValue: number };
}

function storeDay(instant: Date, shiftDays = 0): string {
  const shifted = new Date(instant.getTime() + STORE_UTC_OFFSET_HOURS * 3_600_000 + shiftDays * 86_400_000);
  return shifted.toISOString().slice(0, 10);
}

/**
 * Orders placed per store day over the last `window` days (today included),
 * and the totals of the window before it. Cancelled orders are left out: they
 * are worth nothing to the store.
 */
export async function getOrderActivity(db: AppDb, window: ActivityWindow, now: Date = new Date()): Promise<OrderActivity> {
  const to = storeDay(now);
  const from = storeDay(now, -(window - 1));
  const previousFrom = storeDay(now, -(2 * window - 1));
  const since = new Date(Date.parse(`${previousFrom}T00:00:00.000Z`) - STORE_UTC_OFFSET_HOURS * 3_600_000).toISOString();
  const day = sql<string>`date(${orders.createdAt}, ${`+${STORE_UTC_OFFSET_HOURS} hours`})`;
  const rows = await db
    .select({ day, orders: count(), orderValue: sql<number>`coalesce(sum(${orders.price} + ${orders.deliveryFee}), 0)` })
    .from(orders)
    .where(and(gte(orders.createdAt, since), ne(orders.status, "cancelled")))
    .groupBy(day)
    .orderBy(day)
    .all();
  const days: OrderActivityDay[] = [];
  const previous = { orders: 0, orderValue: 0 };
  for (const row of rows) {
    if (row.day > to) continue;
    const entry = { date: row.day, orders: Number(row.orders), orderValue: Number(row.orderValue) };
    if (row.day >= from) days.push(entry);
    else {
      previous.orders += entry.orders;
      previous.orderValue += entry.orderValue;
    }
  }
  return { from, to, days, previous };
}
