/**
 * Handing orders to a carrier — the one path, for one order or a hundred
 * (ADR 0006, plan §5.4).
 *
 *   1. prepare  — every check that needs no carrier: the order is ready and
 *                 has no shipment, the address is complete, the carrier and
 *                 this company offer the delivery type, the value is under
 *                 the carrier's ceiling. A refusal here reserves nothing.
 *   2. reserve  — the shipment row is written before the carrier is called;
 *                 a second dispatch of the same order stops here.
 *   3. create   — one bulk call when the carrier has one and there are
 *                 several parcels, otherwise one call per parcel.
 *   4. settle   — per parcel, by what the carrier's answer proves:
 *        created                           → accepted (and validated, when the
 *                                            company asks and the carrier needs it);
 *        refused, credentials, throttled,
 *        not reached, misconfigured        → the reservation goes, the order is ready again;
 *        anything that may have created it → unknown, resolved later — never re-sent.
 *
 * Single and bulk handoffs share every step, so the same order and company
 * give the same result through either route.
 */

import { eq, inArray } from "drizzle-orm";
import type { AppDb } from "@/db";
import { communes, deliveryCompanies, orderProducts, orders, productVariants, shipments, wilayas } from "@/db/schema";
import { AppError, BusinessLogicError, ConflictError, NotFoundError, ValidationError } from "@/lib/errors/classes";
import { ACTIONS, logActivity } from "@/lib/activity";
import type { AuthUser } from "@/types";
import { CarrierRequestError, callCarrier } from "@/carriers/app-errors";
import { loggedCarrierCall } from "@/carriers/call-log";
import { CarrierError, type CarrierAdapter, type CarrierBulkItem, type CarrierParcel, type CarrierShipmentInput } from "@/carriers/contract";
import { buildCarrier, carrierCapabilities } from "@/carriers/registry";
import { getDeliveryCompanyRaw } from "../../../../cod-shared/queries/delivery-companies";
import { findCarrierShipment, getShipment } from "../../../../cod-shared/shipments/queries";
import { requireAction } from "./guard";
import { ERROR_CODES } from "../../../../cod-shared/errors/codes";
import { checkHandoff, type OrderStatus } from "../../../../cod-shared/orders/lifecycle";
import { resolveCarrierCommuneNames, resolveCarrierWilayaName } from "../../../../cod-shared/queries/carrier-geo";
import {
  acceptCarrierHandoff,
  discardReservation,
  markHandoffUnknown,
  markValidated,
  noteShipmentStep,
  releaseUnknownHandoff,
  reserveCarrierShipment,
  type ReservationRefusal,
} from "../../../../cod-shared/shipments/handoff";
import type { ShipmentEventSource } from "../../../../cod-shared/shipments/model";
import { buildProductDescription, DEFAULT_MAX_DESCRIPTION, exceedsAmountCeiling, sumParcelWeight } from "./parcel-limits";

export type DeliveryCompanyRow = typeof deliveryCompanies.$inferSelect;
type DeliveryType = "home" | "stop_desk";

/** What the merchant chose for this parcel; anything left out comes from the order. */
export interface HandoffRequest {
  orderId: string;
  deliveryType?: DeliveryType;
  stationCode?: string;
  weight?: number;
  fragile?: boolean;
  remarks?: string;
}

export type HandoffResult =
  | {
      orderId: string;
      orderNumber: string;
      outcome: "accepted";
      shipmentId: string;
      trackingNumber: string | null;
      validated: boolean;
      /** The carrier created the parcel but refused to validate it; the merchant can retry. */
      validationError: string | null;
    }
  | { orderId: string; orderNumber: string; outcome: "unknown"; shipmentId: string; message: string }
  | { orderId: string; orderNumber: string | null; outcome: "refused"; error: AppError };

/** A handoff that reached the carrier: its parcel is recorded, or its outcome is unknown. */
export type SettledHandoff = Extract<HandoffResult, { outcome: "accepted" | "unknown" }>;

/** Carrier failures that prove the parcel was not created. */
const NOT_CREATED: ReadonlySet<CarrierError["kind"]> = new Set(["rejected", "auth", "rate_limited", "unavailable", "misconfigured"]);

// ─── The company ──────────────────────────────────────────────────────────────

/** The company's adapter, or the reason it cannot take parcels — which refuses the whole handoff. */
export function carrierFor(company: DeliveryCompanyRow): Promise<CarrierAdapter> {
  const context = { companyId: company.id, code: company.code };
  if (!company.active) {
    throw new BusinessLogicError(`${company.name} is inactive`, ERROR_CODES.COMPANY_INACTIVE, context);
  }
  if (!company.apiToken) {
    throw new ValidationError(`${company.name} is not connected — add API credentials first`, ERROR_CODES.MISSING_API_CREDENTIALS, context);
  }
  return callCarrier(context, () => buildCarrier(company));
}

// ─── 1. Prepare ───────────────────────────────────────────────────────────────

type OrderRow = Pick<
  typeof orders.$inferSelect,
  | "id"
  | "orderNumber"
  | "status"
  | "customerName"
  | "phone"
  | "address"
  | "wilayaId"
  | "communeId"
  | "deliveryType"
  | "stationCode"
  | "price"
  | "deliveryFee"
  | "notes"
  | "weight"
  | "isFragile"
>;

interface Prepared {
  request: HandoffRequest;
  order: OrderRow;
  input: CarrierShipmentInput;
  deliveryType: DeliveryType;
  stationCode: string | null;
  weight: number | null;
  fragile: boolean | null;
}

type OrderLine = { productName: string; variantId: string | null; quantity: number };

interface HandoffData {
  orders: Map<string, OrderRow>;
  lines: Map<string, OrderLine[]>;
  withShipment: Set<string>;
  wilayaNames: Map<number, string>;
  communeNames: Map<string, string>;
  carrierCommuneNames: Map<string, string>;
  variantWeights: Map<string, number | null>;
}

async function loadHandoffData(db: AppDb, company: DeliveryCompanyRow, carrier: CarrierAdapter, orderIds: string[]): Promise<HandoffData> {
  const [orderRows, lineRows, shipmentRows, wilayaRows] = await db.batch([
    db
      .select({
        id: orders.id,
        orderNumber: orders.orderNumber,
        status: orders.status,
        customerName: orders.customerName,
        phone: orders.phone,
        address: orders.address,
        wilayaId: orders.wilayaId,
        communeId: orders.communeId,
        deliveryType: orders.deliveryType,
        stationCode: orders.stationCode,
        price: orders.price,
        deliveryFee: orders.deliveryFee,
        notes: orders.notes,
        weight: orders.weight,
        isFragile: orders.isFragile,
      })
      .from(orders)
      .where(inArray(orders.id, orderIds)),
    db
      .select({ orderId: orderProducts.orderId, productName: orderProducts.productName, variantId: orderProducts.variantId, quantity: orderProducts.quantity })
      .from(orderProducts)
      .where(inArray(orderProducts.orderId, orderIds)),
    db.select({ orderId: shipments.orderId }).from(shipments).where(inArray(shipments.orderId, orderIds)),
    db.select({ id: wilayas.id, name: wilayas.name }).from(wilayas),
  ]);

  const lines = new Map<string, OrderLine[]>();
  for (const line of lineRows) lines.set(line.orderId, [...(lines.get(line.orderId) ?? []), line]);

  const communeIds = [...new Set(orderRows.map((o) => o.communeId).filter((id): id is string => !!id))];
  const variantIds = [...new Set(lineRows.map((l) => l.variantId).filter((id): id is string => !!id))];
  const [communeRows, variantRows] = await Promise.all([
    communeIds.length ? db.select({ id: communes.id, name: communes.name }).from(communes).where(inArray(communes.id, communeIds)).all() : [],
    variantIds.length
      ? db.select({ id: productVariants.id, weightKg: productVariants.weightKg }).from(productVariants).where(inArray(productVariants.id, variantIds)).all()
      : [],
  ]);

  return {
    orders: new Map(orderRows.map((o) => [o.id, o])),
    lines,
    withShipment: new Set(shipmentRows.map((s) => s.orderId)),
    wilayaNames: new Map(wilayaRows.map((w) => [w.id, w.name])),
    communeNames: new Map(communeRows.map((c) => [c.id, c.name])),
    // A carrier that matches addresses by name gets its own spelling, once synced.
    carrierCommuneNames: carrier.capabilities.geoNames ? await resolveCarrierCommuneNames(db, company.code, communeIds) : new Map(),
    variantWeights: new Map(variantRows.map((v) => [v.id, v.weightKg])),
  };
}

function prepare(
  request: HandoffRequest,
  data: HandoffData,
  company: DeliveryCompanyRow,
  carrier: CarrierAdapter,
  carrierWilayaNames: Map<number, string>,
): Prepared | AppError {
  const order = data.orders.get(request.orderId);
  if (!order) return new NotFoundError("Order", request.orderId);
  const context = { orderId: order.id, orderNumber: order.orderNumber };

  const verdict = checkHandoff({ status: order.status as OrderStatus, hasShipment: data.withShipment.has(order.id) });
  if (!verdict.ok) {
    return verdict.code === ERROR_CODES.ORDER_HAS_SHIPMENT
      ? new ConflictError(`Order ${order.orderNumber} already has a shipment`, verdict.code, context)
      : new BusinessLogicError(`Order ${order.orderNumber} is "${order.status}"; only a ready order can be handed off`, ERROR_CODES.ORDER_NOT_READY_FOR_HANDOFF, { ...context, status: order.status });
  }

  const wilayaName = order.wilayaId ? data.wilayaNames.get(order.wilayaId) : undefined;
  const communeName = order.communeId ? data.communeNames.get(order.communeId) : undefined;
  if (!order.wilayaId || !wilayaName || !communeName) {
    return new ValidationError(`Order ${order.orderNumber} needs a wilaya and a commune`, ERROR_CODES.MISSING_WILAYA_COMMUNE, context);
  }

  const deliveryType = request.deliveryType ?? order.deliveryType;
  const caps = carrier.capabilities;
  const offered = deliveryType === "stop_desk" ? caps.stopDesk && company.supportsStopDesk : caps.homeDelivery && company.supportsHomeDelivery;
  if (!offered) {
    const what = deliveryType === "stop_desk" ? "stop-desk delivery" : "home delivery";
    return new BusinessLogicError(`${company.name} does not offer ${what}`, ERROR_CODES.DELIVERY_NOT_AVAILABLE, { ...context, deliveryType });
  }

  const stationCode = deliveryType === "stop_desk" ? request.stationCode?.trim() || order.stationCode || null : null;
  if (deliveryType === "stop_desk" && !stationCode) {
    return new ValidationError(`Order ${order.orderNumber} goes to a stop desk; choose the desk`, ERROR_CODES.MISSING_STATION_CODE, context);
  }
  const address = (order.address ?? "").trim();
  if (deliveryType === "home" && !address) {
    return new ValidationError(`Order ${order.orderNumber} is for home delivery and has no street address`, ERROR_CODES.MISSING_ADDRESS, context);
  }

  const amount = order.price + (order.deliveryFee ?? 0);
  if (exceedsAmountCeiling(amount, caps.limits)) {
    return new BusinessLogicError(
      `Order ${order.orderNumber} is ${amount} DZD; ${company.name} accepts at most ${caps.limits.maxAmount} DZD per parcel. Split it into two parcels or use another carrier.`,
      ERROR_CODES.VALUE_OUT_OF_RANGE,
      { ...context, amount, maxAmount: caps.limits.maxAmount },
    );
  }

  const lines = data.lines.get(order.id) ?? [];
  const weight = request.weight ?? order.weight ?? sumParcelWeight(lines, data.variantWeights) ?? null;
  const fragile = request.fragile ?? order.isFragile ?? null;
  const remarks = request.remarks ?? order.notes ?? undefined;

  return {
    request,
    order,
    deliveryType,
    stationCode,
    weight: caps.parcelFields.weight ? weight : null,
    fragile: caps.parcelFields.fragile ? fragile : null,
    input: {
      reference: order.orderNumber,
      customerName: order.customerName,
      phone: order.phone,
      address,
      wilayaId: order.wilayaId,
      wilaya: carrierWilayaNames.get(order.wilayaId) ?? wilayaName,
      commune: data.carrierCommuneNames.get(order.communeId!) ?? communeName,
      amount,
      productDescription: buildProductDescription(
        lines.map((l) => l.productName),
        order.orderNumber,
        caps.limits.maxDescription ?? DEFAULT_MAX_DESCRIPTION,
      ),
      stopDesk: deliveryType === "stop_desk",
      ...(stationCode ? { stationCode } : {}),
      ...(caps.parcelFields.remarks && remarks ? { remarks } : {}),
      ...(caps.parcelFields.weight && weight != null ? { weight } : {}),
      ...(caps.parcelFields.fragile && fragile != null ? { fragile } : {}),
    },
  };
}

// ─── 2. Reserve ───────────────────────────────────────────────────────────────

function reservationRefusal(reason: ReservationRefusal, order: OrderRow): AppError {
  const context = { orderId: order.id, orderNumber: order.orderNumber };
  switch (reason) {
    case "order_not_found":
      return new NotFoundError("Order", order.id);
    case "order_has_shipment":
      return new ConflictError(`Order ${order.orderNumber} already has a shipment`, ERROR_CODES.ORDER_HAS_SHIPMENT, context);
    case "order_not_ready":
      return new BusinessLogicError(`Order ${order.orderNumber} is no longer ready to hand off`, ERROR_CODES.ORDER_NOT_READY_FOR_HANDOFF, context);
  }
}

// ─── 3. Create ────────────────────────────────────────────────────────────────

type CreateOutcome = { ok: true; parcel: CarrierParcel } | { ok: false; error: unknown };

async function createAtCarrier(db: AppDb, company: DeliveryCompanyRow, carrier: CarrierAdapter, reserved: Array<Prepared & { shipmentId: string }>): Promise<CreateOutcome[]> {
  const bulkSize = carrier.capabilities.bulkCreate;
  if (reserved.length > 1 && bulkSize > 0 && carrier.createShipments) {
    const outcomes: CreateOutcome[] = [];
    for (let start = 0; start < reserved.length; start += bulkSize) {
      const chunk = reserved.slice(start, start + bulkSize);
      let items: CarrierBulkItem[];
      try {
        items = await loggedCarrierCall(db, { companyId: company.id, operation: "createShipments" }, () => carrier.createShipments!(chunk.map((p) => p.input)));
      } catch (error) {
        // The whole call failed: every parcel in it shares that outcome.
        outcomes.push(...chunk.map((): CreateOutcome => ({ ok: false, error })));
        continue;
      }
      const byReference = new Map(items.map((item) => [item.reference, item]));
      for (const prepared of chunk) {
        const item = byReference.get(prepared.input.reference);
        outcomes.push(
          !item
            ? { ok: false, error: new CarrierError(carrier.provider, "ambiguous", "The carrier's answer left this parcel out") }
            : item.ok
              ? { ok: true, parcel: item.parcel }
              : { ok: false, error: item.error },
        );
      }
    }
    return outcomes;
  }

  const outcomes: CreateOutcome[] = [];
  for (const prepared of reserved) {
    try {
      const parcel = await loggedCarrierCall(
        db,
        { companyId: company.id, orderId: prepared.order.id, operation: "createShipment" },
        () => carrier.createShipment(prepared.input),
        (p) => ({ carrierParcelId: p.carrierParcelId, trackingNumber: p.trackingNumber }),
      );
      outcomes.push({ ok: true, parcel });
    } catch (error) {
      outcomes.push({ ok: false, error });
    }
  }
  return outcomes;
}

// ─── 4. Settle ────────────────────────────────────────────────────────────────

interface AcceptanceTarget {
  shipmentId: string;
  orderId: string;
  orderNumber: string;
}

/**
 * Record a parcel the carrier has, and validate it when the company asks and
 * the carrier needs it. A validation the carrier refuses is kept in the
 * history, never a rollback: the parcel exists either way.
 */
async function completeAcceptance(
  db: AppDb,
  company: DeliveryCompanyRow,
  carrier: Pick<CarrierAdapter, "capabilities" | "validate">,
  target: AcceptanceTarget,
  parcel: CarrierParcel,
  actor: AuthUser | null,
  how: { source: ShipmentEventSource; autoValidate: boolean },
): Promise<SettledHandoff> {
  const { shipmentId, orderId, orderNumber } = target;
  const needsValidation = carrier.capabilities.separateValidation;
  try {
    const accepted = await acceptCarrierHandoff(db, shipmentId, parcel, { validated: !needsValidation, actorId: actor?.id ?? null, source: how.source });
    if (!accepted) throw new Error("the shipment was no longer waiting for the carrier");
  } catch (cause) {
    // The parcel exists at the carrier but could not be recorded: keep what is
    // known so the merchant can attach it, rather than lose it.
    const reason = `Created at the carrier as ${parcel.trackingNumber ?? parcel.carrierParcelId}, but not recorded: ${(cause as Error)?.message ?? cause}`;
    await markHandoffUnknown(db, shipmentId, reason).catch(() => false);
    return { orderId, orderNumber, outcome: "unknown", shipmentId, message: reason };
  }

  let validated = !needsValidation;
  let validationError: string | null = null;
  if (needsValidation && how.autoValidate && company.autoValidate && carrier.validate) {
    try {
      await loggedCarrierCall(db, { companyId: company.id, orderId, operation: "validate" }, () =>
        carrier.validate!({ carrierParcelId: parcel.carrierParcelId, trackingNumber: parcel.trackingNumber, carrierData: parcel.carrierData }),
      );
      validated = await markValidated(db, shipmentId, actor?.id ?? null);
    } catch (error) {
      validationError = (error as Error)?.message ?? String(error);
      await noteShipmentStep(db, shipmentId, "validation_failed", { source: "handoff", reason: validationError, actorId: actor?.id ?? null });
    }
  }

  if (actor) {
    await logActivity(db, actor, ACTIONS.ORDER_DISPATCHED, { type: "order", id: orderId, label: orderNumber }, {
      companyName: company.name,
      shipmentId,
      trackingNumber: parcel.trackingNumber,
      ...(how.source !== "handoff" ? { resolvedBy: how.source } : {}),
    });
  }
  return { orderId, orderNumber, outcome: "accepted", shipmentId, trackingNumber: parcel.trackingNumber, validated, validationError };
}

async function settleFailed(
  db: AppDb,
  company: DeliveryCompanyRow,
  prepared: Prepared & { shipmentId: string },
  error: unknown,
): Promise<HandoffResult> {
  const { order, shipmentId } = prepared;
  const context = { orderId: order.id, orderNumber: order.orderNumber, companyId: company.id };
  if (error instanceof CarrierError && NOT_CREATED.has(error.kind)) {
    await discardReservation(db, shipmentId);
    return { orderId: order.id, orderNumber: order.orderNumber, outcome: "refused", error: new CarrierRequestError(error, context) };
  }
  // Ambiguous, or a failure CodFlow cannot classify: the parcel may exist.
  const message = (error as Error)?.message ?? String(error);
  await markHandoffUnknown(db, shipmentId, message);
  return { orderId: order.id, orderNumber: order.orderNumber, outcome: "unknown", shipmentId, message };
}

// ─── The protocol ─────────────────────────────────────────────────────────────

/**
 * Hand orders to a carrier company. Returns one result per distinct order,
 * in request order. Throws only when the company itself cannot take parcels
 * (inactive, not connected, misconfigured).
 */
export async function handOffToCarrier(
  db: AppDb,
  company: DeliveryCompanyRow,
  requests: HandoffRequest[],
  actor: AuthUser | null,
): Promise<HandoffResult[]> {
  const carrier = await carrierFor(company);
  const distinct = [...new Map(requests.map((r) => [r.orderId, r])).values()];
  if (distinct.length === 0) return [];

  const data = await loadHandoffData(db, company, carrier, distinct.map((r) => r.orderId));
  const carrierWilayaNames = new Map<number, string>();
  if (carrier.capabilities.geoNames) {
    for (const wilayaId of new Set([...data.orders.values()].map((o) => o.wilayaId).filter((id): id is number => id != null))) {
      const name = await resolveCarrierWilayaName(db, company.code, wilayaId);
      if (name) carrierWilayaNames.set(wilayaId, name);
    }
  }

  const results = new Map<string, HandoffResult>();
  const reserved: Array<Prepared & { shipmentId: string }> = [];
  for (const request of distinct) {
    const prepared = prepare(request, data, company, carrier, carrierWilayaNames);
    if (prepared instanceof AppError) {
      const order = data.orders.get(request.orderId);
      results.set(request.orderId, { orderId: request.orderId, orderNumber: order?.orderNumber ?? null, outcome: "refused", error: prepared });
      continue;
    }
    const reservation = await reserveCarrierShipment(db, {
      orderId: prepared.order.id,
      companyId: company.id,
      deliveryType: prepared.deliveryType,
      stationCode: prepared.stationCode,
      weight: prepared.weight,
      isFragile: prepared.fragile,
      createdBy: actor?.id ?? null,
    });
    if (!reservation.ok) {
      results.set(request.orderId, { orderId: request.orderId, orderNumber: prepared.order.orderNumber, outcome: "refused", error: reservationRefusal(reservation.reason, prepared.order) });
      continue;
    }
    reserved.push({ ...prepared, shipmentId: reservation.shipmentId });
  }

  if (reserved.length > 0) {
    const created = await createAtCarrier(db, company, carrier, reserved);
    for (const [i, prepared] of reserved.entries()) {
      const outcome = created[i];
      const result = outcome.ok
        ? await completeAcceptance(
            db,
            company,
            carrier,
            { shipmentId: prepared.shipmentId, orderId: prepared.order.id, orderNumber: prepared.order.orderNumber },
            outcome.parcel,
            actor,
            { source: "handoff", autoValidate: true },
          )
        : await settleFailed(db, company, prepared, outcome.error);
      results.set(prepared.order.id, result);
    }
  }

  return distinct.map((r) => results.get(r.orderId)!);
}

// ─── Resolving an unknown outcome ─────────────────────────────────────────────

export type Resolution =
  | { action: "lookup" }
  | { action: "attach"; trackingNumber: string; carrierParcelId?: string }
  | { action: "release" };

export type ResolveResult =
  | { outcome: "accepted"; result: SettledHandoff }
  | { outcome: "not_found" }
  | { outcome: "released"; orderId: string };

/**
 * Settle a handoff whose outcome was unknown — never by sending it again:
 *   lookup  — ask the carrier for a parcel with our order number (when it can);
 *   attach  — the merchant found the parcel at the carrier and gives its tracking number;
 *   release — the merchant attests the carrier has no parcel; the order is ready again.
 */
export async function resolveHandoff(db: AppDb, shipmentId: string, resolution: Resolution, actor: AuthUser | null): Promise<ResolveResult> {
  const row = await getShipment(db, shipmentId);
  if (!row) throw new NotFoundError("Shipment", shipmentId);
  const company = row.companyId ? await getDeliveryCompanyRaw(db, row.companyId) : null;
  const capabilities = company ? carrierCapabilities(company) : null;
  requireAction(row, capabilities, resolution.action === "lookup" ? "lookup" : "resolve");
  const order = await db.select({ orderNumber: orders.orderNumber }).from(orders).where(eq(orders.id, row.orderId)).get();
  const target = { shipmentId, orderId: row.orderId, orderNumber: order?.orderNumber ?? row.orderId };
  const context = { shipmentId, orderId: row.orderId };

  if (resolution.action === "release") {
    if (!(await releaseUnknownHandoff(db, shipmentId))) {
      throw new ConflictError("The shipment was resolved meanwhile", ERROR_CODES.SHIPMENT_ACTION_NOT_AVAILABLE, context);
    }
    if (actor) {
      await logActivity(db, actor, ACTIONS.SHIPMENT_RELEASED, { type: "order", id: row.orderId, label: target.orderNumber }, { shipmentId, companyId: row.companyId });
    }
    return { outcome: "released", orderId: row.orderId };
  }

  if (resolution.action === "lookup") {
    const carrier = await carrierFor(company!);
    const parcel = await callCarrier({ ...context, companyId: company!.id }, () =>
      loggedCarrierCall(db, { companyId: company!.id, orderId: row.orderId, operation: "findByReference" }, () =>
        carrier.findByReference!(target.orderNumber, new Date(row.createdAt)),
      ),
    );
    if (!parcel) return { outcome: "not_found" };
    return { outcome: "accepted", result: await completeAcceptance(db, company!, carrier, target, parcel, actor, { source: "system", autoValidate: false }) };
  }

  const trackingNumber = resolution.trackingNumber.trim();
  const carrierParcelId = resolution.carrierParcelId?.trim() || trackingNumber;
  const taken = await findCarrierShipment(db, company!.id, { carrierParcelId, trackingNumber });
  if (taken && taken.id !== shipmentId) {
    throw new ConflictError(`Parcel ${trackingNumber} already belongs to another shipment`, ERROR_CODES.ORDER_HAS_SHIPMENT, { ...context, otherShipmentId: taken.id });
  }
  const parcel: CarrierParcel = { carrierParcelId, trackingNumber, carrierData: null, labelUrl: null };
  return { outcome: "accepted", result: await completeAcceptance(db, company!, { capabilities: capabilities! }, target, parcel, actor, { source: "merchant", autoValidate: false }) };
}
