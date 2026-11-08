/**
 * A shipment as the API shows it: its facts, its history, and what can be
 * done to it now. Internal bookkeeping (the revision token, the carrier's
 * opaque data, raw payloads) never leaves the server.
 */

import { eq } from "drizzle-orm";
import type { AppDb } from "@/db";
import { deliveryCompanies } from "@/db/schema";
import type { CarrierCapabilities } from "@/carriers/contract";
import { carrierCapabilities } from "@/carriers/registry";
import { NotFoundError } from "@/lib/errors/classes";
import {
  getShipment,
  getShipmentWithEvents,
  type ShipmentEventRow,
  type ShipmentRow,
} from "../../../../cod-shared/shipments/queries";
import { availableActions } from "./actions";
import { subjectOf } from "./guard";

function eventView(event: ShipmentEventRow) {
  return {
    id: event.id,
    source: event.source,
    vocabulary: event.vocabulary,
    providerStatus: event.providerStatus,
    providerStatusLabel: event.providerStatusLabel,
    interpretation: event.interpretation,
    milestone: event.milestone,
    attention: event.attention,
    anomaly: event.anomaly,
    reason: event.reason,
    occurredAt: event.occurredAt,
    recordedAt: event.recordedAt,
    actorId: event.actorId,
  };
}

/** The company carrying a carrier shipment, as its view needs it. */
export interface ShipmentCarrier {
  name: string;
  capabilities: CarrierCapabilities | null;
}

export function shipmentView(row: ShipmentRow, carrier: ShipmentCarrier | null, events?: ShipmentEventRow[]) {
  return {
    id: row.id,
    orderId: row.orderId,
    kind: row.kind,
    companyId: row.companyId,
    carrierName: carrier?.name ?? null,
    driverId: row.driverId,
    handoffState: row.handoffState,
    carrierParcelId: row.carrierParcelId,
    trackingNumber: row.trackingNumber,
    deliveryType: row.deliveryType,
    stationCode: row.stationCode,
    codAmount: row.codAmount,
    driverFee: row.driverFee,
    shippingCost: row.shippingCost,
    returnFee: row.returnFee,
    weight: row.weight,
    isFragile: row.isFragile,
    providerStatus: row.providerStatus,
    providerStatusLabel: row.providerStatusLabel,
    providerStatusKind: row.providerStatusKind,
    providerStatusAt: row.providerStatusAt,
    validatedAt: row.validatedAt,
    outForDeliveryAt: row.outForDeliveryAt,
    deliveredAt: row.deliveredAt,
    returnStartedAt: row.returnStartedAt,
    returnedAt: row.returnedAt,
    cancelledAt: row.cancelledAt,
    deliveryAttempts: row.deliveryAttempts,
    attentionSince: row.attentionSince,
    lastSyncedAt: row.lastSyncedAt,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    actions: availableActions(subjectOf(row), carrier?.capabilities ?? null),
    ...(events ? { events: events.map(eventView) } : {}),
  };
}

export type ShipmentView = ReturnType<typeof shipmentView>;

/** The company behind a shipment, with what its carrier can do; null for a driver's. */
export async function carrierFor(db: AppDb, row: Pick<ShipmentRow, "companyId">): Promise<ShipmentCarrier | null> {
  if (!row.companyId) return null;
  const company = await db
    .select({ name: deliveryCompanies.name, provider: deliveryCompanies.provider, providerConfig: deliveryCompanies.providerConfig })
    .from(deliveryCompanies)
    .where(eq(deliveryCompanies.id, row.companyId))
    .get();
  return company ? { name: company.name, capabilities: carrierCapabilities(company) } : null;
}

export async function loadShipmentView(db: AppDb, shipmentId: string, options: { events: boolean }): Promise<ShipmentView> {
  const row = options.events ? await getShipmentWithEvents(db, shipmentId) : await getShipment(db, shipmentId);
  if (!row) throw new NotFoundError("Shipment", shipmentId);
  const events = "events" in row ? (row.events as ShipmentEventRow[]) : undefined;
  return shipmentView(row, await carrierFor(db, row), events);
}
