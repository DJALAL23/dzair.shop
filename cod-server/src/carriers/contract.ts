/**
 * The carrier contract — what CodFlow asks of every delivery company it
 * integrates, in CodFlow's terms (ADR 0006).
 *
 * An adapter knows its carrier's HTTP API, auth, payload shapes, quirks and
 * vocabulary. It knows nothing about orders, shipments or the database: it
 * turns CodFlow requests into carrier calls and carrier answers into CodFlow
 * values, and it classifies every failure (`CarrierError`).
 *
 * Capabilities are declared once, statically, by the adapter; an optional
 * method exists exactly when its capability says so (a contract test enforces
 * it). Callers check the capability before calling — never `typeof`, never a
 * stub that pretends.
 */

import type { Interpretation } from "../../../cod-shared/shipments/interpretation";
import { eventKey } from "../../../cod-shared/shipments/model";

import { CARRIER_PROVIDERS, type CarrierProvider } from "../../../cod-shared/carriers/providers";

export { CARRIER_PROVIDERS, type CarrierProvider };

// ─── Errors ───────────────────────────────────────────────────────────────────

/**
 * How a carrier call failed — the only thing callers branch on.
 *   rejected      — the carrier refused the request (validation, business rule). Nothing changed.
 *   auth          — the credentials are wrong or revoked. Nothing changed.
 *   rate_limited  — throttled; `retryAfterSec` when the carrier says. Nothing changed.
 *   unavailable   — the carrier did not act: a read that could not be served, or a
 *                   write stopped before it reached the carrier (an edge block page).
 *   ambiguous     — a write whose outcome is unknown: it may or may not have happened
 *                   (timeout, dropped connection, server error, unreadable success).
 *   misconfigured — this company's credentials or settings are incomplete in CodFlow.
 */
export const CARRIER_ERROR_KINDS = [
  "rejected",
  "auth",
  "rate_limited",
  "unavailable",
  "ambiguous",
  "misconfigured",
] as const;
export type CarrierErrorKind = (typeof CARRIER_ERROR_KINDS)[number];

export class CarrierError extends Error {
  readonly kind: CarrierErrorKind;
  readonly provider: CarrierProvider;
  readonly httpStatus: number | null;
  readonly retryAfterSec: number | null;
  /** The carrier's own business code when it sends one (e.g. EcoTrack 10002). */
  readonly carrierCode: string | null;

  constructor(
    provider: CarrierProvider,
    kind: CarrierErrorKind,
    message: string,
    details: { httpStatus?: number | null; retryAfterSec?: number | null; carrierCode?: string | number | null } = {},
  ) {
    super(message);
    this.name = "CarrierError";
    this.provider = provider;
    this.kind = kind;
    this.httpStatus = details.httpStatus ?? null;
    this.retryAfterSec = details.retryAfterSec ?? null;
    this.carrierCode = details.carrierCode == null ? null : String(details.carrierCode);
  }
}

export function isCarrierError(error: unknown): error is CarrierError {
  return error instanceof CarrierError;
}

// ─── Capabilities ─────────────────────────────────────────────────────────────

export interface CarrierCapabilities {
  homeDelivery: boolean;
  stopDesk: boolean;
  /** A created parcel waits for a separate validation before the carrier handles it. */
  separateValidation: boolean;
  /** Most parcels one bulk create accepts; 0 = no bulk create. */
  bulkCreate: number;
  /** Parcel fields the carrier takes at creation. */
  parcelFields: { weight: boolean; fragile: boolean; remarks: boolean };
  /** The carrier's own ceilings, checked before calling it. */
  limits: { maxAmount: number | null; maxDescription: number | null };
  update: boolean;
  cancel: boolean;
  remarks: { add: boolean; list: boolean };
  /** Status history can be pulled; `historyBatch` = parcels per call. */
  history: boolean;
  historyBatch: number;
  /** A parcel can be found by our reference — resolves an ambiguous creation. */
  findByReference: boolean;
  /** How updates reach CodFlow: pushed by webhook, or pulled on a schedule. */
  updates: "webhook" | "pull";
  label: boolean;
  askReturn: boolean;
  /** The merchant can ask the carrier to try delivering again after a failed attempt. */
  requestNewAttempt: boolean;
  /** The merchant confirms at the carrier that a return reached them. */
  confirmReturn: boolean;
  stopDeskList: boolean;
  geoNames: boolean;
  verifyConnection: boolean;
}

// ─── Values crossing the contract ─────────────────────────────────────────────

export interface CarrierShipmentInput {
  /** Our reference — the order number. Sent to the carrier and used to find the parcel again. */
  reference: string;
  customerName: string;
  phone: string;
  phone2?: string;
  address: string;
  wilayaId: number;
  /** Wilaya and commune names, in the carrier's own spelling when it matches by name. */
  wilaya: string;
  commune: string;
  /** Cash the courier collects: price plus delivery fee. */
  amount: number;
  productDescription: string;
  stopDesk: boolean;
  stationCode?: string;
  remarks?: string;
  weight?: number;
  fragile?: boolean;
}

/** A parcel the carrier created. `trackingNumber` may arrive later for some carriers. */
export interface CarrierParcel {
  /** The carrier's stable id for the parcel — what its updates are matched by. */
  carrierParcelId: string;
  trackingNumber: string | null;
  /** Opaque to CodFlow; handed back to the adapter on every later call. */
  carrierData: unknown;
  labelUrl: string | null;
}

export type CarrierBulkItem =
  | { reference: string; ok: true; parcel: CarrierParcel }
  | { reference: string; ok: false; error: CarrierError };

/** Everything an adapter needs to address an existing parcel. */
export interface CarrierRef {
  carrierParcelId: string;
  trackingNumber: string | null;
  carrierData: unknown;
}

export interface CarrierShipmentPatch {
  customerName?: string;
  phone?: string;
  phone2?: string;
  address?: string;
  wilayaId?: number;
  wilaya?: string;
  commune?: string;
  amount?: number;
  remarks?: string;
  weight?: number;
  fragile?: boolean;
}

/** A status exactly as the carrier wrote it, with the vocabulary it belongs to. */
export interface CarrierStatus {
  vocabulary: string;
  value: string;
  /** The carrier's human wording when `value` is a code (ZR: slug + French description). */
  label?: string | null;
}

/**
 * One status report from the carrier, before CodFlow interprets it. The same
 * fact can reach CodFlow twice — by webhook and by a pulled history — so it is
 * identified by what it says (`updateKey`), never by the channel it came by.
 */
export interface CarrierUpdate {
  /** How to find our shipment; adapters fill what the carrier sends. */
  match: { carrierParcelId?: string; trackingNumber?: string; reference?: string };
  status: CarrierStatus;
  reason: string | null;
  /** Canonical UTC ISO-8601 (`toISOString()` form). */
  occurredAt: string;
  raw: unknown;
}

/** The identity of a reported fact: its status and when it happened (see cod-shared eventKey). */
export function updateKey(update: Pick<CarrierUpdate, "status" | "occurredAt">): string {
  return eventKey(update.status, update.occurredAt);
}

export interface CarrierRemark {
  content: string;
  createdAt: string | null;
}

export type CarrierLabel =
  | { kind: "url"; url: string }
  | { kind: "pdf"; body: ArrayBuffer };

export interface CarrierStopDesk {
  code: string;
  name: string;
  /** `null` when the carrier does not publish a distinct commune. */
  commune: string | null;
  address: string | null;
  phones: string[];
  /** 1–58, or `null` when the carrier's data does not map to a wilaya. */
  wilayaId: number | null;
}

export interface CarrierGeoNames {
  wilayas: Array<{ id: number; name: string }>;
  communes: Array<{ id: number; name: string; wilayaId: number }>;
}

/** The outcome of checking credentials. A wrong token is a successful check with `ok: false`. */
export interface CarrierConnectionCheck {
  ok: boolean;
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

// ─── Webhooks ─────────────────────────────────────────────────────────────────

/** One carrier event as stored in the inbox, before it is processed. */
export interface InboxEnvelope {
  /** The carrier's idempotency key for this event. */
  eventId: string;
  eventType: string;
  /** This event alone, as JSON text. */
  payload: string;
}

/** What one inbox event turns out to be. */
export type WebhookReading =
  | { kind: "update"; update: CarrierUpdate }
  /** The carrier created a parcel for our reference — proof it exists, which settles an unknown handoff. */
  | { kind: "created"; reference: string; parcel: CarrierParcel }
  /** A money event (collection, payout) — kept for the settlement domain. */
  | { kind: "settlement" }
  /** Not about delivery (a label edit, a creation receipt). */
  | { kind: "ignored"; reason: string };

export interface CarrierWebhook {
  /** Whether the raw delivery was signed with this company's secret. */
  verify(rawBody: string, headers: Headers, secret: string): Promise<boolean>;
  /** Split one delivery into its events (some carriers batch several). */
  split(rawBody: string, headers: Headers): InboxEnvelope[];
  read(envelope: InboxEnvelope): WebhookReading;
}

// ─── The adapter ──────────────────────────────────────────────────────────────

export interface CarrierAdapter {
  readonly provider: CarrierProvider;
  readonly capabilities: CarrierCapabilities;

  createShipment(input: CarrierShipmentInput): Promise<CarrierParcel>;
  /** Interpret one of this carrier's statuses. Pure; unknown values are `{ kind: "unknown" }`. */
  interpret(status: CarrierStatus): Interpretation;

  /** capabilities.bulkCreate > 0. A whole-call failure throws; per-parcel failures are items. */
  createShipments?(inputs: CarrierShipmentInput[]): Promise<CarrierBulkItem[]>;
  /** capabilities.separateValidation. */
  validate?(ref: CarrierRef, options?: { requestPickup?: boolean }): Promise<void>;
  /** capabilities.update. */
  update?(ref: CarrierRef, patch: CarrierShipmentPatch): Promise<void>;
  /** capabilities.cancel. A parcel already gone at the carrier counts as cancelled. */
  cancel?(ref: CarrierRef): Promise<void>;
  /** capabilities.remarks.add / .list. */
  addRemark?(ref: CarrierRef, content: string): Promise<void>;
  listRemarks?(ref: CarrierRef): Promise<CarrierRemark[]>;
  /** capabilities.history. Updates for up to `historyBatch` parcels, keyed by `carrierParcelId`. */
  fetchHistory?(refs: CarrierRef[]): Promise<Map<string, CarrierUpdate[]>>;
  /** capabilities.findByReference. `createdOn` bounds the search to the handoff day. */
  findByReference?(reference: string, createdOn: Date): Promise<CarrierParcel | null>;
  /** capabilities.label. */
  label?(ref: CarrierRef): Promise<CarrierLabel>;
  /** capabilities.askReturn. A request the courier may decline. */
  askReturn?(ref: CarrierRef): Promise<void>;
  /** capabilities.requestNewAttempt. A request for another delivery attempt. */
  requestNewAttempt?(ref: CarrierRef): Promise<void>;
  /** capabilities.confirmReturn. `false` when the carrier had nothing eligible. */
  confirmReturn?(refs: CarrierRef[]): Promise<boolean>;
  /** capabilities.stopDeskList. */
  stopDesks?(): Promise<CarrierStopDesk[]>;
  /** capabilities.geoNames. */
  geoNames?(): Promise<CarrierGeoNames>;
  /** capabilities.verifyConnection. */
  verifyConnection?(): Promise<CarrierConnectionCheck>;
  /** capabilities.updates === "webhook". */
  readonly webhook?: CarrierWebhook;
}

/** The capability each optional member depends on — the contract test checks both directions. */
export const OPTIONAL_MEMBER_CAPABILITY = {
  createShipments: (c: CarrierCapabilities) => c.bulkCreate > 0,
  validate: (c: CarrierCapabilities) => c.separateValidation,
  update: (c: CarrierCapabilities) => c.update,
  cancel: (c: CarrierCapabilities) => c.cancel,
  addRemark: (c: CarrierCapabilities) => c.remarks.add,
  listRemarks: (c: CarrierCapabilities) => c.remarks.list,
  fetchHistory: (c: CarrierCapabilities) => c.history,
  findByReference: (c: CarrierCapabilities) => c.findByReference,
  label: (c: CarrierCapabilities) => c.label,
  askReturn: (c: CarrierCapabilities) => c.askReturn,
  requestNewAttempt: (c: CarrierCapabilities) => c.requestNewAttempt,
  confirmReturn: (c: CarrierCapabilities) => c.confirmReturn,
  stopDesks: (c: CarrierCapabilities) => c.stopDeskList,
  geoNames: (c: CarrierCapabilities) => c.geoNames,
  verifyConnection: (c: CarrierCapabilities) => c.verifyConnection,
  webhook: (c: CarrierCapabilities) => c.updates === "webhook",
} as const satisfies Record<Exclude<keyof CarrierAdapter, "provider" | "capabilities" | "createShipment" | "interpret">, (c: CarrierCapabilities) => boolean>;
