/**
 * Conversions — the one place that starts a Meta CAPI workflow.
 *
 * Business events decide when: an order confirmed by the call centre, a
 * checkout, a parcel delivered — or out for delivery for a long-haul wilaya,
 * whose delivery would land past Meta's 7-day window. Whether the store
 * actually sends the event is the workflow's to decide (tracking enabled,
 * the merchant's conversion choice). A workflow id is derived from the order,
 * stage and event, so scheduling the same conversion twice starts it once.
 */

import { inArray } from "drizzle-orm";
import type { AppDb } from "@/db";
import { orders } from "@/db/schema";
import type { Env } from "@/types";
import { getCapiWorkflowId, shouldTriggerCapiPurchase, type ConversionStage, type MetaEventName } from "@/workflows/capi-helpers";
import type { ShipmentBusinessEvent } from "../../../cod-shared/shipments/record-events";

export type WaitUntil = (promise: Promise<unknown>) => void;

export interface CapiTrigger {
  orderId: string;
  eventName: MetaEventName;
  stage: ConversionStage;
  /** What caused it, for the workflow's log. */
  trigger: string;
  eventSourceUrl?: string;
}

/** Start the CAPI workflow for one conversion; never throws, never blocks the caller. */
export function startCapiWorkflow(env: Pick<Env, "CAPI_WORKFLOW">, waitUntil: WaitUntil, conversion: CapiTrigger): void {
  if (!env.CAPI_WORKFLOW) {
    console.error("[conversions] CAPI_WORKFLOW binding is missing — the worker needs re-provisioning");
    return;
  }
  waitUntil(
    env.CAPI_WORKFLOW.create({
      id: getCapiWorkflowId(conversion.orderId, conversion.stage, conversion.eventName),
      params: {
        orderId: conversion.orderId,
        eventName: conversion.eventName,
        stage: conversion.stage,
        triggeredAt: Math.floor(Date.now() / 1000),
        triggerStatus: conversion.trigger,
        ...(conversion.eventSourceUrl ? { eventSourceUrl: conversion.eventSourceUrl } : {}),
      },
    }).catch((error: unknown) => console.error(`[conversions] ${conversion.stage} ${conversion.eventName} for order ${conversion.orderId} not started:`, (error as Error)?.message)),
  );
}

/**
 * The conversions recorded shipment facts call for: a delivery, or reaching
 * the final mile in a long-haul wilaya. Returns the orders scheduled.
 */
export async function scheduleShipmentConversions(
  env: Pick<Env, "CAPI_WORKFLOW">,
  waitUntil: WaitUntil,
  db: AppDb,
  events: readonly ShipmentBusinessEvent[],
): Promise<string[]> {
  const relevant = events.filter((e) => e.type === "ShipmentDelivered" || e.type === "ShipmentOutForDelivery");
  if (relevant.length === 0) return [];
  const orderIds = [...new Set(relevant.map((e) => e.orderId))];
  const wilayas = new Map(
    (await db.select({ id: orders.id, wilayaId: orders.wilayaId }).from(orders).where(inArray(orders.id, orderIds)).all()).map((o) => [o.id, o.wilayaId]),
  );
  const scheduled: string[] = [];
  for (const orderId of orderIds) {
    const mine = relevant.filter((e) => e.orderId === orderId);
    const delivered = mine.some((e) => e.type === "ShipmentDelivered");
    const longHaulFinalMile = mine.some((e) => e.type === "ShipmentOutForDelivery") && shouldTriggerCapiPurchase("out_for_delivery", wilayas.get(orderId));
    if (!delivered && !longHaulFinalMile) continue;
    startCapiWorkflow(env, waitUntil, { orderId, eventName: "Purchase", stage: "delivered", trigger: delivered ? "delivered" : "out_for_delivery" });
    scheduled.push(orderId);
  }
  return scheduled;
}

/** The conversions an order status change calls for (the call centre confirming; a legacy delivery). */
export function scheduleStatusConversion(
  env: Pick<Env, "CAPI_WORKFLOW">,
  waitUntil: WaitUntil,
  order: { id: string; wilayaId: number | null },
  status: string,
): boolean {
  if (status === "confirmed") {
    startCapiWorkflow(env, waitUntil, { orderId: order.id, eventName: "Purchase", stage: "confirmed", trigger: "confirmed" });
    return true;
  }
  if (!shouldTriggerCapiPurchase(status, order.wilayaId)) return false;
  startCapiWorkflow(env, waitUntil, { orderId: order.id, eventName: "Purchase", stage: "delivered", trigger: status });
  return true;
}
