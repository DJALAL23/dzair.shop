/**
 * Consumers and their Deliveries as the merchant sees and steers them
 * (Events context): who receives the store's Business Events, how each
 * Delivery went, and the merchant's word — stop, start again, Replay. A
 * Signing Secret and a kind's own settings never leave this module: they may
 * hold credentials.
 */

import { and, desc, eq, lt, sql, type SQL } from "drizzle-orm";
import type { AppDb } from "../db/client";
import { businessEvents, eventConsumers, eventDeliveries, eventDeliveryAttempts } from "../db/schema";
import type { EventType } from "./catalogue";
import { reopenDeliveries } from "./deliveries";
import type { AttemptOutcomeKind, ConsumerDisabledReason, DeliveryState } from "./deliveries-model";
import { readSubscription, type SubscriptionPattern } from "./subscription";

export interface ConsumerView {
  id: string;
  kind: string;
  name: string;
  enabled: boolean;
  subscription: SubscriptionPattern[];
  catalogueVersion: number;
  /** Why it stopped receiving, while it is disabled. */
  disabledReason: ConsumerDisabledReason | null;
  /** Since when every Attempt has failed; null once one succeeds. */
  failingSince: string | null;
  /** Deliveries on their way, and Dead ones waiting for a Replay. */
  deliveries: { due: number; dead: number };
  createdAt: string;
  updatedAt: string;
}

const consumerView = {
  id: eventConsumers.id,
  kind: eventConsumers.kind,
  name: eventConsumers.name,
  enabled: eventConsumers.enabled,
  subscription: eventConsumers.subscription,
  catalogueVersion: eventConsumers.catalogueVersion,
  disabledReason: eventConsumers.disabledReason,
  failingSince: eventConsumers.failingSince,
  due: sql<number>`(select count(*) from event_deliveries d where d.consumer_id = event_consumers.id and d.state = 'due')`,
  dead: sql<number>`(select count(*) from event_deliveries d where d.consumer_id = event_consumers.id and d.state = 'dead')`,
  createdAt: eventConsumers.createdAt,
  updatedAt: eventConsumers.updatedAt,
};

function toConsumerView({ due, dead, subscription, ...row }: { due: number; dead: number; subscription: string } & Omit<ConsumerView, "deliveries" | "subscription">): ConsumerView {
  return { ...row, subscription: readSubscription(subscription), deliveries: { due, dead } };
}

export async function listConsumers(db: AppDb): Promise<ConsumerView[]> {
  return (await db.select(consumerView).from(eventConsumers).orderBy(eventConsumers.createdAt, eventConsumers.id).all()).map(toConsumerView);
}

export async function readConsumer(db: AppDb, id: string): Promise<ConsumerView | null> {
  const row = await db.select(consumerView).from(eventConsumers).where(eq(eventConsumers.id, id)).get();
  return row ? toConsumerView(row) : null;
}

/**
 * Start or stop delivering to a Consumer. Starting again clears why it
 * stopped and its failing streak; what was recorded meanwhile reaches it only
 * through a Replay. Stopping settles its waiting Deliveries as skipped as the
 * drain meets them.
 */
export async function setConsumerEnabled(db: AppDb, id: string, enabled: boolean, now: Date): Promise<ConsumerView | null> {
  const changed = await db
    .update(eventConsumers)
    .set(enabled ? { enabled, disabledReason: null, failingSince: null, updatedAt: now.toISOString() } : { enabled, disabledReason: "merchant", updatedAt: now.toISOString() })
    .where(eq(eventConsumers.id, id))
    .returning({ id: eventConsumers.id });
  return changed.length ? readConsumer(db, id) : null;
}

export type Redelivery =
  | { ok: true; reopened: number; created: number }
  | { ok: false; reason: "not_found" | "consumer_disabled" | "already_due" };

/** Replay the Business Events of a Sequence range to one Consumer: those it subscribes to now. */
export async function replayToConsumer(db: AppDb, consumerId: string, range: { fromSequence: number; toSequence: number }, now: Date): Promise<Redelivery> {
  const consumer = await db.select().from(eventConsumers).where(eq(eventConsumers.id, consumerId)).get();
  if (!consumer) return { ok: false, reason: "not_found" };
  if (!consumer.enabled) return { ok: false, reason: "consumer_disabled" };
  return { ok: true, ...(await reopenDeliveries(db, consumer, range, now)) };
}

/** Try one settled Delivery again. */
export async function retryDelivery(db: AppDb, deliveryId: string, now: Date): Promise<Redelivery> {
  const row = await db
    .select({ consumer: eventConsumers, state: eventDeliveries.state })
    .from(eventDeliveries)
    .innerJoin(eventConsumers, eq(eventConsumers.id, eventDeliveries.consumerId))
    .where(eq(eventDeliveries.id, deliveryId))
    .get();
  if (!row) return { ok: false, reason: "not_found" };
  if (!row.consumer.enabled) return { ok: false, reason: "consumer_disabled" };
  if (row.state === "due") return { ok: false, reason: "already_due" };
  const result = await reopenDeliveries(db, row.consumer, { deliveryId }, now);
  return result.reopened ? { ok: true, ...result } : { ok: false, reason: "already_due" };
}

export interface DeliveryView {
  id: string;
  consumerId: string;
  state: DeliveryState;
  /** Attempts since it was last made due — a Replay starts them over. */
  attempts: number;
  nextAttemptAt: string | null;
  lastError: string | null;
  createdAt: string;
  settledAt: string | null;
  event: { id: string; sequence: number; type: EventType; orderId: string; occurredAt: string };
}

export interface AttemptView {
  attempt: number;
  attemptedAt: string;
  durationMs: number;
  outcome: AttemptOutcomeKind;
  httpStatus: number | null;
  responseExcerpt: string | null;
  error: string | null;
}

const deliveryView = {
  id: eventDeliveries.id,
  consumerId: eventDeliveries.consumerId,
  state: eventDeliveries.state,
  attempts: eventDeliveries.attempts,
  nextAttemptAt: eventDeliveries.nextAttemptAt,
  lastError: eventDeliveries.lastError,
  createdAt: eventDeliveries.createdAt,
  settledAt: eventDeliveries.settledAt,
  eventId: businessEvents.id,
  sequence: businessEvents.seq,
  type: businessEvents.type,
  orderId: businessEvents.orderId,
  occurredAt: businessEvents.occurredAt,
};

type DeliveryRow = Omit<DeliveryView, "event"> & { eventId: string; sequence: number; type: EventType; orderId: string; occurredAt: string };

function toDeliveryView({ eventId, sequence, type, orderId, occurredAt, ...delivery }: DeliveryRow): DeliveryView {
  return { ...delivery, event: { id: eventId, sequence, type, orderId, occurredAt } };
}

export const DELIVERY_PAGE_MAX = 100;

/**
 * A Consumer's Deliveries, newest event first, paged `before` an event's
 * Sequence; or every Delivery of one Business Event. Narrowed by state.
 */
export async function listDeliveries(
  db: AppDb,
  query: ({ consumerId: string; eventId?: undefined } | { eventId: string; consumerId?: undefined }) & { state?: DeliveryState; before?: number; limit: number },
): Promise<{ deliveries: DeliveryView[]; next: number | null }> {
  const limit = Math.min(Math.max(1, Math.trunc(query.limit)), DELIVERY_PAGE_MAX);
  const where: SQL[] = [query.consumerId !== undefined ? eq(eventDeliveries.consumerId, query.consumerId) : eq(businessEvents.id, query.eventId)];
  if (query.state) where.push(eq(eventDeliveries.state, query.state));
  if (query.before !== undefined) where.push(lt(businessEvents.seq, query.before));
  const rows = await db
    .select(deliveryView)
    .from(eventDeliveries)
    .innerJoin(businessEvents, eq(businessEvents.seq, eventDeliveries.eventSeq))
    .where(and(...where))
    .orderBy(desc(businessEvents.seq), eventDeliveries.consumerId)
    .limit(limit + 1)
    .all();
  const page = rows.slice(0, limit);
  return { deliveries: page.map(toDeliveryView), next: rows.length > limit ? page.at(-1)!.sequence : null };
}

/** One Delivery with every Attempt it took, oldest first. */
export async function readDelivery(db: AppDb, id: string): Promise<(DeliveryView & { attemptLog: AttemptView[] }) | null> {
  const row = await db.select(deliveryView).from(eventDeliveries).innerJoin(businessEvents, eq(businessEvents.seq, eventDeliveries.eventSeq)).where(eq(eventDeliveries.id, id)).get();
  if (!row) return null;
  const attemptLog = await db
    .select({
      attempt: eventDeliveryAttempts.attempt,
      attemptedAt: eventDeliveryAttempts.attemptedAt,
      durationMs: eventDeliveryAttempts.durationMs,
      outcome: eventDeliveryAttempts.outcome,
      httpStatus: eventDeliveryAttempts.httpStatus,
      responseExcerpt: eventDeliveryAttempts.responseExcerpt,
      error: eventDeliveryAttempts.error,
    })
    .from(eventDeliveryAttempts)
    .where(eq(eventDeliveryAttempts.deliveryId, id))
    .orderBy(eventDeliveryAttempts.attemptedAt, eventDeliveryAttempts.id)
    .all();
  return { ...toDeliveryView(row), attemptLog };
}
