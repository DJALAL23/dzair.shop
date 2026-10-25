/**
 * Reading carrier shipments' histories and recording what is new — the pull
 * side of the inbound pipeline. The merchant's "sync" uses it for one
 * shipment; the scheduled sync of pull-only carriers for many, in batches
 * of what the carrier reads in one call (`historyBatch`).
 */

import type { AppDb } from "@/db";
import { and, desc, eq } from "drizzle-orm";
import { shipmentEvents } from "@/db/schema";
import type { CarrierAdapter, CarrierUpdate } from "@/carriers/contract";
import type { Author } from "../../../../cod-shared/events/actor";
import { recordSynced } from "../../../../cod-shared/shipments/handoff";
import { carrierRefOf, type ShipmentRow } from "../../../../cod-shared/shipments/queries";
import { recordShipmentEvents, type RecordedEvents } from "../../../../cod-shared/shipments/record-events";

type SyncCarrier = Pick<CarrierAdapter, "interpret" | "fetchHistory" | "capabilities">;

/** Sync shipments of one carrier company. A carrier failure stops the call and leaves the rest unstamped. */
/** `author` is the carrier company the facts come from. */
export async function syncShipments(db: AppDb, carrier: SyncCarrier, rows: readonly ShipmentRow[], author: Author): Promise<Map<string, RecordedEvents>> {
  if (!carrier.fetchHistory) throw new Error("This carrier's history cannot be read");
  const recorded = new Map<string, RecordedEvents>();
  const addressable = rows.flatMap((row) => {
    const ref = carrierRefOf(row);
    return ref ? [{ row, ref }] : [];
  });
  const batch = Math.max(1, carrier.capabilities.historyBatch);
  for (let start = 0; start < addressable.length; start += batch) {
    const chunk = addressable.slice(start, start + batch);
    const histories = await carrier.fetchHistory(chunk.map((c) => c.ref));
    for (const { row, ref } of chunk) {
      const updates = await withoutRepeatedSnapshots(db, row.id, histories.get(ref.carrierParcelId) ?? []);
      recorded.set(
        row.id,
        await recordShipmentEvents(
          db,
          row.id,
          updates.map((update) => ({
            source: "pull" as const,
            status: update.status,
            interpretation: carrier.interpret(update.status),
            reason: update.reason,
            occurredAt: update.occurredAt,
            raw: update.raw,
          })),
          author,
        ),
      );
      await recordSynced(db, row.id, updates.map((u) => u.match.trackingNumber).find((t): t is string => !!t) ?? null);
    }
  }
  return recorded;
}

/** A snapshot equal to the last one of its vocabulary says nothing new, and is left out. */
async function withoutRepeatedSnapshots(db: AppDb, shipmentId: string, updates: readonly CarrierUpdate[]): Promise<CarrierUpdate[]> {
  if (!updates.some((update) => update.snapshot)) return [...updates];
  const kept: CarrierUpdate[] = [];
  for (const update of updates) {
    if (update.snapshot) {
      const last = await db
        .select({ value: shipmentEvents.providerStatus })
        .from(shipmentEvents)
        .where(and(eq(shipmentEvents.shipmentId, shipmentId), eq(shipmentEvents.vocabulary, update.status.vocabulary)))
        .orderBy(desc(shipmentEvents.occurredAt), desc(shipmentEvents.recordedAt))
        .limit(1)
        .get();
      if (last?.value === update.status.value) continue;
    }
    kept.push(update);
  }
  return kept;
}

export async function syncShipment(db: AppDb, carrier: SyncCarrier, row: ShipmentRow, author: Author): Promise<RecordedEvents> {
  const recorded = (await syncShipments(db, carrier, [row], author)).get(row.id);
  if (!recorded) throw new Error(`Shipment ${row.id} cannot be synced`);
  return recorded;
}
