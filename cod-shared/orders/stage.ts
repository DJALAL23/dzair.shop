/**
 * Order Stage — the one label a merchant sees for an order.
 *
 * Derived from the order's processing status and its shipment's milestones;
 * never stored and never written. Write paths decide with `lifecycle.ts` and
 * the shipment's facts, not with the stage, so the stage can only ever
 * describe — it cannot become a second source of truth.
 */

import type { DeliveryFacts } from "../shipments/interpretation";
import type { HandoffState } from "../shipments/model";
import type { OrderStatus } from "./lifecycle";

export const ORDER_STAGES = [
  "new",
  "confirmed",
  "unreachable",
  "preparing",
  "ready_to_ship",
  "handoff_pending",
  "in_transit",
  "out_for_delivery",
  "delivered",
  "returning",
  "returned",
  "delivery_cancelled",
  "cancelled",
] as const;

export type OrderStage = (typeof ORDER_STAGES)[number];

/**
 * Where an order's story has ended: cancelled before delivery, or its
 * shipment delivered, returned or cancelled at the carrier. Only a finished
 * order can be archived (cod-shared/queries/orders.ts `archiveOrder`).
 */
export const FINISHED_STAGES = ["delivered", "returned", "delivery_cancelled", "cancelled"] as const satisfies readonly OrderStage[];

export function isFinishedStage(stage: OrderStage): boolean {
  return (FINISHED_STAGES as readonly OrderStage[]).includes(stage);
}

export type StageShipment = Pick<
  DeliveryFacts,
  "outForDeliveryAt" | "deliveredAt" | "returnStartedAt" | "returnedAt" | "cancelledAt" | "attentionSince"
> & { handoffState: HandoffState };

export function orderStage(status: OrderStatus, shipment: StageShipment | null): OrderStage {
  if (status === "cancelled") return "cancelled";
  if (shipment === null) return status === "ready" ? "ready_to_ship" : status;
  if (shipment.handoffState !== "accepted") return "handoff_pending";
  if (shipment.returnedAt !== null) return "returned";
  if (shipment.deliveredAt !== null) return "delivered";
  if (shipment.cancelledAt !== null) return "delivery_cancelled";
  if (shipment.returnStartedAt !== null) return "returning";
  if (shipment.outForDeliveryAt !== null) return "out_for_delivery";
  return "in_transit";
}

/**
 * Whether the merchant must act on this order's delivery: the carrier flagged
 * the parcel, the handoff outcome is unknown, or the carrier cancelled it and
 * the merchant must re-send it or cancel the order.
 */
export function orderNeedsAttention(shipment: StageShipment | null): boolean {
  if (shipment === null) return false;
  if (shipment.handoffState === "unknown") return true;
  if (shipment.cancelledAt !== null) return true;
  return shipment.attentionSince !== null;
}
