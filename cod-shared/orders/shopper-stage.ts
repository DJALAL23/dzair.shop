/**
 * Where an order is, in the words a shopper may read. The merchant's stage
 * (`stage.ts`) says more than a shopper should see — that the customer could
 * not be reached, that a handoff is pending, that the carrier cancelled a
 * parcel the merchant may send again — so each folds into the step the
 * shopper is waiting for.
 */
import type { OrderStage } from "./stage";

export const SHOPPER_ORDER_STAGES = [
  "placed",
  "confirmed",
  "preparing",
  "shipped",
  "out_for_delivery",
  "delivered",
  "returned",
  "cancelled",
] as const;

export type ShopperOrderStage = (typeof SHOPPER_ORDER_STAGES)[number];

const SHOPPER_STAGE: Readonly<Record<OrderStage, ShopperOrderStage>> = {
  new: "placed",
  unreachable: "placed",
  confirmed: "confirmed",
  preparing: "preparing",
  ready_to_ship: "preparing",
  handoff_pending: "preparing",
  delivery_cancelled: "preparing",
  in_transit: "shipped",
  out_for_delivery: "out_for_delivery",
  delivered: "delivered",
  returning: "returned",
  returned: "returned",
  cancelled: "cancelled",
};

export function shopperOrderStage(stage: OrderStage): ShopperOrderStage {
  return SHOPPER_STAGE[stage];
}
