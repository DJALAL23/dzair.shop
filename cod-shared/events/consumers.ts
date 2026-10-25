/**
 * Consumers and their Deliveries as the merchant sees and steers them
 * (Events context): who receives the store's Business Events, how each
 * Delivery went, and the merchant's word — create a webhook, edit it, rotate
 * its Signing Secret, stop, start again, Replay, delete. A Signing Secret
 * leaves this module in full only when it is made; a kind's settings never
 * do beyond what the merchant typed in.
 */

import { and, desc, eq, lt, sql, type SQL } from "drizzle-orm";
import type { AppDb } from "../db/client";
import { businessEvents, eventConsumers, eventDeliveries, eventDeliveryAttempts } from "../db/schema";
import { insertSelectRow } from "../db/insert-select";
import { maskSecret } from "../carriers/providers";
import type { EventType } from "./catalogue";
import { reopenDeliveries } from "./deliveries";
import type { AttemptOutcomeKind, ConsumerDisabledReason, DeliveryState } from "./deliveries-model";
import { isSubscriptionPattern, readSubscription, type SubscriptionPattern } from "./subscription";
import { PREVIOUS_SECRET_SIGNS_FOR_MS, WEBHOOK_CONSUMERS_MAX, WEBHOOK_KIND, newSigningSecret, previousSecretSignsUntil, readWebhookSettings, webhookUrlProblem } from "./webhooks";

/** A webhook Consumer's endpoint and Signing Secret, as the merchant sees them. */
export interface WebhookView {
  url: string;
  /** The current Signing Secret, masked: `••••` and its last four characters. */
  signingSecret: string;
  secretRotatedAt: string | null;
  /** Until when the previous Signing Secret also signs; null when none does. */
  previousSecretSignsUntil: string | null;
}

export interface ConsumerView {
  id: string;
  kind: string;
  name: string;
  enabled: boolean;
  /** Built in: created and kept by the store's own settings (Meta conversions); only started and stopped here. */
  builtIn: boolean;
  subscription: SubscriptionPattern[];
  catalogueVersion: number;
  /** Why it stopped receiving, while it is disabled. */
  disabledReason: ConsumerDisabledReason | null;
  /** Since when every Attempt has failed; null once one is delivered. */
  failingSince: string | null;
  /** Deliveries on their way, and Dead ones waiting for a Replay. */
  deliveries: { due: number; dead: number };
  /** For a webhook Consumer; null for any other kind. */
  webhook: WebhookView | null;
  createdAt: string;
  updatedAt: string;
}

/** The Consumer Kinds the merchant creates, edits and deletes; every other kind is built in. */
const MERCHANT_KINDS: readonly string[] = [WEBHOOK_KIND];

const consumerView = {
  id: eventConsumers.id,
  kind: eventConsumers.kind,
  name: eventConsumers.name,
  enabled: eventConsumers.enabled,
  subscription: eventConsumers.subscription,
  catalogueVersion: eventConsumers.catalogueVersion,
  disabledReason: eventConsumers.disabledReason,
  failingSince: eventConsumers.failingSince,
  settings: eventConsumers.settings,
  signingSecret: eventConsumers.signingSecret,
  previousSigningSecret: eventConsumers.previousSigningSecret,
  secretRotatedAt: eventConsumers.secretRotatedAt,
  due: sql<number>`(select count(*) from event_deliveries d where d.consumer_id = event_consumers.id and d.state = 'due')`,
  dead: sql<number>`(select count(*) from event_deliveries d where d.consumer_id = event_consumers.id and d.state = 'dead')`,
  createdAt: eventConsumers.createdAt,
  updatedAt: eventConsumers.updatedAt,
};

type ConsumerViewRow = Omit<ConsumerView, "deliveries" | "subscription" | "webhook" | "builtIn"> & {
  due: number;
  dead: number;
  subscription: string;
  settings: string;
  signingSecret: string | null;
  previousSigningSecret: string | null;
  secretRotatedAt: string | null;
};

function toConsumerView({ due, dead, subscription, settings, signingSecret, previousSigningSecret, secretRotatedAt, ...row }: ConsumerViewRow): ConsumerView {
  const webhook =
    row.kind === WEBHOOK_KIND
      ? { url: readWebhookSettings(settings).url, signingSecret: maskSecret(signingSecret)!, secretRotatedAt, previousSecretSignsUntil: previousSecretSignsUntil(secretRotatedAt, previousSigningSecret) }
      : null;
  return { ...row, builtIn: !MERCHANT_KINDS.includes(row.kind), subscription: readSubscription(subscription), deliveries: { due, dead }, webhook };
}

export async function listConsumers(db: AppDb): Promise<ConsumerView[]> {
  return (await db.select(consumerView).from(eventConsumers).orderBy(eventConsumers.createdAt, eventConsumers.id).all()).map(toConsumerView);
}

export async function readConsumer(db: AppDb, id: string): Promise<ConsumerView | null> {
  const row = await db.select(consumerView).from(eventConsumers).where(eq(eventConsumers.id, id)).get();
  return row ? toConsumerView(row) : null;
}

/** The whole row, Signing Secrets included: for the server sending to it, never for an answer. */
export async function readConsumerRow(db: AppDb, id: string) {
  return (await db.select().from(eventConsumers).where(eq(eventConsumers.id, id)).get()) ?? null;
}

/** A Subscription as stored: each pattern once, in the order given. Refuses anything that is not a pattern. */
function storedSubscription(patterns: readonly string[]): string {
  if (patterns.length === 0 || !patterns.every(isSubscriptionPattern)) throw new Error("A Subscription is one or more Event Types, subjects (`order.*`) or `*`");
  return JSON.stringify([...new Set(patterns)]);
}

function storedWebhookSettings(url: string): string {
  const problem = webhookUrlProblem(url);
  if (problem) throw new Error(`Not a webhook endpoint (${problem}): ${url}`);
  return JSON.stringify({ url });
}

export interface WebhookDraft {
  name: string;
  url: string;
  subscription: SubscriptionPattern[];
}

export type WebhookCreation = { ok: true; consumer: ConsumerView; signingSecret: string } | { ok: false; reason: "limit_reached" };

/**
 * A new webhook Consumer, enabled, written in the catalogue's current
 * version and receiving what is recorded from now on. Its Signing Secret is
 * returned once, here. Refused when the store already has
 * `WEBHOOK_CONSUMERS_MAX` of them — counted in the same statement, so two
 * at once cannot both slip under the limit.
 */
export async function createWebhookConsumer(db: AppDb, draft: WebhookDraft, now: Date): Promise<WebhookCreation> {
  const id = crypto.randomUUID();
  const signingSecret = newSigningSecret();
  const at = now.toISOString();
  const value = (v: string | number) => sql`${v}`;
  const created = await db
    .insert(eventConsumers)
    .select(
      db
        .select(
          insertSelectRow(eventConsumers, {
            id: value(id),
            kind: value(WEBHOOK_KIND),
            name: value(draft.name),
            enabled: sql`1`,
            subscription: value(storedSubscription(draft.subscription)),
            settings: value(storedWebhookSettings(draft.url)),
            signingSecret: value(signingSecret),
            createdAt: value(at),
            updatedAt: value(at),
          }) as never,
        )
        .from(sql`(select 1)`)
        .where(sql`(select count(*) from ${eventConsumers} where ${eventConsumers.kind} = ${WEBHOOK_KIND}) < ${WEBHOOK_CONSUMERS_MAX}`),
    )
    .returning({ id: eventConsumers.id });
  if (created.length === 0) return { ok: false, reason: "limit_reached" };
  return { ok: true, consumer: (await readConsumer(db, id))!, signingSecret };
}

export interface ConsumerChange {
  enabled?: boolean;
  name?: string;
  url?: string;
  subscription?: SubscriptionPattern[];
}

type ConsumerSet = { [K in keyof typeof eventConsumers.$inferInsert]?: (typeof eventConsumers.$inferInsert)[K] | SQL };

export type ConsumerUpdate = { ok: true; consumer: ConsumerView } | { ok: false; reason: "not_found" | "built_in" };

/**
 * Change a Consumer. Any Consumer can be started and stopped; only one the
 * merchant created can be renamed, pointed elsewhere or subscribed
 * differently. Stopping settles its waiting Deliveries as skipped as the
 * drain meets them; starting it again clears why it stopped and its failing
 * streak, and what was recorded meanwhile reaches it only through a Replay.
 * A new URL is a new endpoint, so it starts without a failing streak. A new
 * Subscription applies to what is recorded from then on.
 */
export async function updateConsumer(db: AppDb, id: string, change: ConsumerChange, now: Date): Promise<ConsumerUpdate> {
  const current = await db.select({ kind: eventConsumers.kind }).from(eventConsumers).where(eq(eventConsumers.id, id)).get();
  if (!current) return { ok: false, reason: "not_found" };
  const edits = change.name !== undefined || change.url !== undefined || change.subscription !== undefined;
  if (edits && !MERCHANT_KINDS.includes(current.kind)) return { ok: false, reason: "built_in" };

  const set: ConsumerSet = { updatedAt: now.toISOString() };
  if (change.name !== undefined) set.name = change.name;
  if (change.subscription !== undefined) set.subscription = storedSubscription(change.subscription);
  if (change.url !== undefined) {
    set.settings = storedWebhookSettings(change.url);
    set.failingSince = null;
  }
  if (change.enabled === true) {
    set.enabled = true;
    set.disabledReason = null;
    if (change.url === undefined) set.failingSince = sql`case when ${eventConsumers.enabled} then ${eventConsumers.failingSince} else null end`;
  }
  if (change.enabled === false) {
    set.enabled = false;
    set.disabledReason = sql`case when ${eventConsumers.enabled} then 'merchant' else ${eventConsumers.disabledReason} end`;
  }

  const changed = await db.update(eventConsumers).set(set).where(and(eq(eventConsumers.id, id), eq(eventConsumers.kind, current.kind))).returning({ id: eventConsumers.id });
  if (changed.length === 0) return { ok: false, reason: "not_found" };
  return { ok: true, consumer: (await readConsumer(db, id))! };
}

export type SecretRotation = { ok: true; signingSecret: string; previousSecretSignsUntil: string } | { ok: false; reason: "not_found" | "built_in" };

/**
 * A new Signing Secret for a webhook Consumer, returned once, here. The one
 * it replaces keeps signing beside it for `PREVIOUS_SECRET_SIGNS_FOR_MS`, so
 * the merchant's endpoint can switch without refusing a Delivery; a secret
 * older than that stops signing at once.
 */
export async function rotateSigningSecret(db: AppDb, id: string, now: Date): Promise<SecretRotation> {
  const signingSecret = newSigningSecret();
  const at = now.toISOString();
  const rotated = await db
    .update(eventConsumers)
    .set({ previousSigningSecret: sql`${eventConsumers.signingSecret}`, signingSecret, secretRotatedAt: at, updatedAt: at })
    .where(and(eq(eventConsumers.id, id), eq(eventConsumers.kind, WEBHOOK_KIND)))
    .returning({ id: eventConsumers.id });
  if (rotated.length === 0) return { ok: false, reason: (await readConsumer(db, id)) ? "built_in" : "not_found" };
  return { ok: true, signingSecret, previousSecretSignsUntil: new Date(now.getTime() + PREVIOUS_SECRET_SIGNS_FOR_MS).toISOString() };
}

/** Delete a Consumer the merchant created, with its Deliveries and their Attempts; a built-in one is kept by its settings. */
export async function deleteConsumer(db: AppDb, id: string): Promise<{ ok: true; name: string } | { ok: false; reason: "not_found" | "built_in" }> {
  const current = await db.select({ kind: eventConsumers.kind }).from(eventConsumers).where(eq(eventConsumers.id, id)).get();
  if (!current) return { ok: false, reason: "not_found" };
  if (!MERCHANT_KINDS.includes(current.kind)) return { ok: false, reason: "built_in" };
  const [deleted] = await db.delete(eventConsumers).where(and(eq(eventConsumers.id, id), eq(eventConsumers.kind, current.kind))).returning({ name: eventConsumers.name });
  return deleted ? { ok: true, name: deleted.name } : { ok: false, reason: "not_found" };
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
