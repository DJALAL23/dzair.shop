import { ORDER_QUEUES, viewCounts, type QueueKey } from "@/features/orders/model";
import type { OrderStage, OrderStageCounts } from "@/features/orders/types";

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

/** The orders at one stage; a stage absent from the counts has none. */
export function stageCount(counts: OrderStageCounts, stage: OrderStage): number {
  return counts.stages.find((entry) => entry.stage === stage)?.count ?? 0;
}

export const ACTIVITY_WINDOWS = [7, 30, 90] as const;
export type ActivityWindow = (typeof ACTIVITY_WINDOWS)[number];

export interface ActivityDay {
  date: string;
  orders: number;
  orderValue: number;
}

/** Orders placed per store day, as the server sends them: only days with orders. */
export interface OrderActivity {
  from: string;
  to: string;
  days: ActivityDay[];
  previous: { orders: number; orderValue: number };
}

export interface ActivitySummary {
  /** Every day of the window, oldest first; a day without orders is zero. */
  days: ActivityDay[];
  orders: number;
  orderValue: number;
  /** Sales per order; null with no orders. */
  average: number | null;
  /** Percent change against the window before; null when that window was empty. */
  change: { orders: number | null; orderValue: number | null; average: number | null };
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
    days.push(byDate.get(date) ?? { date, orders: 0, orderValue: 0 });
  }
  const orders = days.reduce((sum, day) => sum + day.orders, 0);
  const orderValue = days.reduce((sum, day) => sum + day.orderValue, 0);
  const average = orders === 0 ? null : Math.round(orderValue / orders);
  const previousAverage = activity.previous.orders === 0 ? 0 : activity.previous.orderValue / activity.previous.orders;
  return {
    days,
    orders,
    orderValue,
    average,
    change: {
      orders: percentChange(orders, activity.previous.orders),
      orderValue: percentChange(orderValue, activity.previous.orderValue),
      average: average === null ? null : percentChange(average, previousAverage),
    },
  };
}
