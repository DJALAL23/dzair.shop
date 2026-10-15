/**
 * Reading a carrier shipment's history and recording what is new — the pull
 * side of the inbound pipeline. The merchant's "sync" uses it for one
 * shipment; the scheduled sync of pull-only carriers reuses it.
 */

import type { AppDb } from "@/db";
import type { CarrierAdapter } from "@/carriers/contract";
import { recordSynced } from "../../../../cod-shared/shipments/handoff";
import { carrierRefOf, type ShipmentRow } from "../../../../cod-shared/shipments/queries";
import { recordShipmentEvents, type RecordedEvents } from "../../../../cod-shared/shipments/record-events";

export async function syncShipment(
  db: AppDb,
  carrier: Pick<CarrierAdapter, "interpret" | "fetchHistory">,
  row: ShipmentRow,
): Promise<RecordedEvents> {
  const ref = carrierRefOf(row);
  if (!ref || !carrier.fetchHistory) throw new Error(`Shipment ${row.id} cannot be synced`);
  const updates = (await carrier.fetchHistory([ref])).get(ref.carrierParcelId) ?? [];
  const recorded = await recordShipmentEvents(
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
  );
  const trackingNumber = updates.map((u) => u.match.trackingNumber).find((t): t is string => !!t) ?? null;
  await recordSynced(db, row.id, trackingNumber);
  return recorded;
}
