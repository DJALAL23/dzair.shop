/**
 * Analytics Handlers
 *
 * HTTP handlers for the /api/analytics/* routes.
 */

import type { Context } from "hono";
import type { AppContext } from "@/types";
import { getDb } from "@/db";
import { getOrderStageStats, getOrderStatusStats } from "../../../../cod-shared/queries/analytics";

/**
 * GET /api/analytics/dashboard-stats
 * Returns order counts grouped by status in a single optimized query.
 */
export async function getDashboardStats(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const data = await getOrderStatusStats(db);
  return c.json({ success: true, data }, 200);
}

/**
 * GET /api/analytics/order-stages
 * Orders counted by stage, and how many need the merchant's attention.
 */
export async function getOrderStages(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  return c.json({ success: true, data: await getOrderStageStats(db) }, 200);
}
