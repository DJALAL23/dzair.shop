/**
 * Calling a customer back: the time set on an order still waiting, and the
 * moment it comes. Each change is told to the store's integrations with the
 * write that makes it (`order.callback_scheduled`, `order.callback_cleared`),
 * and the schedule tells once when a time set has come while the order still
 * waits (`order.callback_due`).
 */

import { and, asc, eq, gt, inArray, isNull, lte, sql, type SQL } from "drizzle-orm";
import type { AppDb } from "../db/client";
import { orders } from "../db/schema";
import type { Author } from "../events/actor";
import { recordEvent } from "../events/record";
import { orderSnapshot } from "../events/snapshots";
import { WAITING_STATUSES } from "./model";

type BatchStatement = Parameters<AppDb["batch"]>[0][number];

export type CallbackChange = { ok: true } | { ok: false; reason: "not_found" | "not_waiting" };

/** How often a change loses to another one made meanwhile before it gives up. */
const CHANGE_TRIES = 3;

/**
 * Sets when to call the customer back (null clears it), on an order still
 * waiting: new, or the customer not reached. The time it replaces is the one
 * the write found, never one read before it; setting the time already set
 * changes nothing and tells nothing.
 */
export async function setCallback(db: AppDb, orderId: string, at: string | null, author: Author): Promise<CallbackChange> {
  for (let attempt = 0; attempt < CHANGE_TRIES; attempt++) {
    const current = await db.select({ status: orders.status, callbackAt: orders.callbackAt }).from(orders).where(eq(orders.id, orderId)).get();
    if (!current) return { ok: false, reason: "not_found" };
    if (!(WAITING_STATUSES as readonly string[]).includes(current.status)) return { ok: false, reason: "not_waiting" };
    if (current.callbackAt === at) return { ok: true };

    const previousAt = current.callbackAt;
    const occurredAt = new Date().toISOString();
    const claim = and(
      eq(orders.id, orderId),
      inArray(orders.status, WAITING_STATUSES),
      previousAt === null ? isNull(orders.callbackAt) : eq(orders.callbackAt, previousAt),
    );
    const event =
      at === null
        ? recordEvent(db, { type: "order.callback_cleared", subjectId: orderId, orderId, occurredAt, ...author, data: { order: orderSnapshot(orderId), previousAt: previousAt! } }, sql`changes() > 0`)
        : recordEvent(db, { type: "order.callback_scheduled", subjectId: orderId, orderId, occurredAt, ...author, data: { order: orderSnapshot(orderId), at, previousAt } }, sql`changes() > 0`);
    const [updated] = await db.batch([db.update(orders).set({ callbackAt: at }).where(claim).returning({ id: orders.id }), event]);
    if (updated.length > 0) return { ok: true };
  }
  throw new Error(`The callback of order ${orderId} kept changing while it was set`);
}

/** A time that came longer ago than this is not told: the schedule was down, and the team sees it in the list. */
export const CALLBACK_DUE_WINDOW_MS = 60 * 60_000;
/** Times told per run; the rest wait for the next run, within the window. */
export const CALLBACKS_DUE_PER_RUN = 50;

/** Whether `order.callback_due` was already told for the time now set on the order. */
const toldFor = (orderId: SQL) =>
  sql`exists (select 1 from business_events e where e.order_id = ${orderId} and e.type = 'order.callback_due' and json_extract(e.data, '$.at') = ${orders.callbackAt})`;

/**
 * Tells once each time set to call back that has come, on an order still
 * waiting and not archived. The check is made again as each event is written,
 * so two runs at once, or a time moved meanwhile, never tell it twice or
 * wrongly. Returns the orders told.
 */
export async function announceDueCallbacks(db: AppDb, now: Date, author: Author): Promise<string[]> {
  const due = await db
    .select({ id: orders.id, at: orders.callbackAt })
    .from(orders)
    .where(
      and(
        gt(orders.callbackAt, new Date(now.getTime() - CALLBACK_DUE_WINDOW_MS).toISOString()),
        lte(orders.callbackAt, now.toISOString()),
        inArray(orders.status, WAITING_STATUSES),
        isNull(orders.archivedAt),
        sql`not ${toldFor(sql`${orders.id}`)}`,
      ),
    )
    .orderBy(asc(orders.callbackAt), asc(orders.id))
    .limit(CALLBACKS_DUE_PER_RUN)
    .all();
  if (due.length === 0) return [];

  const statements = due.map(({ id, at }) => {
    const stillDue = sql`exists (select 1 from ${orders} where ${orders.id} = ${id} and ${orders.callbackAt} = ${at} and ${inArray(orders.status, WAITING_STATUSES)} and ${orders.archivedAt} is null and not ${toldFor(sql`${id}`)})`;
    return recordEvent(db, { type: "order.callback_due", subjectId: id, orderId: id, occurredAt: at!, ...author, data: { order: orderSnapshot(id), at: at! } }, stillDue);
  });
  await db.batch(statements as [BatchStatement, ...BatchStatement[]]);
  return due.map(({ id }) => id);
}
