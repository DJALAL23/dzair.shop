/**
 * Orders Status Transitions
 *
 * Handles order status updates and their workflow guard.
 */

import { Context } from "hono";
import type { AppContext } from "@/types";
import { getDb } from "@/db";
import * as queries from "./queries";
import * as validation from "./validation";
import { refusalFor } from "./refusals";
import { logActivity, ACTIONS } from "@/lib/activity";
import { NotFoundError, ValidationError } from "@/lib/errors/classes";
import { ERROR_CODES, ERROR_CATEGORIES } from "../../../../cod-shared/errors/codes";
import { scheduleStatusConversion } from "@/lib/conversions";

/**
 * PATCH /orders/:id/status
 * Update order status
 */
export async function updateStatus(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const orderId = c.req.param("id");
  
  if (!orderId) {
    throw new ValidationError("Order ID is required", ERROR_CODES.REQUIRED_FIELD_MISSING);
  }
  
  const body = await c.req.json();
  
  const bodyData: any = (c.req as any).valid?.("json");

  // Validate request body
  const validated = bodyData ?? validation.updateOrderStatusSchema.parse(body);

  // Check if order exists
  const order = await queries.getOrderById(db, orderId);
  if (!order) {
    throw new NotFoundError("Order", orderId);
  }

  // Guard: enforce valid forward transitions — prevents backward moves and invalid jumps
  const ALLOWED_TRANSITIONS: Record<string, string[]> = {
    new:              ["confirmed", "unreachable", "cancelled"],
    confirmed:        ["preparing", "unreachable", "cancelled"],
    unreachable:      ["confirmed", "cancelled"],
    preparing:        ["ready", "cancelled"],
    ready:            ["out_for_delivery", "dispatched", "cancelled"],
    assigned:         ["out_for_delivery", "dispatched", "cancelled"],
    dispatched:       ["out_for_delivery", "cancelled"],
    out_for_delivery: ["delivered", "returned"],
    delivered:        [],
    returned:         [],
    cancelled:        [],
  };

  const allowed = ALLOWED_TRANSITIONS[order.status] ?? [];
  if (!allowed.includes(validated.status)) {
    return c.json({
      error: `Cannot transition from "${order.status}" to "${validated.status}"`,
      code: "INVALID_STATUS_TRANSITION",
      category: ERROR_CATEGORIES.BUSINESS_LOGIC,
      context: {
        currentStatus:     order.status,
        targetStatus:      validated.status,
        allowedTransitions: allowed,
      },
    }, 400);
  }

  // Get user from context (set by auth middleware)
  const user = c.get("user");

  const change = await queries.updateOrderStatus(db, orderId, validated.status, user?.id, user?.name ?? undefined);
  if (!change.ok) throw refusalFor(change, orderId, "its status no longer changes");

  // Never blocks the response; the runtime keeps the start alive with waitUntil.
  scheduleStatusConversion(c.env, (p) => c.executionCtx.waitUntil(p), { id: orderId, wilayaId: order.wilayaId }, validated.status);

  await logActivity(db, user, ACTIONS.ORDER_STATUS_CHANGED, {
    type: "order", id: orderId,
  }, { from: order.status, to: validated.status });

  return c.json({
    success: true,
    message: "Order status updated",
  }, 200);
}

