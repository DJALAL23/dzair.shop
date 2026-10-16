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

export const ACTIVITY_WINDOWS = [7, 30, 90] as const;
export type ActivityWindow = (typeof ACTIVITY_WINDOWS)[number];

export interface ActivityDay {
  date: string;
  orders: number;
  sales: number;
}

/** Orders placed per store day, as the server sends them: only days with orders. */
export interface OrderActivity {
  from: string;
  to: string;
  days: ActivityDay[];
  previous: { orders: number; sales: number };
}

export interface ActivitySummary {
  /** Every day of the window, oldest first; a day without orders is zero. */
  days: ActivityDay[];
  orders: number;
  sales: number;
  /** Sales per order; null with no orders. */
  average: number | null;
  /** Percent change against the window before; null when that window was empty. */
  change: { orders: number | null; sales: number | null; average: number | null };
}

function percentChange(current: number, previous: number): number | null {
  return previous === 0 ? null : Math.round(((current - previous) / previous) * 100);
}

/** The window day by day, its totals, and how it compares with the window before. */
export function summarizeActivity(activity: OrderActivity): ActivitySummary {
  const byDate = new Map(activity.days.map((day) => [day.date, day]));
  const days: ActivityDay[] = [];
  for (let cursor = new Date(`${activity.from}T00:00:00Z`); cursor.toISOString().slice(0, 10) <= activity.to; cursor = new Date(cursor.getTime() + 86_400_000)) {
    const date = cursor.toISOString().slice(0, 10);
    days.push(byDate.get(date) ?? { date, orders: 0, sales: 0 });
  }
  const orders = days.reduce((sum, day) => sum + day.orders, 0);
  const sales = days.reduce((sum, day) => sum + day.sales, 0);
  const average = orders === 0 ? null : Math.round(sales / orders);
  const previousAverage = activity.previous.orders === 0 ? 0 : activity.previous.sales / activity.previous.orders;
  return {
    days,
    orders,
    sales,
    average,
    change: {
      orders: percentChange(orders, activity.previous.orders),
      sales: percentChange(sales, activity.previous.sales),
      average: average === null ? null : percentChange(average, previousAverage),
    },
  };
}
