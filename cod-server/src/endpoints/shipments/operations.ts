/**
 * What the merchant does to a shipment after the handoff. Each operation is
 * refused up front by the same rules that list the shipment's actions
 * (`actions.ts`) — before any credential is read or any carrier is called —
 * then asks the carrier, and only records what the carrier accepted.
 */

import { eq } from "drizzle-orm";
import type { AppDb } from "@/db";
import { orders } from "@/db/schema";
import type { StaffActor } from "@/types";
import { carrierAuthor, type Acting } from "@/lib/acting";
import { ConflictError, NotFoundError, BusinessLogicError, ValidationError } from "@/lib/errors/classes";
import { ACTIONS, logActivity } from "@/lib/activity";
import { assertOrderAddress } from "@/lib/order-address";
import { callCarrier } from "@/carriers/app-errors";
import { loggedCarrierCall } from "@/carriers/call-log";
import { CarrierError, type CarrierAdapter, type CarrierCapabilities, type CarrierLabel, type CarrierRef, type CarrierRemark, type CarrierShipmentPatch } from "@/carriers/contract";
import { carrierCapabilities } from "@/carriers/registry";
import { ERROR_CODES } from "../../../../cod-shared/errors/codes";
import { getDeliveryCompanyRaw } from "../../../../cod-shared/queries/delivery-companies";
import { carrierPlacesOf, costAt } from "../../../../cod-shared/carriers/places";
import { updateOrder } from "../../../../cod-shared/queries/orders";
import { markValidated, noteShipmentStep, recordParcelEdit, voidShipment } from "../../../../cod-shared/shipments/handoff";
import { checkMerchantReport, interpretMerchantReport, type MerchantReport } from "../../../../cod-shared/shipments/merchant-reports";
import { carrierRefOf, deliveryFactsOf, getShipment, type ShipmentRow } from "../../../../cod-shared/shipments/queries";
import { recordShipmentEvents, type RecordedEvents } from "../../../../cod-shared/shipments/record-events";
import type { ShipmentAction } from "./actions";
import { connectedCarrier, placeRefusal, type DeliveryCompanyRow } from "./carrier-handoff";
import { actionRefusal, requireAction, requireKindScope } from "./guard";
import { syncShipment } from "./sync";

// ─── Loading a shipment for an operation ─────────────────────────────────────

interface Target {
  row: ShipmentRow;
  company: DeliveryCompanyRow | null;
  capabilities: CarrierCapabilities | null;
  context: { shipmentId: string; orderId: string; companyId?: string };
}

/** The shipment, refused unless the action is open to it — and, when `as` is given, to this person on this kind of shipment. */
async function target(db: AppDb, shipmentId: string, action: ShipmentAction, as?: { actor: StaffActor; what: string }): Promise<Target> {
  const row = await getShipment(db, shipmentId);
  if (!row) throw new NotFoundError("Shipment", shipmentId);
  if (as) requireKindScope(as.actor, row.kind, as.what);
  const company = row.companyId ? ((await getDeliveryCompanyRaw(db, row.companyId)) ?? null) : null;
  const capabilities = company ? carrierCapabilities(company) : null;
  requireAction(row, capabilities, action);
  return { row, company, capabilities, context: { shipmentId, orderId: row.orderId, ...(company ? { companyId: company.id } : {}) } };
}

interface CarrierTarget extends Target {
  company: DeliveryCompanyRow;
  carrier: CarrierAdapter;
  ref: CarrierRef;
}

async function carrierTarget(db: AppDb, shipmentId: string, action: ShipmentAction): Promise<CarrierTarget> {
  return carrierTargetOf(await target(db, shipmentId, action), shipmentId, action);
}

async function carrierTargetOf(found: Target, shipmentId: string, action: ShipmentAction): Promise<CarrierTarget> {
  const ref = carrierRefOf(found.row);
  if (!found.company || !ref) throw new Error(`Shipment ${shipmentId} passed "${action}" without a carrier parcel`);
  return { ...found, company: found.company, ref, carrier: await connectedCarrier(found.company) };
}

/** Ask the carrier; record the call; a carrier failure leaves as its API error. */
function ask<T>(db: AppDb, t: CarrierTarget, operation: string, call: () => Promise<T>): Promise<T> {
  return callCarrier(t.context, () => loggedCarrierCall(db, { companyId: t.company.id, orderId: t.row.orderId, operation }, call));
}

/** The staff member a shipment's own history credits a step to, if any. */
const staffIdOf = (acting: Acting) => acting.staff?.id ?? null;

// ─── Operations ──────────────────────────────────────────────────────────────

/** Validate a parcel the carrier holds until it is validated. */
export async function validateShipment(db: AppDb, shipmentId: string, options: { requestPickup?: boolean }, acting: Acting): Promise<void> {
  const t = await carrierTarget(db, shipmentId, "validate");
  await ask(db, t, "validate", () => t.carrier.validate!(t.ref, options));
  await markValidated(db, shipmentId, staffIdOf(acting));
}

export interface ParcelChanges {
  customerName?: string;
  phone?: string;
  address?: string;
  wilayaId?: number;
  communeId?: string;
  /** The cash to collect. */
  amount?: number;
  weight?: number;
  fragile?: boolean;
  remarks?: string;
}

/**
 * Edit the parcel at the carrier, then record it — the order's contact and
 * destination (with its customer, as an order edit does) and the shipment's
 * cash, weight and fragility. The carrier is always sent the full delivery
 * details with the changes applied: some replace them as a whole.
 */
export async function updateParcel(db: AppDb, shipmentId: string, changes: ParcelChanges, acting: Acting): Promise<void> {
  const fields = Object.entries(changes).filter(([, v]) => v !== undefined).map(([k]) => k);
  if (fields.length === 0) throw new ValidationError("Nothing to change", ERROR_CODES.VALIDATION_FAILED);
  const t = await carrierTarget(db, shipmentId, "update");
  const caps = t.carrier.capabilities;
  for (const [field, taken] of [["weight", caps.parcelFields.weight], ["fragile", caps.parcelFields.fragile], ["remarks", caps.parcelFields.remarks]] as const) {
    if (changes[field] !== undefined && !taken) {
      throw new BusinessLogicError(`${t.company.name} does not take a parcel's ${field}`, ERROR_CODES.OPERATION_NOT_SUPPORTED, { ...t.context, field });
    }
  }
  if ((changes.wilayaId === undefined) !== (changes.communeId === undefined)) {
    throw new ValidationError("A new destination needs both the wilaya and the commune", ERROR_CODES.MISSING_WILAYA_COMMUNE, t.context);
  }

  const order = await db
    .select({ orderNumber: orders.orderNumber, customerName: orders.customerName, phone: orders.phone, address: orders.address, wilayaId: orders.wilayaId, communeId: orders.communeId })
    .from(orders)
    .where(eq(orders.id, t.row.orderId))
    .get();
  if (!order) throw new NotFoundError("Order", t.row.orderId);
  await assertOrderAddress(db, { wilayaId: changes.wilayaId, communeId: changes.communeId }, t.context);

  const wilayaId = changes.wilayaId ?? order.wilayaId;
  const communeId = changes.communeId ?? order.communeId;
  const address = (changes.address ?? order.address ?? "").trim();
  if (t.row.deliveryType === "home" && !address) {
    throw new ValidationError("A home delivery needs a street address", ERROR_CODES.MISSING_ADDRESS, t.context);
  }
  if (!wilayaId || !communeId) throw new ValidationError("The order needs a wilaya and a commune", ERROR_CODES.MISSING_WILAYA_COMMUNE, t.context);
  const place = (await carrierPlacesOf(db, t.company.id, [communeId])).get(communeId);
  const deliveryType = t.row.deliveryType === "stop_desk" ? "stop_desk" : "home";
  const refusal = placeRefusal(t.company, communeId, place, deliveryType, t.context);
  if (refusal) throw refusal;

  const patch: CarrierShipmentPatch = {
    reference: order.orderNumber,
    customerName: changes.customerName ?? order.customerName,
    phone: changes.phone ?? order.phone,
    address,
    destination: { wilaya: place!.wilaya, commune: place!.commune },
    amount: changes.amount ?? t.row.codAmount,
    ...(changes.remarks !== undefined ? { remarks: changes.remarks } : {}),
    ...(caps.parcelFields.weight && (changes.weight ?? t.row.weight) != null ? { weight: (changes.weight ?? t.row.weight)! } : {}),
    ...(caps.parcelFields.fragile && (changes.fragile ?? t.row.isFragile) != null ? { fragile: (changes.fragile ?? t.row.isFragile)! } : {}),
  };
  await ask(db, t, "update", () => t.carrier.update!(t.ref, patch));

  const orderFields = {
    customerName: changes.customerName,
    phone: changes.phone,
    address: changes.address,
    wilayaId: changes.wilayaId,
    communeId: changes.communeId,
  };
  if (Object.values(orderFields).some((v) => v !== undefined)) await updateOrder(db, t.row.orderId, orderFields, acting.author, { throughShipment: true });
  await recordParcelEdit(
    db,
    shipmentId,
    {
      ...(changes.amount !== undefined ? { codAmount: changes.amount } : {}),
      ...(changes.weight !== undefined ? { weight: changes.weight } : {}),
      ...(changes.fragile !== undefined ? { isFragile: changes.fragile } : {}),
      ...(changes.communeId !== undefined && changes.communeId !== order.communeId ? costAt(place!, deliveryType) : {}),
    },
    { fields, actorId: staffIdOf(acting) },
  );
}

/**
 * Undo a shipment that never reached the customer, so the order can be
 * handed off again: the carrier cancels the parcel first (unless it already
 * did); a driver's shipment has no carrier to ask.
 */
export async function voidShipmentOperation(db: AppDb, shipmentId: string, acting: Acting & { staff: StaffActor }): Promise<{ orderId: string }> {
  const t = await target(db, shipmentId, "void", { actor: acting.staff, what: "Voiding" });
  const ref = carrierRefOf(t.row);
  if (t.row.kind === "carrier" && !t.row.cancelledAt && t.company && ref) {
    const withCarrier: CarrierTarget = { ...t, company: t.company, ref, carrier: await connectedCarrier(t.company) };
    await ask(db, withCarrier, "cancel", () => withCarrier.carrier.cancel!(ref));
  }
  const outcome = await voidShipment(db, shipmentId, acting.author);
  if (!outcome.ok) {
    if (outcome.code === ERROR_CODES.SHIPMENT_NOT_FOUND) throw new NotFoundError("Shipment", shipmentId);
    throw actionRefusal({ ok: false, code: outcome.code, reason: "The shipment changed meanwhile and can no longer be voided" }, t.context);
  }
  await logActivity(db, acting.staff, ACTIONS.SHIPMENT_VOIDED, { type: "order", id: t.row.orderId }, {
    shipmentId,
    kind: t.row.kind,
    companyId: t.row.companyId,
    driverId: t.row.driverId,
    trackingNumber: t.row.trackingNumber,
  });
  return { orderId: outcome.orderId };
}

export async function listRemarks(db: AppDb, shipmentId: string): Promise<CarrierRemark[]> {
  const t = await carrierTarget(db, shipmentId, "listRemarks");
  return ask(db, t, "listRemarks", () => t.carrier.listRemarks!(t.ref));
}

export async function addRemark(db: AppDb, shipmentId: string, content: string, acting: Acting): Promise<void> {
  const t = await carrierTarget(db, shipmentId, "addRemark");
  await ask(db, t, "addRemark", () => t.carrier.addRemark!(t.ref, content));
  await noteShipmentStep(db, shipmentId, "remark_added", { source: "merchant", reason: content, actorId: staffIdOf(acting) });
}

/** A request the courier may decline: noted, never a milestone. */
export async function askReturn(db: AppDb, shipmentId: string, acting: Acting): Promise<void> {
  const t = await carrierTarget(db, shipmentId, "askReturn");
  await ask(db, t, "askReturn", () => t.carrier.askReturn!(t.ref));
  await noteShipmentStep(db, shipmentId, "return_requested", { source: "merchant", actorId: staffIdOf(acting) });
}

/** A request for another delivery attempt: noted, never a milestone. */
export async function requestNewAttempt(db: AppDb, shipmentId: string, acting: Acting): Promise<void> {
  const t = await carrierTarget(db, shipmentId, "requestNewAttempt");
  await ask(db, t, "requestNewAttempt", () => t.carrier.requestNewAttempt!(t.ref));
  await noteShipmentStep(db, shipmentId, "new_attempt_requested", { source: "merchant", actorId: staffIdOf(acting) });
}

/**
 * Confirm at the carrier that the returned goods reached the merchant, then
 * record the return — which puts the goods back in stock.
 */
export async function confirmReturn(db: AppDb, shipmentId: string, acting: Acting): Promise<RecordedEvents> {
  const t = await carrierTarget(db, shipmentId, "confirmReturn");
  const confirmed = await ask(db, t, "confirmReturn", () => t.carrier.confirmReturn!([t.ref]));
  if (!confirmed) {
    throw new ConflictError(
      "The carrier has nothing to confirm for this parcel: it is not in a return yet, or the return was already confirmed",
      ERROR_CODES.SHIPMENT_ACTION_NOT_AVAILABLE,
      t.context,
    );
  }
  return recordShipmentEvents(db, shipmentId, [
    {
      source: "merchant",
      status: { vocabulary: "merchant", value: "return_received" },
      interpretation: { kind: "milestone", milestone: "returned" },
      occurredAt: new Date().toISOString(),
      actorId: staffIdOf(acting),
    },
  ], acting.author);
}

/** Read the carrier's history now and record what is new. */
export async function syncOne(db: AppDb, shipmentId: string): Promise<RecordedEvents> {
  const t = await carrierTarget(db, shipmentId, "sync");
  return callCarrier(t.context, () =>
    loggedCarrierCall(db, { companyId: t.company.id, orderId: t.row.orderId, operation: "fetchHistory" }, () => syncShipment(db, t.carrier, t.row, carrierAuthor(t.company, "carrier_sync"))),
  );
}

/** The label, fetched for the merchant — carrier labels sit behind credentials or expiring links. */
export async function shipmentLabel(db: AppDb, shipmentId: string): Promise<{ body: ArrayBuffer | ReadableStream; contentType: string; name: string }> {
  const found = await target(db, shipmentId, "label");
  if (found.row.kind === "driver") {
    throw new BusinessLogicError("The store's driver has no carrier label: print it from POST /shipping-labels", ERROR_CODES.OPERATION_NOT_SUPPORTED, { shipmentId });
  }
  const t = await carrierTargetOf(found, shipmentId, "label");
  const label: CarrierLabel = await ask(db, t, "label", () => t.carrier.label!(t.ref));
  const name = `label-${t.row.trackingNumber ?? t.row.carrierParcelId}.pdf`;
  if (label.kind === "pdf") return { body: label.body, contentType: "application/pdf", name };
  const response = await callCarrier(t.context, async () => {
    try {
      const res = await fetch(label.url, { redirect: "follow", signal: AbortSignal.timeout(15_000) });
      if (!res.ok || !res.body) throw new CarrierError(t.carrier.provider, "unavailable", `The label link answered HTTP ${res.status}`, { httpStatus: res.status });
      return res;
    } catch (error) {
      if (error instanceof CarrierError) throw error;
      throw new CarrierError(t.carrier.provider, "unavailable", `The label could not be fetched (${(error as Error)?.message ?? error})`);
    }
  });
  return { body: response.body!, contentType: response.headers.get("content-type") ?? "application/pdf", name };
}

// ─── What the merchant reports ───────────────────────────────────────────────

export interface MerchantReportInput {
  status: MerchantReport;
  reason?: string;
  /** When it happened, if not now; never in the future. */
  occurredAt?: string;
}

const CLOCK_SKEW_MS = 5 * 60_000;

/**
 * Record what the merchant saw: a driver's progress (any driver status), or
 * on a carrier shipment only that the goods came back. Reporting for a
 * carrier is a dispatch permission; for a driver, an assignment permission.
 */
export async function reportShipmentEvent(db: AppDb, shipmentId: string, report: MerchantReportInput, acting: Acting & { staff: StaffActor }): Promise<RecordedEvents> {
  const t = await target(db, shipmentId, "report", { actor: acting.staff, what: "Reporting on" });
  const verdict = checkMerchantReport({ kind: t.row.kind, handoffState: t.row.handoffState, delivery: deliveryFactsOf(t.row) }, report.status);
  if (!verdict.ok) {
    const reason = verdict.code === ERROR_CODES.SHIPMENT_REPORT_NOT_ALLOWED ? "Only the carrier can report that; a merchant may only attest the goods came back" : "The shipment is closed";
    throw actionRefusal({ ok: false, code: verdict.code, reason }, { ...t.context, status: report.status });
  }

  const occurredAt = report.occurredAt ? new Date(report.occurredAt) : new Date();
  if (Number.isNaN(occurredAt.getTime()) || occurredAt.getTime() > Date.now() + CLOCK_SKEW_MS || occurredAt.toISOString() < t.row.createdAt) {
    throw new ValidationError("occurredAt must be a time between the handoff and now", ERROR_CODES.VALIDATION_FAILED, t.context);
  }
  return recordShipmentEvents(db, shipmentId, [
    {
      source: "merchant",
      status: { vocabulary: t.row.kind === "driver" ? "driver" : "merchant", value: report.status },
      interpretation: interpretMerchantReport(report.status),
      reason: report.reason ?? null,
      occurredAt: occurredAt.toISOString(),
      actorId: acting.staff.id,
    },
  ], acting.author);
}
