/**
 * The inbound pipeline's schedule — every five minutes (plan §5.5):
 *
 *   1. the inbox: events whose processing is due again;
 *   2. reservations that never finished (the Worker ended between the
 *      carrier call and recording its answer) become unknown handoffs;
 *   3. unknown handoffs are looked up by order number, where the carrier can;
 *   4. pull-only carriers (EcoTrack platform, NOEST, Guepex): open shipments
 *      not synced recently, oldest first, within each company's budget.
 *
 * Each pass is bounded, so one run stays well inside a scheduled invocation
 * and inside the carriers' rate limits; whatever is left waits for the next.
 */

import { and, asc, eq, isNull, lt, or } from "drizzle-orm";
import { SYSTEM_ACTING, carrierAuthor } from "@/lib/acting";
import { getDb, type AppDb } from "@/db";
import { deliveryCompanies, shipments } from "@/db/schema";
import type { Env } from "@/types";
import { isCarrierError } from "@/carriers/contract";
import { carrierCapabilities } from "@/carriers/registry";
import { scheduleShipmentConversions, type WaitUntil } from "@/lib/conversions";
import { dueInboxEvents } from "../../../cod-shared/inbound/inbox";
import { markHandoffUnknown, recordSynced } from "../../../cod-shared/shipments/handoff";
import type { ShipmentBusinessEvent } from "../../../cod-shared/shipments/record-events";
import { connectedCarrier, resolveHandoff } from "@/endpoints/shipments/carrier-handoff";
import { syncShipments } from "@/endpoints/shipments/sync";
import { processInbox } from "./process";

export const INBOUND_CRON = "*/5 * * * *";

export const LIMITS = {
  /** Inbox events per run. */
  inbox: 100,
  /** A reservation still submitting after this long will not be settled by its request. */
  staleReservationMs: 10 * 60_000,
  /** Unknown handoffs looked up per run, and how long before one is looked up again. */
  lookups: 10,
  lookupEveryMs: 15 * 60_000,
  /** Shipments synced per pull-only company per run, and how long a sync holds. */
  syncPerCompany: 20,
  syncEveryMs: 30 * 60_000,
} as const;

const before = (now: Date, ms: number) => new Date(now.getTime() - ms).toISOString();

/** 1. Process inbox events whose processing is due. */
export async function sweepInbox(env: Env, waitUntil: WaitUntil, now = new Date()) {
  const ids = await dueInboxEvents(getDb(env.DB), LIMITS.inbox, now);
  return ids.length ? processInbox(env, waitUntil, ids) : [];
}

/** 2. A reservation still submitting long after its request ended: its outcome is unknown. */
export async function expireStaleReservations(db: AppDb, now = new Date()): Promise<string[]> {
  const stale = await db
    .select({ id: shipments.id })
    .from(shipments)
    .where(and(eq(shipments.handoffState, "submitting"), lt(shipments.createdAt, before(now, LIMITS.staleReservationMs))))
    .all();
  const expired: string[] = [];
  for (const { id } of stale) {
    if (await markHandoffUnknown(db, id, "The handoff request ended before the carrier's answer was recorded")) expired.push(id);
  }
  return expired;
}

/** 3. Look unknown handoffs up by order number, at carriers that support it; each at most every `lookupEveryMs`. */
export async function lookUpUnknownHandoffs(db: AppDb, now = new Date()): Promise<{ found: string[]; notFound: string[]; failed: string[] }> {
  const candidates = await db
    .select({ id: shipments.id, provider: deliveryCompanies.provider, providerConfig: deliveryCompanies.providerConfig })
    .from(shipments)
    .innerJoin(deliveryCompanies, eq(deliveryCompanies.id, shipments.companyId))
    .where(and(eq(shipments.handoffState, "unknown"), or(isNull(shipments.lastSyncedAt), lt(shipments.lastSyncedAt, before(now, LIMITS.lookupEveryMs)))))
    .orderBy(asc(shipments.lastSyncedAt), asc(shipments.createdAt))
    .all();
  const outcome = { found: [] as string[], notFound: [] as string[], failed: [] as string[] };
  for (const candidate of candidates.filter((c) => carrierCapabilities(c)?.findByReference).slice(0, LIMITS.lookups)) {
    try {
      const resolved = await resolveHandoff(db, candidate.id, { action: "lookup" }, SYSTEM_ACTING);
      if (resolved.outcome === "accepted" && resolved.result.outcome === "accepted") {
        outcome.found.push(candidate.id);
        continue;
      }
      outcome.notFound.push(candidate.id);
    } catch (error) {
      console.warn(`[inbound] lookup of unknown handoff ${candidate.id} failed: ${(error as Error)?.message}`);
      outcome.failed.push(candidate.id);
    }
    await recordSynced(db, candidate.id, null);
  }
  return outcome;
}

/** 4. Sync open shipments of pull-only carriers, oldest first. A company that throttles or fails stops for this run. */
export async function syncPullCarriers(env: Env, waitUntil: WaitUntil, now = new Date()): Promise<{ synced: string[]; stopped: string[] }> {
  const db = getDb(env.DB);
  const companies = (await db.select().from(deliveryCompanies).where(eq(deliveryCompanies.active, true)).all()).filter(
    (company) => company.apiToken && carrierCapabilities(company)?.updates === "pull",
  );
  const synced: string[] = [];
  const stopped: string[] = [];
  const events: ShipmentBusinessEvent[] = [];
  for (const company of companies) {
    const due = await db
      .select()
      .from(shipments)
      .where(
        and(
          eq(shipments.companyId, company.id),
          eq(shipments.handoffState, "accepted"),
          isNull(shipments.deliveredAt),
          isNull(shipments.returnedAt),
          isNull(shipments.cancelledAt),
          or(isNull(shipments.lastSyncedAt), lt(shipments.lastSyncedAt, before(now, LIMITS.syncEveryMs))),
        ),
      )
      .orderBy(asc(shipments.lastSyncedAt), asc(shipments.createdAt))
      .limit(LIMITS.syncPerCompany)
      .all();
    if (due.length === 0) continue;
    try {
      const carrier = await connectedCarrier(company);
      const recorded = await syncShipments(db, carrier, due, carrierAuthor(company, "carrier_sync"));
      for (const [id, result] of recorded) {
        synced.push(id);
        events.push(...result.businessEvents);
      }
    } catch (error) {
      stopped.push(company.id);
      const kind = isCarrierError(error) ? error.kind : "error";
      console.warn(`[inbound] sync of ${company.name} stopped (${kind}): ${(error as Error)?.message}`);
    }
  }
  await scheduleShipmentConversions(env, waitUntil, db, events);
  return { synced, stopped };
}

/** One scheduled run of the inbound pipeline; a failing pass never stops the others. */
export async function runInboundCron(env: Env, waitUntil: WaitUntil, now = new Date()): Promise<void> {
  const db = getDb(env.DB);
  const passes: Array<[string, () => Promise<unknown>]> = [
    ["inbox", () => sweepInbox(env, waitUntil, now)],
    ["stale reservations", () => expireStaleReservations(db, now)],
    ["unknown handoffs", () => lookUpUnknownHandoffs(db, now)],
    ["pull sync", () => syncPullCarriers(env, waitUntil, now)],
  ];
  for (const [name, pass] of passes) {
    try {
      await pass();
    } catch (error) {
      console.error(`[inbound] ${name} pass failed:`, (error as Error)?.message);
    }
  }
}
