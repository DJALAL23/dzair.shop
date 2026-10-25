/**
 * The drain (ADR 0017): the one function that moves work along — the carriers'
 * webhook inbox, the fan-out of new Business Events into Deliveries, and the
 * Deliveries now due. The queue consumer runs it a few seconds after work
 * appears; the five-minute schedule runs it too, which is how retries come
 * due and how anything a lost wake missed is still done.
 *
 * Every unit of work starts only when its worst case fits what this
 * invocation may still spend (`meter.ts`); what does not fit waits for the
 * next drain, which `drainAndContinue` wakes at once.
 */

import { sql } from "drizzle-orm";
import { getDb, type AppDb } from "@/db";
import type { Env } from "@/types";
import { businessEvents, eventDeliveries, webhookEvents } from "@/db/schema";
import { processInboxEvent } from "@/inbound/process";
import { dueInboxEvents } from "../../../cod-shared/inbound/inbox";
import { claimDelivery, dueDeliveries, fanOut, settleDelivery, type AttemptOutcome } from "../../../cod-shared/events/deliveries";
import { CONSUMER_KINDS } from "./consumers";
import type { ConsumerKinds } from "./consumers/kind";
import { DRAIN_BUDGET, createMeter, type Cost } from "./meter";

/** The only message the events queue carries. */
export interface DrainMessage {
  kind: "drain";
}

/** The most one inbox event may cost: its claim, its company and shipment, recording it (with retries), settling it. */
const INBOX_EVENT: Cost = { external: 0, services: 40 };
/** One fan-out: the events waiting, the Consumers, one batch. */
const FAN_OUT: Cost = { external: 0, services: 3 };
/** A Delivery's own trips, beside its kind's: the claim, reading what it carries, the settlement. */
const DELIVERY: Cost = { external: 0, services: 3 };
const SCAN = 100;

export interface DrainReport {
  inbox: number;
  fannedOut: number;
  attempts: Record<AttemptOutcome["kind"], number>;
  /** Work was left for the next drain because this one's budget ran out. */
  more: boolean;
}

export interface DrainOptions {
  kinds?: ConsumerKinds;
  /** What this invocation may spend; the Free plan's limits unless said otherwise. */
  budget?: Cost;
  now?: () => Date;
}

export async function drain(env: Env, { kinds = CONSUMER_KINDS, budget = DRAIN_BUDGET, now = () => new Date() }: DrainOptions = {}): Promise<DrainReport> {
  const meter = createMeter(env.DB, budget);
  const db = meter.db;
  const report: DrainReport = { inbox: 0, fannedOut: 0, attempts: { delivered: 0, skipped: 0, retry: 0, reject: 0 }, more: false };

  for (const id of await dueInboxEvents(db, SCAN, now())) {
    if (!meter.fits(INBOX_EVENT)) {
      report.more = true;
      break;
    }
    await processInboxEvent(db, id, now());
    report.inbox += 1;
  }

  for (;;) {
    if (!meter.fits(FAN_OUT)) {
      report.more = true;
      break;
    }
    const fanned = await fanOut(db, now(), SCAN);
    report.fannedOut += fanned;
    if (fanned < SCAN) break;
  }

  const attemptCost = Object.values(kinds).reduce<Cost>(
    (most, kind) => ({ external: Math.max(most.external, kind.cost.external), services: Math.max(most.services, kind.cost.services) }),
    { external: 0, services: 0 },
  );
  const unit: Cost = { external: DELIVERY.external + attemptCost.external, services: DELIVERY.services + attemptCost.services };
  for (const id of await dueDeliveries(db, now(), SCAN)) {
    if (!meter.fits(unit)) {
      report.more = true;
      break;
    }
    const claimed = await claimDelivery(db, id, now());
    if (!claimed) continue;
    const startedAt = now();
    const kind = kinds[claimed.consumer.kind];
    let outcome: AttemptOutcome;
    if (!claimed.consumer.enabled) outcome = { kind: "skipped", reason: "The consumer is disabled" };
    else if (!kind) outcome = { kind: "reject", error: `No consumer kind "${claimed.consumer.kind}" on this platform version` };
    else {
      try {
        outcome = await kind.deliver({ deliveryId: claimed.id, event: claimed.event, consumer: claimed.consumer, attempt: claimed.attempt, now: startedAt, db, fetch: meter.fetch, env });
      } catch (error) {
        outcome = { kind: "retry", error: (error as Error)?.message ?? String(error) };
      }
    }
    if (await settleDelivery(db, claimed, outcome, { startedAt, finishedAt: now() })) report.attempts[outcome.kind] += 1;
  }
  return report;
}

/**
 * Drain, and when work was left for want of budget, wake the next drain at
 * once rather than at the next schedule. Never wakes again after a drain that
 * did nothing: a unit that cannot advance waits for the schedule instead of
 * looping.
 */
export async function drainAndContinue(env: Env, options: DrainOptions = {}): Promise<DrainReport> {
  const report = await drain(env, options);
  const progressed = report.inbox + report.fannedOut + Object.values(report.attempts).reduce((a, b) => a + b, 0) > 0;
  if (report.more && progressed) await env.EVENTS_QUEUE.send({ kind: "drain" });
  return report;
}

/** Whether a drain has anything to do now: one read, through partial indexes. */
export async function workIsDue(db: AppDb, now: Date): Promise<boolean> {
  const at = now.toISOString();
  const row = await db.get<{ due: number }>(sql`select (
    exists (select 1 from ${businessEvents} where ${businessEvents.fannedOutAt} is null)
    or exists (select 1 from ${eventDeliveries} where ${eventDeliveries.state} = 'due' and ${eventDeliveries.nextAttemptAt} <= ${at})
    or exists (select 1 from ${webhookEvents} where ${webhookEvents.result} in ('pending', 'error') and ${webhookEvents.nextAttemptAt} is not null and ${webhookEvents.nextAttemptAt} <= ${at})
  ) as due`);
  return Boolean(row?.due);
}

/** After a request that may have recorded work: wake a drain, when anything is due. */
export async function wake(env: Env): Promise<void> {
  if (await workIsDue(getDb(env.DB), new Date())) await env.EVENTS_QUEUE.send({ kind: "drain" });
}
