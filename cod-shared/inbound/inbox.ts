/**
 * The webhook inbox — carrier events stored the moment they arrive, then
 * processed, retried with backoff, and finally kept as dead letters
 * (ADR 0006, plan §5.5).
 *
 * Receiving is only storing: the carrier gets its 2xx at once (Yalidine
 * disables a webhook that is slow or failing). Processing claims an event
 * with a lease, so the immediate pass and the scheduled sweep never work on
 * the same event together, and settles it with what it turned out to be.
 */

import { and, asc, eq, inArray, isNotNull, lte, sql } from "drizzle-orm";
import type { AppDb } from "../db/client";
import { webhookEvents } from "../db/schema";

export const INBOX_RESULTS = ["pending", "ok", "ignored", "unmatched", "unknown_status", "deferred_settlement", "error", "dead"] as const;
export type InboxResult = (typeof INBOX_RESULTS)[number];

/** What a processed event turned out to be. */
export type InboxSettlement = Exclude<InboxResult, "pending" | "error" | "dead">;

/** Tries before an event is a dead letter. */
export const MAX_ATTEMPTS = 8;
/** How long a claim holds before another pass may take the event. */
export const LEASE_MS = 5 * 60_000;
/** Wait after the n-th failed try (minutes); the last try is the eighth. */
const BACKOFF_MINUTES = [1, 5, 15, 60, 180, 360, 720] as const;

export type InboxRow = typeof webhookEvents.$inferSelect;

/** When to try again after `attempts` failed tries, or null when they are spent. */
export function nextAttemptAfter(attempts: number, now: Date): string | null {
  if (attempts >= MAX_ATTEMPTS) return null;
  const minutes = BACKOFF_MINUTES[Math.max(attempts, 1) - 1];
  return new Date(now.getTime() + minutes * 60_000).toISOString();
}

export interface InboxEnvelope {
  eventId: string;
  eventType: string;
  payload: string;
}

const STORE_CHUNK = 50;

/**
 * Store a delivery's events, each once: an event the inbox already has (the
 * carrier's retry, a duplicate in the batch) is dropped by its unique key.
 * Returns the ids of the events stored now, due for processing at once.
 */
export async function storeInboxEvents(
  db: AppDb,
  source: { provider: string; companyId: string },
  envelopes: readonly InboxEnvelope[],
): Promise<{ stored: string[]; duplicates: number }> {
  const now = new Date().toISOString();
  const stored: string[] = [];
  for (let start = 0; start < envelopes.length; start += STORE_CHUNK) {
    const chunk = envelopes.slice(start, start + STORE_CHUNK).map((envelope) => ({ id: crypto.randomUUID(), envelope }));
    type Statement = Parameters<AppDb["batch"]>[0][number];
    const statements = chunk.map(
      ({ id, envelope }): Statement =>
        db
          .insert(webhookEvents)
          .values({
            id,
            provider: source.provider,
            eventId: envelope.eventId,
            companyId: source.companyId,
            eventType: envelope.eventType,
            rawPayload: envelope.payload,
            result: "pending",
            attempts: 0,
            nextAttemptAt: now,
            createdAt: now,
          })
          .onConflictDoNothing(),
    );
    if (statements.length === 0) continue;
    const results = await db.batch(statements as [Statement, ...Statement[]]);
    results.forEach((result, i) => {
      if (((result as { meta?: { changes?: number } }).meta?.changes ?? 0) > 0) stored.push(chunk[i].id);
    });
  }
  return { stored, duplicates: envelopes.length - stored.length };
}

/**
 * Take an event for processing, if it is due and nobody holds it: counts the
 * try and holds the event for `LEASE_MS`. Null when it is not available.
 */
export async function claimInboxEvent(db: AppDb, id: string, now = new Date()): Promise<InboxRow | null> {
  const at = now.toISOString();
  const [result] = await db.batch([
    db
      .update(webhookEvents)
      .set({ attempts: sql`${webhookEvents.attempts} + 1`, nextAttemptAt: new Date(now.getTime() + LEASE_MS).toISOString() })
      .where(
        and(
          eq(webhookEvents.id, id),
          inArray(webhookEvents.result, ["pending", "error"]),
          isNotNull(webhookEvents.nextAttemptAt),
          lte(webhookEvents.nextAttemptAt, at),
        ),
      ),
  ]);
  if (((result as { meta?: { changes?: number } }).meta?.changes ?? 0) === 0) return null;
  return (await db.select().from(webhookEvents).where(eq(webhookEvents.id, id)).get()) ?? null;
}

export interface SettlementDetails {
  shipmentId?: string | null;
  orderId?: string | null;
  tracking?: string | null;
  reason?: string | null;
}

/** The event is processed: record what it was. It is never processed again unless retried by hand. */
export async function settleInboxEvent(db: AppDb, id: string, result: InboxSettlement, details: SettlementDetails = {}): Promise<void> {
  await db
    .update(webhookEvents)
    .set({
      result,
      ...(details.shipmentId !== undefined ? { shipmentId: details.shipmentId } : {}),
      ...(details.orderId !== undefined ? { orderId: details.orderId } : {}),
      ...(details.tracking !== undefined ? { tracking: details.tracking } : {}),
      ...(details.reason !== undefined ? { reason: details.reason } : {}),
      errorMsg: null,
      nextAttemptAt: null,
      processedAt: new Date().toISOString(),
    })
    .where(eq(webhookEvents.id, id));
}

/** Processing failed: try again later with backoff, or keep it as a dead letter once the tries are spent. */
export async function failInboxEvent(db: AppDb, row: Pick<InboxRow, "id" | "attempts">, error: string, now = new Date()): Promise<"error" | "dead"> {
  const next = nextAttemptAfter(row.attempts, now);
  await db
    .update(webhookEvents)
    .set({ result: next ? "error" : "dead", errorMsg: error.slice(0, 2000), nextAttemptAt: next, processedAt: now.toISOString() })
    .where(eq(webhookEvents.id, row.id));
  return next ? "error" : "dead";
}

/** Events due for processing now, oldest due first. */
export async function dueInboxEvents(db: AppDb, limit: number, now = new Date()): Promise<string[]> {
  const rows = await db
    .select({ id: webhookEvents.id })
    .from(webhookEvents)
    .where(and(inArray(webhookEvents.result, ["pending", "error"]), isNotNull(webhookEvents.nextAttemptAt), lte(webhookEvents.nextAttemptAt, now.toISOString())))
    .orderBy(asc(webhookEvents.nextAttemptAt))
    .limit(limit)
    .all();
  return rows.map((r) => r.id);
}

/**
 * Process an event again on the merchant's word — after fixing a company's
 * settings, attaching a parcel, or for a dead letter. Its tries start over.
 */
export async function requeueInboxEvent(db: AppDb, id: string): Promise<boolean> {
  const [result] = await db.batch([
    db
      .update(webhookEvents)
      .set({ result: "pending", attempts: 0, nextAttemptAt: new Date().toISOString(), errorMsg: null })
      .where(and(eq(webhookEvents.id, id), inArray(webhookEvents.result, ["error", "dead", "unmatched", "unknown_status", "unmapped"]))),
  ]);
  return ((result as { meta?: { changes?: number } }).meta?.changes ?? 0) > 0;
}
