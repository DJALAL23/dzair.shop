import { ORDER_QUEUES, viewCounts, type QueueKey } from "@/features/orders/model";
import type { OrderStageCounts } from "@/features/orders/types";

export interface QueueShare {
  key: QueueKey;
  count: number;
  /** Of all orders, rounded to a whole percent. */
  share: number;
}

/** Every work queue with its orders, in the order of the merchant's day. */
export function queueBreakdown(counts: OrderStageCounts): QueueShare[] {
  const views = viewCounts(counts);
  return ORDER_QUEUES.map(({ key }) => ({ key, count: views[key], share: views.all === 0 ? 0 : Math.round((views[key] / views.all) * 100) }));
}

/**
 * Of the parcels that reached their customer, the share delivered — refused
 * ones count against it, those still on the way do not count yet. Null
 * before any parcel reached anyone.
 */
export function deliverySuccessRate(counts: OrderStageCounts): number | null {
  const byStage = new Map(counts.stages.map((entry) => [entry.stage, entry.count]));
  const delivered = byStage.get("delivered") ?? 0;
  const refused = (byStage.get("returning") ?? 0) + (byStage.get("returned") ?? 0);
  return delivered + refused === 0 ? null : Math.round((delivered / (delivered + refused)) * 100);
}
