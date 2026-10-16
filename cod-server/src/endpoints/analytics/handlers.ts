/**
 * Analytics Handlers
 *
 * HTTP handlers for the /api/analytics/* routes.
 */

import type { Context } from "hono";
import type { AppContext } from "@/types";
import { getDb } from "@/db";
import { getOrderActivity, getOrderStageStats, type ActivityWindow } from "../../../../cod-shared/queries/analytics";

/**
 * GET /api/analytics/order-stages
 * Orders counted by stage, and how many need the merchant's attention.
 */
export async function getOrderStages(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  return c.json({ success: true, data: await getOrderStageStats(db) }, 200);
}

/**
 * GET /api/analytics/order-activity
 * Orders placed per store day over a window, and the window before it.
 */
export async function getOrderActivityStats(c: Context<AppContext>) {
  const { days } = (c.req as unknown as { valid: (target: "query") => { days: ActivityWindow } }).valid("query");
  const db = getDb(c.env.DB);
  return c.json({ success: true, data: await getOrderActivity(db, days) }, 200);
}
