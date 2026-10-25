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
import { orderHasShipment, refusalFor } from "./refusals";
import { transitionVerdict } from "./transitions";
import { getOrderShipment } from "../../../../cod-shared/shipments/queries";
import { logActivity, ACTIONS } from "@/lib/activity";
import { NotFoundError, ValidationError } from "@/lib/errors/classes";
import { ERROR_CODES, ERROR_CATEGORIES } from "../../../../cod-shared/errors/codes";

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

  const verdict = transitionVerdict(order.status, Boolean(await getOrderShipment(db, orderId)), validated.status);
  if (!verdict.ok) {
    if (verdict.code === ERROR_CODES.ORDER_HAS_SHIPMENT) throw orderHasShipment(orderId, "its status no longer changes");
    return c.json({
      error: `Cannot transition from "${order.status}" to "${validated.status}"`,
      code: ERROR_CODES.INVALID_STATUS_TRANSITION,
      category: ERROR_CATEGORIES.BUSINESS_LOGIC,
      context: {
        currentStatus: order.status,
        targetStatus: validated.status,
        allowedTransitions: verdict.allowed,
      },
    }, 400);
  }

  // Get user from context (set by auth middleware)
  const user = c.get("user");

  const change = await queries.updateOrderStatus(db, orderId, validated.status, c.get("author"));
  if (!change.ok) throw refusalFor(change, orderId, "its status no longer changes");

  await logActivity(db, user, ACTIONS.ORDER_STATUS_CHANGED, {
    type: "order", id: orderId,
  }, { from: order.status, to: validated.status });

  return c.json({
    success: true,
    message: "Order status updated",
  }, 200);
}

