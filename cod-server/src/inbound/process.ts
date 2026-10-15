/**
 * Processing the inbox: each stored carrier event becomes, at most once, a
 * recorded shipment event (plan §5.5).
 *
 *   read      — the provider's reader says what the event is: a delivery
 *               update, a parcel created for our order number (which settles
 *               an unknown handoff), a money event (kept for settlement), or
 *               nothing;
 *   match     — the shipment, by the carrier's parcel id, then tracking
 *               number, then our order number, within the company;
 *   resolve   — an update for a handoff whose outcome was unknown proves the
 *               parcel exists: the handoff is accepted;
 *   interpret — the company's adapter (its own settings, e.g. ZR's status map);
 *   record    — `recordShipmentEvents`, linked to the inbox event.
 *
 * An event whose processing throws is retried with backoff, then kept as a
 * dead letter. The milestones it reached are returned for conversions.
 */

import { eq } from "drizzle-orm";
import type { AppDb } from "@/db";
import { getDb } from "@/db";
import type { Env } from "@/types";
import { buildCarrier, carrierWebhook } from "@/carriers/registry";
import { scheduleShipmentConversions, type WaitUntil } from "@/lib/conversions";
import { deliveryCompanies } from "@/db/schema";
import { claimInboxEvent, failInboxEvent, settleInboxEvent, type InboxResult } from "../../../cod-shared/inbound/inbox";
import { acceptCarrierHandoff, adoptCarrierIdentity } from "../../../cod-shared/shipments/handoff";
import { findCarrierShipment } from "../../../cod-shared/shipments/queries";
import { recordShipmentEvents, type ShipmentBusinessEvent } from "../../../cod-shared/shipments/record-events";

export interface InboxOutcome {
  id: string;
  /** `skipped` when another pass holds the event, or it is not due. */
  result: InboxResult | "skipped";
  businessEvents: ShipmentBusinessEvent[];
}

const nothing = (id: string, result: InboxOutcome["result"]): InboxOutcome => ({ id, result, businessEvents: [] });

export async function processInboxEvent(db: AppDb, id: string, now = new Date()): Promise<InboxOutcome> {
  const row = await claimInboxEvent(db, id, now);
  if (!row) return nothing(id, "skipped");
  try {
    const company = await db.select().from(deliveryCompanies).where(eq(deliveryCompanies.id, row.companyId)).get();
    if (!company?.provider) throw new Error(`Company ${row.companyId} has no carrier adapter`);
    const webhook = carrierWebhook(company.provider);
    if (!webhook) throw new Error(`${company.provider} has no webhook reader`);

    const reading = webhook.read({ eventId: row.eventId, eventType: row.eventType, payload: row.rawPayload });
    if (reading.kind === "settlement") {
      await settleInboxEvent(db, id, "deferred_settlement");
      return nothing(id, "deferred_settlement");
    }
    if (reading.kind === "ignored") {
      await settleInboxEvent(db, id, "ignored", { reason: reading.reason });
      return nothing(id, "ignored");
    }

    if (reading.kind === "created") {
      const { parcel } = reading;
      const shipment = await findCarrierShipment(db, company.id, { carrierParcelId: parcel.carrierParcelId, trackingNumber: parcel.trackingNumber ?? undefined, reference: reading.reference });
      if (!shipment) {
        await settleInboxEvent(db, id, "unmatched", { tracking: parcel.trackingNumber });
        return nothing(id, "unmatched");
      }
      if (shipment.handoffState === "submitting") throw new Error("The handoff of this parcel is still being settled");
      if (shipment.handoffState === "accepted") {
        await settleInboxEvent(db, id, "ignored", { shipmentId: shipment.id, tracking: parcel.trackingNumber, reason: "creation already recorded" });
        return nothing(id, "ignored");
      }
      const carrier = buildCarrier(company);
      await acceptCarrierHandoff(db, shipment.id, parcel, { validated: !carrier.capabilities.separateValidation, source: "system" });
      await settleInboxEvent(db, id, "ok", { shipmentId: shipment.id, tracking: parcel.trackingNumber, reason: "unknown handoff found by the carrier's creation event" });
      return nothing(id, "ok");
    }

    const { update } = reading;
    const tracking = update.match.trackingNumber ?? null;
    const shipment = await findCarrierShipment(db, company.id, update.match);
    if (!shipment) {
      await settleInboxEvent(db, id, "unmatched", { tracking, reason: update.reason });
      return nothing(id, "unmatched");
    }
    // The carrier is being called for this parcel right now: let that settle first.
    if (shipment.handoffState === "submitting") throw new Error("The handoff of this parcel is still being settled");

    const carrier = buildCarrier(company);
    if (shipment.handoffState === "unknown" && update.match.carrierParcelId) {
      await acceptCarrierHandoff(
        db,
        shipment.id,
        { carrierParcelId: update.match.carrierParcelId, trackingNumber: tracking, carrierData: null, labelUrl: null },
        { validated: !carrier.capabilities.separateValidation, source: "system" },
      );
    }
    await adoptCarrierIdentity(db, shipment.id, update.match);

    const interpretation = carrier.interpret(update.status);
    const recorded = await recordShipmentEvents(db, shipment.id, [
      {
        source: "webhook",
        status: update.status,
        interpretation,
        reason: update.reason,
        occurredAt: update.occurredAt,
        webhookEventId: row.id,
        raw: update.raw,
      },
    ]);
    const result = interpretation.kind === "unknown" ? "unknown_status" : "ok";
    await settleInboxEvent(db, id, result, { shipmentId: shipment.id, tracking: tracking ?? shipment.trackingNumber, reason: update.reason });
    return { id, result, businessEvents: recorded.businessEvents };
  } catch (error) {
    const result = await failInboxEvent(db, row, (error as Error)?.message ?? String(error), now);
    console.error(`[inbound] event ${id} (${row.provider} ${row.eventType}) failed, attempt ${row.attempts}: ${(error as Error)?.message}`);
    return nothing(id, result);
  }
}

/** Process inbox events in order, then schedule the conversions their milestones call for. */
export async function processInbox(env: Env, waitUntil: WaitUntil, ids: readonly string[]): Promise<InboxOutcome[]> {
  const db = getDb(env.DB);
  const outcomes: InboxOutcome[] = [];
  for (const id of ids) outcomes.push(await processInboxEvent(db, id));
  await scheduleShipmentConversions(env, waitUntil, db, outcomes.flatMap((o) => o.businessEvents));
  return outcomes;
}
