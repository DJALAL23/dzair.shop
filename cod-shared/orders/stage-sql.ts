/**
 * The order's stage and attention flag in SQL, for reads that filter, sort or
 * count by them (the order list, analytics). They are `orderStage` and
 * `orderNeedsAttention` (stage.ts) written for the database, and must say
 * the same for every order — a test checks every combination against them.
 *
 * Both read the order's shipment, so the query must left join `shipments`
 * on `shipments.order_id = orders.id`.
 */

import { sql, type SQL } from "drizzle-orm";
import { orders, shipments } from "../db/schema";
import type { OrderStage } from "./stage";

/** The order's stage. */
export function orderStageSql(): SQL<OrderStage> {
  return sql<OrderStage>`case
    when ${orders.status} = 'cancelled' then 'cancelled'
    when ${shipments.id} is null then case when ${orders.status} = 'ready' then 'ready_to_ship' else ${orders.status} end
    when ${shipments.handoffState} <> 'accepted' then 'handoff_pending'
    when ${shipments.returnedAt} is not null then 'returned'
    when ${shipments.deliveredAt} is not null then 'delivered'
    when ${shipments.cancelledAt} is not null then 'delivery_cancelled'
    when ${shipments.returnStartedAt} is not null then 'returning'
    when ${shipments.outForDeliveryAt} is not null then 'out_for_delivery'
    else 'in_transit'
  end`;
}

/** Whether the merchant must act on the order's delivery. */
export function orderNeedsAttentionSql(): SQL<boolean> {
  return sql<boolean>`(${shipments.id} is not null and (${shipments.handoffState} = 'unknown' or ${shipments.cancelledAt} is not null or ${shipments.attentionSince} is not null))`.mapWith(
    (v) => Boolean(Number(v)),
  );
}
