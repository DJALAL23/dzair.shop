/**
 * Order lifecycle — the one definition of how an order's processing moves.
 *
 * An order owns processing only: confirming with the customer, packing, and
 * becoming ready. Delivery belongs to its shipment (ADR 0006), so no delivery
 * word appears here. Once an order has a shipment its processing is finished:
 * it stays `ready` and accepts no further status change — cancelling it first
 * requires voiding the shipment, so a parcel at a carrier is never orphaned.
 *
 * Pure: the server, the MCP tools and the dashboard all decide with these
 * functions, so the three can never disagree about what is allowed.
 */

import { ERROR_CODES } from "../errors/codes";

export const ORDER_STATUSES = [
  "new",
  "confirmed",
  "unreachable",
  "preparing",
  "ready",
  "cancelled",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

const TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  new: ["confirmed", "unreachable", "cancelled"],
  confirmed: ["preparing", "ready", "unreachable", "cancelled"],
  unreachable: ["confirmed", "cancelled"],
  preparing: ["ready", "cancelled"],
  ready: ["cancelled"],
  cancelled: [],
};

/** What the lifecycle needs to know about an order. */
export interface OrderFacts {
  status: OrderStatus;
  hasShipment: boolean;
}

export type LifecycleRefusal =
  | {
      ok: false;
      code: typeof ERROR_CODES.INVALID_STATUS_TRANSITION;
      from: OrderStatus;
      to: OrderStatus;
      allowed: readonly OrderStatus[];
    }
  | { ok: false; code: typeof ERROR_CODES.ORDER_HAS_SHIPMENT }
  | { ok: false; code: typeof ERROR_CODES.ORDER_NOT_READY_FOR_HANDOFF; status: OrderStatus };

export type LifecycleVerdict = { ok: true } | LifecycleRefusal;

export function isOrderStatus(value: unknown): value is OrderStatus {
  return typeof value === "string" && (ORDER_STATUSES as readonly string[]).includes(value);
}

/** The statuses this order may move to now. Empty once it has a shipment. */
export function allowedTransitions(order: OrderFacts): readonly OrderStatus[] {
  return order.hasShipment ? [] : TRANSITIONS[order.status];
}

export function checkTransition(order: OrderFacts, to: OrderStatus): LifecycleVerdict {
  if (order.hasShipment) return { ok: false, code: ERROR_CODES.ORDER_HAS_SHIPMENT };
  const allowed = TRANSITIONS[order.status];
  if (!allowed.includes(to)) {
    return { ok: false, code: ERROR_CODES.INVALID_STATUS_TRANSITION, from: order.status, to, allowed };
  }
  return { ok: true };
}

/** Handoff (carrier dispatch or driver assignment) needs a ready order with no shipment. */
export function checkHandoff(order: OrderFacts): LifecycleVerdict {
  if (order.hasShipment) return { ok: false, code: ERROR_CODES.ORDER_HAS_SHIPMENT };
  if (order.status !== "ready") {
    return { ok: false, code: ERROR_CODES.ORDER_NOT_READY_FOR_HANDOFF, status: order.status };
  }
  return { ok: true };
}

/**
 * Whether the customer's delivery details (address, wilaya, commune, phone,
 * delivery type, desk) may still be edited on the order. After handoff the
 * parcel carries them; changing them goes through the shipment.
 */
export function checkDeliveryDetailsEdit(order: OrderFacts): LifecycleVerdict {
  if (order.hasShipment) return { ok: false, code: ERROR_CODES.ORDER_HAS_SHIPMENT };
  return { ok: true };
}
