/**
 * The delivery ledger (ADR 0017): Business Events fanned out into one
 * Delivery per Consumer that asked for them, each claimed, attempted and
 * settled here, in the store's D1. Every write is guarded so two drains at
 * once, or the same wake delivered twice, change nothing twice.
 */

import { and, asc, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import type { AppDb } from "../db/client";
import { businessEvents, eventConsumers, eventDeliveries, eventDeliveryAttempts } from "../db/schema";
import { retrySchedule } from "../lib/retry-schedule";
import type { AttemptOutcomeKind, DeliveryState } from "./deliveries-model";
import { toBusinessEvent, type BusinessEvent } from "./log";
import { readSubscription, subscribesTo } from "./subscription";

type BatchStatement = Parameters<AppDb["batch"]>[0][number];

/** Waits after each failed Attempt (minutes): eight Attempts over about three days, then a Dead Delivery. */
export const DELIVERY_RETRIES = retrySchedule([5, 30, 120, 360, 720, 1440, 1440]);
/** How long a claim holds before another drain may take the Delivery. */
export const DELIVERY_LEASE_MS = 5 * 60_000;
/** A Consumer whose every Attempt has failed this long stops receiving. */
export const FAILING_DISABLES_AFTER_MS = 3 * 24 * 60 * 60_000;
/** Settled Deliveries are kept this long; Dead ones stay with their event. */
export const SETTLED_KEPT_MS = 30 * 24 * 60 * 60_000;
/** Business Events are kept this long, once nothing is still on its way. */
export const EVENTS_KEPT_MS = 90 * 24 * 60 * 60_000;
/** The most of a Consumer's answer an Attempt keeps. */
const EXCERPT_CHARS = 1000;

const changes = (result: unknown) => (result as { meta?: { changes?: number } }).meta?.changes ?? 0;
const before = (now: Date, ms: number) => new Date(now.getTime() - ms).toISOString();

export type ConsumerRow = typeof eventConsumers.$inferSelect;

export interface ClaimedDelivery {
  id: string;
  /** This Attempt's number, counting from 1. */
  attempt: number;
  event: BusinessEvent;
  consumer: ConsumerRow;
}

export type AttemptOutcome =
  | { kind: "delivered"; httpStatus?: number; response?: string }
  | { kind: "skipped"; reason: string }
  | { kind: "retry"; error: string; httpStatus?: number; response?: string; retryAfterSeconds?: number }
  | { kind: "reject"; error: string; httpStatus?: number; response?: string };

/**
 * Create the Deliveries of up to `limit` events waiting to be fanned out:
 * one for each enabled Consumer subscribed to the event's type that existed
 * when the event was recorded. Returns how many events were fanned out.
 */
export async function fanOut(db: AppDb, now: Date, limit: number): Promise<number> {
  const pending = await db
    .select({ seq: businessEvents.seq, type: businessEvents.type, recordedAt: businessEvents.recordedAt })
    .from(businessEvents)
    .where(isNull(businessEvents.fannedOutAt))
    .orderBy(asc(businessEvents.seq))
    .limit(limit)
    .all();
  if (pending.length === 0) return 0;

  const at = now.toISOString();
  const consumers = (await db.select().from(eventConsumers).where(eq(eventConsumers.enabled, true)).all()).map((consumer) => ({
    ...consumer,
    patterns: readSubscription(consumer.subscription),
  }));
  const statements: BatchStatement[] = [];
  for (const event of pending) {
    for (const consumer of consumers) {
      if (consumer.createdAt > event.recordedAt || !subscribesTo(consumer.patterns, event.type)) continue;
      statements.push(
        db
          .insert(eventDeliveries)
          .values({ id: crypto.randomUUID(), eventSeq: event.seq, consumerId: consumer.id, state: "due", attempts: 0, nextAttemptAt: at, createdAt: at })
          .onConflictDoNothing(),
      );
    }
  }
  statements.push(
    db
      .update(businessEvents)
      .set({ fannedOutAt: at })
      .where(and(inArray(businessEvents.seq, pending.map((e) => e.seq)), isNull(businessEvents.fannedOutAt))),
  );
  await db.batch(statements as [BatchStatement, ...BatchStatement[]]);
  return pending.length;
}

/** The Deliveries due now, the longest waiting first. */
export async function dueDeliveries(db: AppDb, now: Date, limit: number): Promise<string[]> {
  const rows = await db
    .select({ id: eventDeliveries.id })
    .from(eventDeliveries)
    .where(and(eq(eventDeliveries.state, "due"), lte(eventDeliveries.nextAttemptAt, now.toISOString())))
    .orderBy(asc(eventDeliveries.nextAttemptAt))
    .limit(limit)
    .all();
  return rows.map((r) => r.id);
}

/**
 * Take a due Delivery for an Attempt: counts the Attempt and holds the
 * Delivery for `DELIVERY_LEASE_MS`. Null when it is not due, or another drain
 * holds it. Two trips to D1: the claim, then its event and Consumer — read
 * apart from the claim because a batch returns rows keyed by column name, and
 * these three tables share column names.
 */
export async function claimDelivery(db: AppDb, id: string, now: Date): Promise<ClaimedDelivery | null> {
  const [claimed] = await db
    .update(eventDeliveries)
    .set({ attempts: sql`${eventDeliveries.attempts} + 1`, nextAttemptAt: new Date(now.getTime() + DELIVERY_LEASE_MS).toISOString() })
    .where(and(eq(eventDeliveries.id, id), eq(eventDeliveries.state, "due"), lte(eventDeliveries.nextAttemptAt, now.toISOString())))
    .returning({ attempts: eventDeliveries.attempts });
  if (!claimed) return null;
  const row = await db
    .select({ event: businessEvents, consumer: eventConsumers })
    .from(eventDeliveries)
    .innerJoin(businessEvents, eq(businessEvents.seq, eventDeliveries.eventSeq))
    .innerJoin(eventConsumers, eq(eventConsumers.id, eventDeliveries.consumerId))
    .where(eq(eventDeliveries.id, id))
    .get();
  if (!row) return null;
  return { id, attempt: claimed.attempts, consumer: row.consumer, event: toBusinessEvent(row.event) };
}

/**
 * Record an Attempt and what it settles: delivered, skipped, due again after
 * its wait (no sooner than a Retry-After asked), or dead once the Attempts
 * are spent or the Consumer refused it for good. A failure marks the
 * Consumer failing; one failing for `FAILING_DISABLES_AFTER_MS` is disabled.
 * Applies only while this Attempt still holds the Delivery. Returns the
 * Delivery's state, or null when another drain took it meanwhile.
 */
export async function settleDelivery(
  db: AppDb,
  claimed: ClaimedDelivery,
  outcome: AttemptOutcome,
  timing: { startedAt: Date; finishedAt: Date },
): Promise<DeliveryState | null> {
  const at = timing.finishedAt.toISOString();
  const failed = outcome.kind === "retry" || outcome.kind === "reject";
  let state: DeliveryState;
  let nextAttemptAt: string | null = null;
  if (outcome.kind === "delivered") state = "delivered";
  else if (outcome.kind === "skipped") state = "skipped";
  else if (outcome.kind === "reject") state = "dead";
  else {
    const scheduled = DELIVERY_RETRIES.nextAttemptAfter(claimed.attempt, timing.finishedAt);
    const asked = outcome.retryAfterSeconds ? new Date(timing.finishedAt.getTime() + outcome.retryAfterSeconds * 1000).toISOString() : null;
    nextAttemptAt = scheduled && asked && asked > scheduled ? asked : scheduled;
    state = nextAttemptAt ? "due" : "dead";
  }

  const stillOurs = and(eq(eventDeliveries.id, claimed.id), eq(eventDeliveries.state, "due"), eq(eventDeliveries.attempts, claimed.attempt));
  const holds = sql`exists (select 1 from ${eventDeliveries} where ${eventDeliveries.id} = ${claimed.id} and ${eventDeliveries.state} = 'due' and ${eventDeliveries.attempts} = ${claimed.attempt})`;
  const outcomeKind: AttemptOutcomeKind = outcome.kind;
  const statements: BatchStatement[] = [
    db.insert(eventDeliveryAttempts).select(
      db
        .select({
          id: sql`${crypto.randomUUID()}`.as("id"),
          deliveryId: sql`${claimed.id}`.as("delivery_id"),
          attempt: sql`${claimed.attempt}`.as("attempt"),
          attemptedAt: sql`${timing.startedAt.toISOString()}`.as("attempted_at"),
          durationMs: sql`${Math.max(0, timing.finishedAt.getTime() - timing.startedAt.getTime())}`.as("duration_ms"),
          outcome: sql`${outcomeKind}`.as("outcome"),
          httpStatus: sql`${"httpStatus" in outcome ? (outcome.httpStatus ?? null) : null}`.as("http_status"),
          responseExcerpt: sql`${"response" in outcome && outcome.response ? outcome.response.slice(0, EXCERPT_CHARS) : null}`.as("response_excerpt"),
          error: sql`${outcome.kind === "skipped" ? outcome.reason : failed ? (outcome as { error: string }).error : null}`.as("error"),
        })
        .from(sql`(select 1)`)
        .where(holds),
    ),
    db
      .update(eventConsumers)
      .set(
        failed
          ? {
              failingSince: sql`coalesce(${eventConsumers.failingSince}, ${at})`,
              enabled: sql`case when ${eventConsumers.failingSince} is not null and ${eventConsumers.failingSince} <= ${before(timing.finishedAt, FAILING_DISABLES_AFTER_MS)} then 0 else ${eventConsumers.enabled} end`,
              disabledReason: sql`case when ${eventConsumers.failingSince} is not null and ${eventConsumers.failingSince} <= ${before(timing.finishedAt, FAILING_DISABLES_AFTER_MS)} then 'Every delivery failed for 3 days' else ${eventConsumers.disabledReason} end`,
            }
          : { failingSince: null },
      )
      .where(and(eq(eventConsumers.id, claimed.consumer.id), holds)),
    db
      .update(eventDeliveries)
      .set({
        state,
        nextAttemptAt,
        lastError: failed ? (outcome as { error: string }).error.slice(0, EXCERPT_CHARS) : null,
        settledAt: state === "due" ? null : at,
      })
      .where(stillOurs),
  ];
  const results = await db.batch(statements as [BatchStatement, ...BatchStatement[]]);
  return changes(results.at(-1)) > 0 ? state : null;
}

/**
 * Keep the log bounded: settled Deliveries after `SETTLED_KEPT_MS`, and
 * Business Events after `EVENTS_KEPT_MS` once nothing of theirs is still due
 * (their Dead Deliveries go with them). Returns what was removed.
 */
export async function pruneEventLog(db: AppDb, now: Date): Promise<{ deliveries: number; events: number }> {
  // Counted from what each delete returns: D1's change count includes the rows its foreign keys cascade to.
  const [deliveries, events] = await db.batch([
    db
      .delete(eventDeliveries)
      .where(and(inArray(eventDeliveries.state, ["delivered", "skipped"]), lte(eventDeliveries.settledAt, before(now, SETTLED_KEPT_MS))))
      .returning({ id: eventDeliveries.id }),
    db
      .delete(businessEvents)
      .where(
        and(
          lte(businessEvents.recordedAt, before(now, EVENTS_KEPT_MS)),
          sql`${businessEvents.fannedOutAt} is not null`,
          sql`not exists (select 1 from ${eventDeliveries} where ${eventDeliveries.eventSeq} = ${businessEvents.seq} and ${eventDeliveries.state} = 'due')`,
        ),
      )
      .returning({ seq: businessEvents.seq }),
  ]);
  return { deliveries: deliveries.length, events: events.length };
}
