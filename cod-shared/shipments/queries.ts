/**
 * Reading shipments: one place for how a shipment is found, and how a
 * carrier's update is matched to the shipment it is about.
 */

import { and, asc, eq } from "drizzle-orm";
import type { AppDb } from "../db/client";
import { orders, shipmentEvents, shipments } from "../db/schema";

export type ShipmentRow = typeof shipments.$inferSelect;
export type ShipmentEventRow = typeof shipmentEvents.$inferSelect;

export function getShipment(db: AppDb, shipmentId: string): Promise<ShipmentRow | undefined> {
  return db.select().from(shipments).where(eq(shipments.id, shipmentId)).get();
}

export function getOrderShipment(db: AppDb, orderId: string): Promise<ShipmentRow | undefined> {
  return db.select().from(shipments).where(eq(shipments.orderId, orderId)).get();
}

/** A shipment with its history, oldest first. */
export async function getShipmentWithEvents(
  db: AppDb,
  shipmentId: string,
): Promise<(ShipmentRow & { events: ShipmentEventRow[] }) | null> {
  const shipment = await getShipment(db, shipmentId);
  if (!shipment) return null;
  const events = await db
    .select()
    .from(shipmentEvents)
    .where(eq(shipmentEvents.shipmentId, shipmentId))
    .orderBy(asc(shipmentEvents.occurredAt), asc(shipmentEvents.recordedAt))
    .all();
  return { ...shipment, events };
}

/** How an update names its parcel; adapters fill what the carrier sends. */
export interface ParcelMatch {
  carrierParcelId?: string;
  trackingNumber?: string;
  /** Our reference — the order number the carrier was given. */
  reference?: string;
}

/**
 * The carrier shipment an update is about, at this company: by the carrier's
 * stable parcel id first, then its tracking number (which some carriers
 * change), then our order number. Null when none matches.
 */
export async function findCarrierShipment(db: AppDb, companyId: string, match: ParcelMatch): Promise<ShipmentRow | null> {
  const atCompany = (condition: ReturnType<typeof eq>) => and(eq(shipments.companyId, companyId), condition);
  if (match.carrierParcelId) {
    const row = await db.select().from(shipments).where(atCompany(eq(shipments.carrierParcelId, match.carrierParcelId))).get();
    if (row) return row;
  }
  if (match.trackingNumber) {
    const row = await db.select().from(shipments).where(atCompany(eq(shipments.trackingNumber, match.trackingNumber))).get();
    if (row) return row;
  }
  if (match.reference) {
    const row = await db
      .select({ shipment: shipments })
      .from(shipments)
      .innerJoin(orders, eq(orders.id, shipments.orderId))
      .where(atCompany(eq(orders.orderNumber, match.reference)))
      .get();
    if (row) return row.shipment;
  }
  return null;
}

/** What a carrier adapter needs to address the parcel. */
export function carrierRefOf(row: ShipmentRow): { carrierParcelId: string; trackingNumber: string | null; carrierData: unknown } | null {
  if (!row.carrierParcelId) return null;
  let carrierData: unknown = null;
  if (row.carrierData) {
    try {
      carrierData = JSON.parse(row.carrierData);
    } catch {
      carrierData = null;
    }
  }
  return { carrierParcelId: row.carrierParcelId, trackingNumber: row.trackingNumber, carrierData };
}
