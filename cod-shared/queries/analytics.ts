/**
 * Analytics Queries
 *
 * Read-only queries for the dashboard and reporting endpoints, each one
 * database round-trip with no client-side aggregation.
 */

import { count, eq, sql } from "drizzle-orm";
import type { AppDb } from "../db/client";
import { orders, shipments, type OrderStatus } from "../db/schema";
import type { OrderStage } from "../orders/stage";
import { orderNeedsAttentionSql, orderStageSql } from "../orders/stage-sql";

export interface OrderStatusStat {
  status: OrderStatus;
  count: number;
}

/**
 * Returns the count of orders grouped by status in a single query.
 * Only statuses that have at least one order are returned.
 * The caller is responsible for filling in zeros for absent statuses.
 */
export async function getOrderStatusStats(db: AppDb): Promise<OrderStatusStat[]> {
  const rows = await db
    .select({
      status: orders.status,
      count: sql<number>`count(*)`,
    })
    .from(orders)
    .groupBy(orders.status)
    .all();

  return rows.map((r) => ({ status: r.status, count: Number(r.count) }));
}

export interface OrderStageStats {
  /** Orders per stage; only stages with at least one order. */
  stages: Array<{ stage: OrderStage; count: number }>;
  /** Orders whose delivery needs the merchant, whatever their stage. */
  needsAttention: number;
}

/** Orders counted by the stage the merchant sees, and how many need attention. */
export async function getOrderStageStats(db: AppDb): Promise<OrderStageStats> {
  const stage = orderStageSql();
  const rows = await db
    .select({ stage, count: count(), attention: sql<number>`sum(${orderNeedsAttentionSql()})` })
    .from(orders)
    .leftJoin(shipments, eq(shipments.orderId, orders.id))
    .groupBy(stage)
    .all();
  return {
    stages: rows.map((r) => ({ stage: r.stage, count: Number(r.count) })),
    needsAttention: rows.reduce((sum, r) => sum + Number(r.attention ?? 0), 0),
  };
}
