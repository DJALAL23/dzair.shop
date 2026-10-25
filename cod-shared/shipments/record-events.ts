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
import { insertSelectRow } from "../db/insert-select";
import { linesToRestock, restockStatements } from "../inventory/restock";
import { applyEvent, type Anomaly, type Interpretation, type Milestone } from "./interpretation";
import { eventKey, type ShipmentEventSource } from "./model";
import { deliveryFactsOf } from "./queries";
import { creditOf, type Author } from "../events/actor";
import { MILESTONE_EVENT, type BusinessEventDraft } from "../events/catalogue";
import { recordEvent } from "../events/record";
import { orderSnapshot, shipmentSnapshot } from "../events/snapshots";

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

export interface RecordedEvents {
  /** Events new to this shipment. */
  recorded: number;
  /** Events it already had (the same fact reported again). */
  duplicates: number;
  /** Milestones set for the first time by this call. */
  reached: Milestone[];
  anomalies: Anomaly[];
}

export class ShipmentNotFoundError extends Error {
  constructor(readonly shipmentId: string) {
    super(`Shipment ${shipmentId} does not exist`);
    this.name = "ShipmentNotFoundError";
  }
}

const MAX_ATTEMPTS = 5;

/**
 * Record reported events on a shipment. Events it already has are ignored;
 * the rest are applied in the order given (carriers' own order is not
 * trusted for meaning — `applyEvent` orders by time). Each milestone reached
 * and each failed attempt records its Business Event in the same batch, by
 * `author`.
 */
export async function recordShipmentEvents(
  db: AppDb,
  shipmentId: string,
  incoming: readonly IncomingShipmentEvent[],
  author: Author,
): Promise<RecordedEvents> {
  for (let attempt = 1; ; attempt++) {
    const outcome = await attemptRecord(db, shipmentId, incoming, author);
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
  author: Author,
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
  if (fresh.length === 0) return { recorded: 0, duplicates, reached: [], anomalies: [] };

  let facts = deliveryFactsOf(row);
  const reached: Milestone[] = [];
  const anomalies: Anomaly[] = [];
  const now = new Date().toISOString();
  const revision = crypto.randomUUID();
  const guard = sql`exists (select 1 from ${shipments} where ${shipments.id} = ${shipmentId} and ${shipments.revision} = ${revision})`;

  type BatchStatement = Parameters<AppDb["batch"]>[0][number];
  const eventStatements: BatchStatement[] = [];
  const published: BusinessEventDraft[] = [];
  const publish = (draft: { type: typeof MILESTONE_EVENT[Milestone] } | { type: "shipment.delivery_failed"; attempt: number }, event: IncomingShipmentEvent) => {
    const base = { subjectId: shipmentId, orderId: row.orderId, occurredAt: event.occurredAt, ...author };
    const data = { shipment: shipmentSnapshot(shipmentId), order: orderSnapshot(row.orderId), reason: event.reason ?? null };
    published.push(draft.type === "shipment.delivery_failed" ? { ...base, type: draft.type, data: { ...data, attempt: draft.attempt } } : { ...base, type: draft.type, data });
  };
  for (const [key, event] of fresh) {
    const before = facts;
    const step = applyEvent(before, { providerStatus: event.status.value, interpretation: event.interpretation, occurredAt: event.occurredAt });
    facts = step.next;
    reached.push(...step.reached);
    if (step.anomaly) anomalies.push(step.anomaly);
    for (const milestone of step.reached) {
      publish({ type: MILESTONE_EVENT[milestone] }, event);
    }
    if (step.next.deliveryAttempts > before.deliveryAttempts) {
      publish({ type: "shipment.delivery_failed", attempt: step.next.deliveryAttempts }, event);
    }
    const milestone = event.interpretation.kind === "milestone" ? event.interpretation.milestone : null;
    eventStatements.push(
      db.insert(shipmentEvents).select(
        db
          .select(
            insertSelectRow(shipmentEvents, {
              id: sql`${crypto.randomUUID()}`,
              shipmentId: shipments.id,
              source: sql`${event.source}`,
              eventKey: sql`${key}`,
              vocabulary: sql`${event.status.vocabulary}`,
              providerStatus: sql`${event.status.value}`,
              providerStatusLabel: sql`${event.status.label ?? null}`,
              interpretation: sql`${event.interpretation.kind}`,
              milestone: sql`${milestone}`,
              attention: sql`${event.interpretation.kind === "exception" || (event.interpretation.kind === "milestone" && event.interpretation.attention === true) ? 1 : 0}`,
              anomaly: sql`${step.anomaly}`,
              reason: sql`${event.reason ?? null}`,
              occurredAt: sql`${event.occurredAt}`,
              recordedAt: sql`${now}`,
              actorId: sql`${event.actorId ?? null}`,
              webhookEventId: sql`${event.webhookEventId ?? null}`,
              raw: sql`${event.raw === undefined ? null : JSON.stringify(event.raw)}`,
            }),
          )
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
    effects.push(...restockStatements(db, lines, "ORDER_RETURNED", row.orderId, creditOf(author.actor), now, guard));
    if (order) {
      effects.push(
        db
          .update(customers)
          .set({ totalSpent: sql`MAX(0, ${customers.totalSpent} - ${order.price})` })
          .where(and(eq(customers.id, order.customerId), guard)),
      );
    }
  }

  // The Business Events last, so each carries the shipment as this batch leaves it.
  const eventLog = published.map((draft) => recordEvent(db, draft, guard));
  const results = await db.batch([claim, ...eventStatements, ...effects, ...eventLog] as [BatchStatement, ...BatchStatement[]]);
  const claimed = (results[0] as { meta?: { changes?: number } }).meta?.changes ?? 0;
  if (claimed === 0) return "lost_race";

  return { recorded: fresh.length, duplicates, reached, anomalies };
}
