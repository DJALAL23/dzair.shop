/**
 * Analytics Handlers
 *
 * HTTP handlers for the /api/analytics/* routes.
 */

import type { Context } from "hono";
import type { AppContext } from "@/types";
import { getDb } from "@/db";
import { getOrderStageStats } from "../../../../cod-shared/queries/analytics";

/**
 * GET /api/analytics/order-stages
 * Orders counted by stage, and how many need the merchant's attention.
 */
export async function getOrderStages(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  return c.json({ success: true, data: await getOrderStageStats(db) }, 200);
}
