/**
 * Recording what was reported about a shipment — the one writer of shipment
 * facts (ADR 0006).
 *
 * Webhooks, pulled histories and merchant reports all come through here. The
 * decision is the pure `applyEvent`; this module only persists it. In one D1
 * batch it records the new events, the shipment's new facts, and the
 * commercial effects of a milestone reached for the first time:
 *   - delivered, by the store's driver → the driver's delivered count,
 *     earnings and the cash they now hold;
 *   - returned → the goods back in stock and the customer's spend rolled back.
 *
 * Concurrency: D1 has no transaction API, so the batch claims the shipment by
 * replacing the `revision` it read with a fresh token, and every other
 * statement applies only while that token stands. If another writer got there
 * first, nothing applies and the work is redone on the shipment as it now is.
 * Effects therefore happen exactly once, however many writers race.
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import type { AppDb } from "../db/client";
import { customers, drivers, orders, shipmentEvents, shipments } from "../db/schema";
import { linesToRestock, restockStatements } from "../inventory/restock";
import { applyEvent, type Anomaly, type DeliveryFacts, type Interpretation, type Milestone } from "./interpretation";
import { eventKey, type ShipmentEventSource } from "./model";

export interface IncomingShipmentEvent {
  source: ShipmentEventSource;
  /** The status exactly as reported, with the vocabulary it belongs to. */
  status: { vocabulary: string; value: string; label?: string | null };
  interpretation: Interpretation;
  reason?: string | null;
  /** Canonical UTC ISO-8601. */
  occurredAt: string;
  actorId?: string | null;
  webhookEventId?: string | null;
  raw?: unknown;
}

/** What a recorded shipment change means to the rest of CodFlow (CAPI, notifications). */
export interface ShipmentBusinessEvent {
  type: "ShipmentOutForDelivery" | "ShipmentDelivered" | "ShipmentReturnStarted" | "ShipmentReturned" | "ShipmentCancelled" | "DeliveryAttemptFailed";
  shipmentId: string;
  orderId: string;
  occurredAt: string;
}

export interface RecordedEvents {
  /** Events new to this shipment. */
  recorded: number;
  /** Events it already had (the same fact reported again). */
  duplicates: number;
  /** Milestones set for the first time by this call. */
  reached: Milestone[];
  anomalies: Anomaly[];
  businessEvents: ShipmentBusinessEvent[];
}

export class ShipmentNotFoundError extends Error {
  constructor(readonly shipmentId: string) {
    super(`Shipment ${shipmentId} does not exist`);
    this.name = "ShipmentNotFoundError";
  }
}

const MAX_ATTEMPTS = 5;
const SYSTEM_ACTOR = { id: "system", name: "النظام" };

const BUSINESS_EVENT: Record<Milestone, ShipmentBusinessEvent["type"]> = {
  out_for_delivery: "ShipmentOutForDelivery",
  delivered: "ShipmentDelivered",
  return_started: "ShipmentReturnStarted",
  returned: "ShipmentReturned",
  cancelled: "ShipmentCancelled",
};

type ShipmentRow = typeof shipments.$inferSelect;

function deliveryFacts(row: ShipmentRow): DeliveryFacts {
  return {
    providerStatus: row.providerStatus,
    providerStatusKind: row.providerStatusKind,
    providerStatusAt: row.providerStatusAt,
    outForDeliveryAt: row.outForDeliveryAt,
    deliveredAt: row.deliveredAt,
    returnStartedAt: row.returnStartedAt,
    returnedAt: row.returnedAt,
    cancelledAt: row.cancelledAt,
    deliveryAttempts: row.deliveryAttempts,
    attentionSince: row.attentionSince,
  };
}

/**
 * Record reported events on a shipment. Events it already has are ignored;
 * the rest are applied in the order given (carriers' own order is not
 * trusted for meaning — `applyEvent` orders by time).
 */
export async function recordShipmentEvents(
  db: AppDb,
  shipmentId: string,
  incoming: readonly IncomingShipmentEvent[],
): Promise<RecordedEvents> {
  for (let attempt = 1; ; attempt++) {
    const outcome = await attemptRecord(db, shipmentId, incoming);
    if (outcome !== "lost_race") return outcome;
    if (attempt >= MAX_ATTEMPTS) {
      throw new Error(`Shipment ${shipmentId} kept changing while recording events; gave up after ${MAX_ATTEMPTS} attempts`);
    }
  }
}

async function attemptRecord(
  db: AppDb,
  shipmentId: string,
  incoming: readonly IncomingShipmentEvent[],
): Promise<RecordedEvents | "lost_race"> {
  const row = await db.select().from(shipments).where(eq(shipments.id, shipmentId)).get();
  if (!row) throw new ShipmentNotFoundError(shipmentId);

  // The same fact twice in one call, or already recorded, is one event.
  const unique = new Map<string, IncomingShipmentEvent>();
  for (const event of incoming) {
    const key = eventKey(event.status, event.occurredAt);
    if (!unique.has(key)) unique.set(key, event);
  }
  const keys = [...unique.keys()];
  const known = keys.length
    ? new Set(
        (
          await db
            .select({ key: shipmentEvents.eventKey })
            .from(shipmentEvents)
            .where(and(eq(shipmentEvents.shipmentId, shipmentId), inArray(shipmentEvents.eventKey, keys)))
            .all()
        ).map((r) => r.key),
      )
    : new Set<string>();
  const fresh = [...unique.entries()].filter(([key]) => !known.has(key));
  const duplicates = incoming.length - fresh.length;
  if (fresh.length === 0) return { recorded: 0, duplicates, reached: [], anomalies: [], businessEvents: [] };

  let facts = deliveryFacts(row);
  const reached: Milestone[] = [];
  const anomalies: Anomaly[] = [];
  const businessEvents: ShipmentBusinessEvent[] = [];
  const now = new Date().toISOString();
  const revision = crypto.randomUUID();
  const guard = sql`exists (select 1 from ${shipments} where ${shipments.id} = ${shipmentId} and ${shipments.revision} = ${revision})`;

  type BatchStatement = Parameters<AppDb["batch"]>[0][number];
  const eventStatements: BatchStatement[] = [];
  for (const [key, event] of fresh) {
    const before = facts;
    const step = applyEvent(before, { providerStatus: event.status.value, interpretation: event.interpretation, occurredAt: event.occurredAt });
    facts = step.next;
    reached.push(...step.reached);
    if (step.anomaly) anomalies.push(step.anomaly);
    for (const milestone of step.reached) {
      businessEvents.push({ type: BUSINESS_EVENT[milestone], shipmentId, orderId: row.orderId, occurredAt: event.occurredAt });
    }
    if (step.next.deliveryAttempts > before.deliveryAttempts) {
      businessEvents.push({ type: "DeliveryAttemptFailed", shipmentId, orderId: row.orderId, occurredAt: event.occurredAt });
    }
    const milestone = event.interpretation.kind === "milestone" ? event.interpretation.milestone : null;
    eventStatements.push(
      db.insert(shipmentEvents).select(
        db
          .select({
            id: sql`${crypto.randomUUID()}`.as("id"),
            shipmentId: shipments.id,
            source: sql`${event.source}`.as("source"),
            eventKey: sql`${key}`.as("event_key"),
            vocabulary: sql`${event.status.vocabulary}`.as("vocabulary"),
            providerStatus: sql`${event.status.value}`.as("provider_status"),
            providerStatusLabel: sql`${event.status.label ?? null}`.as("provider_status_label"),
            interpretation: sql`${event.interpretation.kind}`.as("interpretation"),
            milestone: sql`${milestone}`.as("milestone"),
            attention: sql`${event.interpretation.kind === "exception" || (event.interpretation.kind === "milestone" && event.interpretation.attention === true) ? 1 : 0}`.as("attention"),
            anomaly: sql`${step.anomaly}`.as("anomaly"),
            reason: sql`${event.reason ?? null}`.as("reason"),
            occurredAt: sql`${event.occurredAt}`.as("occurred_at"),
            recordedAt: sql`${now}`.as("recorded_at"),
            actorId: sql`${event.actorId ?? null}`.as("actor_id"),
            webhookEventId: sql`${event.webhookEventId ?? null}`.as("webhook_event_id"),
            raw: sql`${event.raw === undefined ? null : JSON.stringify(event.raw)}`.as("raw"),
          })
          .from(shipments)
          .where(and(eq(shipments.id, shipmentId), eq(shipments.revision, revision))),
      ),
    );
  }

  const current = fresh
    .map(([, e]) => e)
    .reduce<IncomingShipmentEvent | null>((newest, e) => (newest === null || e.occurredAt >= newest.occurredAt ? e : newest), null);
  const labelChanged = current !== null && facts.providerStatusAt === current.occurredAt && facts.providerStatus === current.status.value;

  const claim = db
    .update(shipments)
    .set({
      providerStatus: facts.providerStatus,
      providerStatusKind: facts.providerStatusKind,
      providerStatusAt: facts.providerStatusAt,
      ...(labelChanged ? { providerStatusLabel: current!.status.label ?? null } : {}),
      outForDeliveryAt: facts.outForDeliveryAt,
      deliveredAt: facts.deliveredAt,
      returnStartedAt: facts.returnStartedAt,
      returnedAt: facts.returnedAt,
      cancelledAt: facts.cancelledAt,
      deliveryAttempts: facts.deliveryAttempts,
      attentionSince: facts.attentionSince,
      revision,
      updatedAt: now,
    })
    .where(and(eq(shipments.id, shipmentId), eq(shipments.revision, row.revision)));

  const effects: BatchStatement[] = [];
  if (reached.includes("delivered") && row.kind === "driver" && row.driverId) {
    effects.push(
      db
        .update(drivers)
        .set({
          totalDelivered: sql`${drivers.totalDelivered} + 1`,
          totalEarnings: sql`${drivers.totalEarnings} + ${row.driverFee}`,
          pendingCash: sql`${drivers.pendingCash} + ${row.codAmount}`,
          updatedAt: now,
        })
        .where(and(eq(drivers.id, row.driverId), guard)),
    );
  }
  if (reached.includes("returned")) {
    const order = await db
      .select({ customerId: orders.customerId, price: orders.price })
      .from(orders)
      .where(eq(orders.id, row.orderId))
      .get();
    const lines = await linesToRestock(db, row.orderId);
    effects.push(...restockStatements(db, lines, "ORDER_RETURNED", row.orderId, SYSTEM_ACTOR, now, guard));
    if (order) {
      effects.push(
        db
          .update(customers)
          .set({ totalSpent: sql`MAX(0, ${customers.totalSpent} - ${order.price})` })
          .where(and(eq(customers.id, order.customerId), guard)),
      );
    }
  }

  const results = await db.batch([claim, ...eventStatements, ...effects] as [BatchStatement, ...BatchStatement[]]);
  const claimed = (results[0] as { meta?: { changes?: number } }).meta?.changes ?? 0;
  if (claimed === 0) return "lost_race";

  return { recorded: fresh.length, duplicates, reached, anomalies, businessEvents };
}
