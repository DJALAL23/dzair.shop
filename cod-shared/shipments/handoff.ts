/**
 * Handing an order to delivery — the shipment's beginning (ADR 0006).
 *
 * A carrier handoff is a protocol, because a carrier call can fail in a way
 * that leaves the outcome unknown:
 *   1. reserve   — the shipment row is written before the carrier is called.
 *                  It is one INSERT … SELECT that only succeeds for a ready
 *                  order, and UNIQUE(order_id) refuses a second: an order can
 *                  never be sent twice, however many clicks race.
 *   2. then one of:
 *      accept    — the carrier created the parcel;
 *      discard   — the carrier definitely did not (refused, auth, throttled);
 *      unknown   — nobody can tell; the merchant or a lookup by our reference
 *                  resolves it, never a blind retry.
 * A driver handoff has no carrier call: the shipment is accepted at once,
 * with the driver's fee for the order's wilaya frozen in the same statement.
 * The store's driver delivers to the customer's door — never to a stop desk.
 *
 * CodFlow's own steps are recorded as `handoff` / `system` events beside the
 * carrier's; they never change the carrier's provider status.
 */

import { and, eq, exists, inArray, sql, type SQL } from "drizzle-orm";
import { insertSelectRow } from "../db/insert-select";
import type { AppDb } from "../db/client";
import { driverCompensations, drivers, orders, shipmentEvents, shipments } from "../db/schema";
import { checkVoid, type ShipmentRuleVerdict } from "./interpretation";
import { eventKey, type ShipmentEventSource } from "./model";
import { deliveryFactsOf } from "./queries";
import { chunkIds } from "../queries/d1-limits";
import { staffOf, type Author } from "../events/actor";
import { recordEvent } from "../events/record";
import { orderSnapshot, shipmentSnapshot } from "../events/snapshots";

type BatchStatement = Parameters<AppDb["batch"]>[0][number];

/** Why an order could not be reserved for delivery. */
export type OrderRefusal = "order_not_found" | "order_not_ready" | "order_has_shipment";
/** Why an order could not be given to a driver: the order's reasons, no street address to bring it to, or the driver no longer takes orders. */
export type ReservationRefusal = OrderRefusal | "order_missing_address" | "driver_unavailable";

export type Reserved<R extends ReservationRefusal = OrderRefusal> = { ok: true; shipmentId: string } | { ok: false; reason: R };

function isUniqueViolation(error: unknown): boolean {
  const text = `${(error as Error)?.message ?? ""} ${String((error as { cause?: unknown })?.cause ?? "")}`;
  return /UNIQUE constraint failed: shipments\.order_id/i.test(text);
}

async function orderRefusal(db: AppDb, orderId: string): Promise<OrderRefusal> {
  const order = await db.select({ status: orders.status }).from(orders).where(eq(orders.id, orderId)).get();
  if (!order) return "order_not_found";
  const existing = await db.select({ id: shipments.id }).from(shipments).where(eq(shipments.orderId, orderId)).get();
  return existing ? "order_has_shipment" : "order_not_ready";
}

/** A driver who can take an order: one that exists and is not inactive. */
const driverCanTake = (driverId: string) =>
  sql`exists (select 1 from ${drivers} where ${drivers.id} = ${driverId} and ${drivers.status} <> 'inactive')`;

interface ReservationRules<R extends ReservationRefusal> {
  /** Another condition the order's reservation needs, checked in the same statement. */
  also?: SQL;
  /** Why the reservation was refused, read after the fact. */
  refusal: () => Promise<R>;
  history?: { source: ShipmentEventSource; step: string; actorId: string | null };
}

async function insertReservation<R extends ReservationRefusal>(
  db: AppDb,
  orderId: string,
  values: Partial<Record<keyof typeof shipments._.columns, SQL>>,
  rules: ReservationRules<R>,
): Promise<Reserved<R>> {
  const id = crypto.randomUUID();
  const revision = crypto.randomUUID();
  const now = new Date().toISOString();
  const columns = insertSelectRow(shipments, {
    id: sql`${id}`,
    orderId: orders.id,
    ...values,
    revision: sql`${revision}`,
    createdAt: sql`${now}`,
    updatedAt: sql`${now}`,
  });
  const statements: BatchStatement[] = [
    db.insert(shipments).select(
      db
        .select(columns as never)
        .from(orders)
        .where(and(eq(orders.id, orderId), eq(orders.status, "ready"), rules.also)),
    ),
  ];
  const { history } = rules;
  if (history) statements.push(codflowEvent(db, id, revision, history.source, history.step, { actorId: history.actorId }));
  try {
    const [result] = await db.batch(statements as [BatchStatement, ...BatchStatement[]]);
    if (((result as { meta?: { changes?: number } }).meta?.changes ?? 0) > 0) return { ok: true, shipmentId: id };
    return { ok: false, reason: await rules.refusal() };
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, reason: "order_has_shipment" as R };
    throw error;
  }
}

const value = <T>(v: T) => sql`${v ?? null}`;

export interface CarrierReservation {
  orderId: string;
  companyId: string;
  deliveryType: "home" | "stop_desk";
  stationCode: string | null;
  weight: number | null;
  isFragile: boolean | null;
  /** The company's rate and return fee for the destination and delivery type (`costAt`), frozen here. */
  shippingCost: number | null;
  returnFee: number | null;
  createdBy: string | null;
}

/**
 * Reserve a carrier shipment for a ready order, before the carrier is called.
 * The cash to collect is the order's price plus its delivery fee, read in
 * the same statement; the store's cost is frozen with it.
 */
export function reserveCarrierShipment(db: AppDb, input: CarrierReservation): Promise<Reserved> {
  return insertReservation(
    db,
    input.orderId,
    {
      kind: value("carrier"),
      companyId: value(input.companyId),
      handoffState: value("submitting"),
      deliveryType: value(input.deliveryType),
      stationCode: value(input.stationCode),
      codAmount: sql`${orders.price} + ${orders.deliveryFee}`,
      weight: value(input.weight),
      isFragile: value(input.isFragile === null ? null : input.isFragile ? 1 : 0),
      shippingCost: value(input.shippingCost),
      returnFee: value(input.returnFee),
      createdBy: value(input.createdBy),
    },
    { refusal: () => orderRefusal(db, input.orderId) },
  );
}

export interface DriverHandoff {
  orderIds: readonly string[];
  driverId: string;
  author: Author;
}

/** An order with a street address: the store's driver brings the parcel to the customer's door. */
const hasStreetAddress = sql`trim(coalesce(${orders.address}, '')) <> ''`;
const hasNoShipment = sql`not exists (select 1 from ${shipments} where ${shipments.orderId} = ${orders.id})`;

/**
 * Give ready orders to the store's driver, all in one batch: each shipment is
 * accepted at once as home delivery — the driver has no stop desk, whatever
 * the customer chose — with the driver's fee for the order's wilaya (0 when
 * none is set) frozen with it, so a later change to the pay grid does not
 * touch it. Each order's statement also requires it to be ready, with no
 * shipment and a street address, and the driver to exist and not be
 * inactive. One result per order id, in the order given; an id given twice
 * is given once and refused the second time.
 */
export async function handOffToDriver(db: AppDb, input: DriverHandoff): Promise<Array<Reserved<ReservationRefusal>>> {
  if (input.orderIds.length === 0) return [];
  const fee = sql`coalesce((select ${driverCompensations.feePerDelivery} from ${driverCompensations} where ${driverCompensations.driverId} = ${input.driverId} and ${driverCompensations.wilayaId} = "orders"."wilaya_id"), 0)`;
  const now = new Date().toISOString();
  const createdBy = staffOf(input.author.actor)?.id ?? null;
  const planned = input.orderIds.map((orderId) => ({ orderId, id: crypto.randomUUID(), revision: crypto.randomUUID() }));
  const statements = planned.flatMap(({ orderId, id, revision }) => [
    db.insert(shipments).select(
      db
        .select(
          insertSelectRow(shipments, {
            id: sql`${id}`,
            orderId: orders.id,
            kind: value("driver"),
            driverId: value(input.driverId),
            handoffState: value("accepted"),
            deliveryType: value("home"),
            stationCode: value(null),
            codAmount: sql`${orders.price} + ${orders.deliveryFee}`,
            driverFee: fee,
            createdBy: value(createdBy),
            revision: sql`${revision}`,
            createdAt: sql`${now}`,
            updatedAt: sql`${now}`,
          }) as never,
        )
        .from(orders)
        .where(and(eq(orders.id, orderId), eq(orders.status, "ready"), hasNoShipment, hasStreetAddress, driverCanTake(input.driverId))),
    ),
    codflowEvent(db, id, revision, "handoff", "assigned_to_driver", { actorId: createdBy }),
    handedOff(db, { shipmentId: id, orderId, revision, now, author: input.author }),
  ]);
  const results = await db.batch(statements as unknown as [BatchStatement, ...BatchStatement[]]);
  const accepted = planned.map((_, i) => changed(results[i * STATEMENTS_PER_DRIVER_ORDER]));
  const refused = planned.filter((_, i) => !accepted[i]).map((p) => p.orderId);
  const reasons = refused.length ? await driverRefusals(db, refused, input.driverId) : new Map<string, ReservationRefusal>();
  return planned.map(({ orderId, id }, i) => (accepted[i] ? { ok: true, shipmentId: id } : { ok: false, reason: reasons.get(orderId) ?? "order_not_found" }));
}

/** The shipment, its history step, and its Business Event. */
const STATEMENTS_PER_DRIVER_ORDER = 3;

/** True while the shipment still has the revision a change gave it (or read it with). */
const standsAt = (shipmentId: string, revision: string) =>
  sql`exists (select 1 from ${shipments} where ${shipments.id} = ${shipmentId} and ${shipments.revision} = ${revision})`;
/** The shipment's order, found in the statement itself. */
const orderOfShipment = (shipmentId: string) => sql`(select ${shipments.orderId} from ${shipments} where ${shipments.id} = ${shipmentId})`;

/** `shipment.handed_off`, recorded while the handoff's own revision stands. */
function handedOff(db: AppDb, h: { shipmentId: string; orderId: string | SQL; revision: string; now: string; author: Author }): BatchStatement {
  return recordEvent(
    db,
    { type: "shipment.handed_off", subjectId: h.shipmentId, orderId: h.orderId, occurredAt: h.now, ...h.author, data: { shipment: shipmentSnapshot(h.shipmentId), order: orderSnapshot(h.orderId) } },
    standsAt(h.shipmentId, h.revision),
  );
}

/** Why each of these orders was not given to the driver, read in one trip. */
async function driverRefusals(db: AppDb, orderIds: readonly string[], driverId: string): Promise<Map<string, ReservationRefusal>> {
  const distinct = [...new Set(orderIds)];
  const shipped = exists(db.select({ one: sql`1` }).from(shipments).where(eq(shipments.orderId, orders.id)));
  const [driver, ...chunks] = await db.batch([
    db.select({ status: drivers.status }).from(drivers).where(eq(drivers.id, driverId)),
    ...chunkIds(distinct).map((chunk) =>
      db.select({ id: orders.id, status: orders.status, address: orders.address, shipped }).from(orders).where(inArray(orders.id, chunk)),
    ),
  ] as unknown as [BatchStatement, ...BatchStatement[]]);
  const driverAvailable = (driver as Array<{ status: string }>).some((row) => row.status !== "inactive");
  const found = new Map((chunks as Array<Array<{ id: string; status: string; address: string | null; shipped: unknown }>>).flat().map((row) => [row.id, row]));
  return new Map(
    distinct.map((id): [string, ReservationRefusal] => {
      const order = found.get(id);
      if (!order) return [id, "order_not_found"];
      if (Number(order.shipped)) return [id, "order_has_shipment"];
      if (order.status !== "ready") return [id, "order_not_ready"];
      if (!order.address?.trim()) return [id, "order_missing_address"];
      return [id, driverAvailable ? "order_not_ready" : "driver_unavailable"];
    }),
  );
}

/**
 * A CodFlow step in the shipment's history, written in the same batch as the
 * change it describes and only while that change's revision stands (or, for
 * a note that changes nothing, while the shipment exists). It never touches
 * the carrier's provider status.
 */
function codflowEvent(
  db: AppDb,
  shipmentId: string,
  revision: string | null,
  source: ShipmentEventSource,
  step: string,
  extra: { reason?: string | null; actorId?: string | null } = {},
) {
  const now = new Date().toISOString();
  const where = revision === null ? eq(shipments.id, shipmentId) : and(eq(shipments.id, shipmentId), eq(shipments.revision, revision));
  return db.insert(shipmentEvents).select(
    db
      .select(
        insertSelectRow(shipmentEvents, {
          id: sql`${crypto.randomUUID()}`,
          shipmentId: shipments.id,
          source: sql`${source}`,
          eventKey: sql`${eventKey({ vocabulary: "codflow", value: step }, now)}`,
          vocabulary: sql`'codflow'`,
          providerStatus: sql`${step}`,
          interpretation: sql`'progress'`,
          reason: sql`${extra.reason ?? null}`,
          occurredAt: sql`${now}`,
          recordedAt: sql`${now}`,
          actorId: sql`${extra.actorId ?? null}`,
        }),
      )
      .from(shipments)
      .where(where),
  );
}

/**
 * Keep a CodFlow step in the shipment's history that changes none of its
 * facts — a validation the carrier refused, a return asked for. The same
 * step twice in one instant is one note. False when the shipment is gone.
 */
export async function noteShipmentStep(
  db: AppDb,
  shipmentId: string,
  step: string,
  extra: { source?: ShipmentEventSource; reason?: string | null; actorId?: string | null } = {},
): Promise<boolean> {
  const result = await codflowEvent(db, shipmentId, null, extra.source ?? "system", step, extra).onConflictDoNothing();
  return changed(result);
}

const changed = (result: unknown) => ((result as { meta?: { changes?: number } }).meta?.changes ?? 0) > 0;

export interface AcceptedParcel {
  carrierParcelId: string;
  trackingNumber: string | null;
  carrierData: unknown;
  labelUrl: string | null;
}

/**
 * The carrier created the parcel: record its identity. Accepts a reservation
 * or a handoff whose outcome was unknown (found later by our reference, or
 * attached by the merchant). `validated` when the carrier also validated it.
 * Returns false when the shipment is no longer waiting for this.
 */
export async function acceptCarrierHandoff(
  db: AppDb,
  shipmentId: string,
  parcel: AcceptedParcel,
  options: { validated: boolean; author: Author; source?: ShipmentEventSource },
): Promise<boolean> {
  const now = new Date().toISOString();
  const revision = crypto.randomUUID();
  const [result] = await db.batch([
    db
      .update(shipments)
      .set({
        handoffState: "accepted",
        carrierParcelId: parcel.carrierParcelId,
        trackingNumber: parcel.trackingNumber,
        carrierData: parcel.carrierData === undefined ? null : JSON.stringify(parcel.carrierData),
        labelUrl: parcel.labelUrl,
        ...(options.validated ? { validatedAt: now } : {}),
        revision,
        updatedAt: now,
      })
      .where(and(eq(shipments.id, shipmentId), inArray(shipments.handoffState, ["submitting", "unknown"]))),
    codflowEvent(db, shipmentId, revision, options.source ?? "handoff", options.validated ? "created_and_validated" : "created", {
      actorId: staffOf(options.author.actor)?.id ?? null,
    }),
    handedOff(db, { shipmentId, orderId: orderOfShipment(shipmentId), revision, now, author: options.author }),
  ]);
  return changed(result);
}

/** The carrier definitely did not create the parcel: the reservation goes, the order is ready again. */
export async function discardReservation(db: AppDb, shipmentId: string): Promise<boolean> {
  const [result] = await db.batch([
    db.delete(shipments).where(and(eq(shipments.id, shipmentId), eq(shipments.handoffState, "submitting"))),
  ]);
  return changed(result);
}

/**
 * The merchant attests that the carrier has no parcel for a handoff whose
 * outcome was unknown: the reservation goes and the order is ready again.
 * Only while still unknown — a parcel found or attached meanwhile is kept.
 */
export async function releaseUnknownHandoff(db: AppDb, shipmentId: string): Promise<boolean> {
  const [result] = await db.batch([
    db.delete(shipments).where(and(eq(shipments.id, shipmentId), eq(shipments.handoffState, "unknown"))),
  ]);
  return changed(result);
}

/** Nobody can tell whether the carrier created the parcel; it stays reserved until resolved. */
export async function markHandoffUnknown(db: AppDb, shipmentId: string, reason: string): Promise<boolean> {
  const now = new Date().toISOString();
  const revision = crypto.randomUUID();
  const [result] = await db.batch([
    db
      .update(shipments)
      .set({ handoffState: "unknown", revision, updatedAt: now })
      .where(and(eq(shipments.id, shipmentId), eq(shipments.handoffState, "submitting"))),
    codflowEvent(db, shipmentId, revision, "system", "handoff_outcome_unknown", { reason }),
  ]);
  return changed(result);
}

/** A separately validated parcel was validated at the carrier. */
export async function markValidated(db: AppDb, shipmentId: string, actorId: string | null): Promise<boolean> {
  const now = new Date().toISOString();
  const revision = crypto.randomUUID();
  const [result] = await db.batch([
    db
      .update(shipments)
      .set({ validatedAt: now, revision, updatedAt: now })
      .where(and(eq(shipments.id, shipmentId), eq(shipments.handoffState, "accepted"), sql`${shipments.validatedAt} is null`)),
    codflowEvent(db, shipmentId, revision, "handoff", "validated", { actorId }),
  ]);
  return changed(result);
}

export interface ParcelEdit {
  codAmount?: number;
  weight?: number | null;
  isFragile?: boolean | null;
  /** A parcel moved to another commune costs what the company charges there. */
  shippingCost?: number | null;
  returnFee?: number | null;
}

/**
 * The carrier accepted an edit of the parcel: record its new details with
 * the step. Only on an accepted shipment. `fields` names what the merchant
 * changed, for the history.
 */
export async function recordParcelEdit(
  db: AppDb,
  shipmentId: string,
  edit: ParcelEdit,
  extra: { fields: readonly string[]; actorId: string | null },
): Promise<boolean> {
  const now = new Date().toISOString();
  const revision = crypto.randomUUID();
  const [result] = await db.batch([
    db
      .update(shipments)
      .set({ ...edit, revision, updatedAt: now })
      .where(and(eq(shipments.id, shipmentId), eq(shipments.handoffState, "accepted"))),
    codflowEvent(db, shipmentId, revision, "merchant", "parcel_updated", { reason: extra.fields.join(", "), actorId: extra.actorId }),
  ]);
  return changed(result);
}

/**
 * The carrier's history was read: when, and the tracking number if the
 * shipment had none yet (ZR assigns it after creation). A tracking number
 * already recorded is never replaced. Bookkeeping only — no delivery fact
 * changes, so the revision stands.
 */
export async function recordSynced(db: AppDb, shipmentId: string, trackingNumber: string | null): Promise<void> {
  await db
    .update(shipments)
    .set({ lastSyncedAt: new Date().toISOString(), trackingNumber: sql`coalesce(${shipments.trackingNumber}, ${trackingNumber})` })
    .where(eq(shipments.id, shipmentId));
}

/**
 * What a carrier's own update says the parcel is called: the tracking number
 * when the shipment had none yet, and the carrier's parcel id when the
 * merchant attached the parcel by its tracking number (which then stood in
 * for the id — ZR Express addresses parcels by a UUID the merchant never
 * sees). Neither replaces an identity the carrier gave at creation.
 * Bookkeeping only: the revision stands. False when nothing changed.
 */
export async function adoptCarrierIdentity(
  db: AppDb,
  shipmentId: string,
  reported: { carrierParcelId?: string | null; trackingNumber?: string | null },
): Promise<boolean> {
  const parcelId = reported.carrierParcelId ?? null;
  const tracking = reported.trackingNumber ?? null;
  if (!parcelId && !tracking) return false;
  try {
    const [result] = await db.batch([
      db
        .update(shipments)
        .set({
          trackingNumber: sql`coalesce(${shipments.trackingNumber}, ${tracking})`,
          carrierParcelId: sql`case when ${parcelId} is not null and ${shipments.carrierParcelId} = ${shipments.trackingNumber} then ${parcelId} else ${shipments.carrierParcelId} end`,
        })
        .where(
          and(
            eq(shipments.id, shipmentId),
            eq(shipments.handoffState, "accepted"),
            sql`(${shipments.trackingNumber} is null and ${tracking} is not null) or (${parcelId} is not null and ${shipments.carrierParcelId} = ${shipments.trackingNumber} and ${shipments.carrierParcelId} <> ${parcelId})`,
          ),
        ),
    ]);
    return changed(result);
  } catch (error) {
    // Another shipment of this company already holds that parcel id: keep ours as it is.
    if (/UNIQUE constraint failed: shipments\.company_id, shipments\.carrier_parcel_id/i.test(`${(error as Error)?.message} ${String((error as { cause?: unknown })?.cause ?? "")}`)) return false;
    throw error;
  }
}

export type VoidOutcome = { ok: true; orderId: string } | Extract<ShipmentRuleVerdict, { ok: false }> | { ok: false; code: "SHIPMENT_NOT_FOUND" };

/**
 * Undo a shipment that never reached the customer: the row and its events go,
 * and the order is ready to hand off again. The carrier side (deleting the
 * parcel) is the caller's to do first; this only checks the facts and removes
 * the record, guarded on the revision it checked so a delivery recorded in
 * between is never erased.
 */
export async function voidShipment(db: AppDb, shipmentId: string, author: Author): Promise<VoidOutcome> {
  for (let attempt = 1; attempt <= 5; attempt++) {
    const row = await db.select().from(shipments).where(eq(shipments.id, shipmentId)).get();
    if (!row) return { ok: false, code: "SHIPMENT_NOT_FOUND" };
    const verdict = checkVoid(deliveryFactsOf(row));
    if (!verdict.ok) return verdict;
    // The event first: it keeps the shipment as it was, before the row and its history go.
    const [, result] = await db.batch([
      recordEvent(
        db,
        { type: "shipment.voided", subjectId: shipmentId, orderId: row.orderId, occurredAt: new Date().toISOString(), ...author, data: { shipment: shipmentSnapshot(shipmentId), order: orderSnapshot(row.orderId) } },
        standsAt(shipmentId, row.revision),
      ),
      db.delete(shipments).where(and(eq(shipments.id, shipmentId), eq(shipments.revision, row.revision))),
    ]);
    if (changed(result)) return { ok: true, orderId: row.orderId };
  }
  throw new Error(`Shipment ${shipmentId} kept changing while being voided`);
}
