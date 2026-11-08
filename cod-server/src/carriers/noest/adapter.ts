/**
 * NOEST (https://app.noest-dz.com) — the carrier contract over its public API.
 *
 * Source: the official NOEST Public API v2.3 (May 2026,
 * `api_documentation_v2_3.pdf` beside this file). Facts that shape this adapter:
 *   - Auth: `Authorization: Bearer` plus `user_guid` in most POST bodies.
 *   - A created parcel waits for `valid/order`; after it, no deletion and no
 *     direct edit. Editing before shipment is `update/order/before/expedition`
 *     (applied at once); `update/order` only files a change *request*.
 *   - The documentation says a reference already used answers `duplicate_order`
 *     ("Colis déja existant"). Live (2026-10-16) a repeated reference created a
 *     second parcel, so nothing here relies on it: an unknown outcome is
 *     resolved by the merchant, never re-sent.
 *   - Live: a bulk order without `poids` is refused (a single one is not), and
 *     `adresse` is required even for a stop desk.
 *   - Bulk answers are keyed by the index of each order in the request
 *     (`passed` / `failed`, an object, or an array when PHP's keys run 0..n).
 *   - History: `get/trackings/info` (active and archived), with `activity[]`
 *     and `deliveryAttempts[]`; the event list is documented (interpret.ts).
 *   - The merchant can ask for a return (`ask/return`) or a new delivery
 *     attempt (`ask/new-tentative`).
 *   - Limits: 60 requests/minute; NOEST allows each request 30 seconds.
 *   - No webhooks and no search by reference: updates are pulled.
 */

import { z } from "zod";
import type { Interpretation } from "../../../../cod-shared/shipments/interpretation";
import {
  CarrierError,
  type CarrierAdapter,
  type CarrierBulkItem,
  type CarrierCapabilities,
  type CarrierConnectionCheck,
  type CarrierPlace,
  type CarrierLabel,
  type CarrierParcel,
  type CarrierRef,
  type CarrierShipmentInput,
  type CarrierShipmentPatch,
  type CarrierStatus,
  type CarrierStopDesk,
  type CarrierUpdate,
} from "../contract";
import { createCarrierHttp, flattenErrorBag, type CarrierHttp } from "../http";
import { tarifRate } from "../price";
import { carrierInstant } from "../time";
import { NOEST_ATTEMPT, interpretNoest } from "./interpret";
import type {
  NoestBulkCreateResponse,
  NoestCommunesResponse,
  NoestWilaya,
  NoestCreateOrderRequest,
  NoestCreateOrderResponse,
  NoestFeesResponse,
  NoestStopDesksResponse,
  NoestTrackingInfoResponse,
  NoestUpdateBeforeExpeditionRequest,
} from "./types";

const BASE_URL = "https://app.noest-dz.com";
/** NOEST allows each request up to 30 seconds; a shorter cut would turn slow successes into unknown creations. */
export const NOEST_TIMEOUT_MS = 35_000;

export const noestConfigSchema = z.object({}).strict();
export type NoestConfig = z.infer<typeof noestConfigSchema>;

export interface NoestCredentials {
  apiToken: string;
  userGuid: string;
}

export const NOEST_CAPABILITIES: CarrierCapabilities = {
  homeDelivery: true,
  stopDesk: true,
  separateValidation: true,
  bulkCreate: 100,
  parcelFields: { weight: true, fragile: false, remarks: true },
  limits: { maxAmount: null, maxDescription: 255 },
  update: true,
  cancel: true,
  remarks: { add: true, list: false },
  history: true,
  historyBatch: 50,
  findByReference: false,
  updates: "pull",
  label: true,
  askReturn: true,
  requestNewAttempt: true,
  confirmReturn: false,
  stopDeskList: true,
  verifyConnection: true,
};

interface NoestAnswer {
  success?: boolean;
  message?: string;
  errors?: unknown;
}

function refusal(answer: NoestAnswer, fallback: string): CarrierError {
  const message = flattenErrorBag(answer.errors) ?? answer.message ?? fallback;
  const duplicate = /d[ée]j[àa] existant/i.test(message);
  return new CarrierError("noest", "rejected", message, { carrierCode: duplicate ? "duplicate_order" : null });
}

/** A bulk answer keyed by request index: an object `{"1": …}`, or an array when the keys run 0..n. */
function byIndex(entries: unknown): Map<number, unknown> {
  const map = new Map<number, unknown>();
  if (Array.isArray(entries)) entries.forEach((entry, i) => map.set(i, entry));
  else if (entries && typeof entries === "object") {
    for (const [key, entry] of Object.entries(entries)) if (/^\d+$/.test(key)) map.set(Number(key), entry);
  }
  return map;
}

/** NOEST echoes the order's reference inside its error bag; it is not an error. */
function withoutReference(bag: unknown): unknown {
  if (!bag || typeof bag !== "object" || Array.isArray(bag)) return bag;
  const { reference: _reference, ...errors } = bag as Record<string, unknown>;
  return errors;
}

export class NoestCarrier implements CarrierAdapter {
  readonly provider = "noest" as const;
  readonly capabilities = NOEST_CAPABILITIES;
  private readonly http: CarrierHttp;
  private readonly userGuid: string;

  constructor(credentials: NoestCredentials, _config: NoestConfig = {}) {
    this.userGuid = credentials.userGuid;
    this.http = createCarrierHttp({
      provider: "noest",
      baseUrl: `${BASE_URL}/api/public`,
      timeoutMs: NOEST_TIMEOUT_MS,
      headers: () => ({ Authorization: `Bearer ${credentials.apiToken}`, "Content-Type": "application/json", Accept: "application/json" }),
      describeError: (_status, json) => {
        const body = json as NoestAnswer;
        return flattenErrorBag(body?.errors) ?? body?.message ?? null;
      },
    });
  }

  interpret(status: CarrierStatus): Interpretation {
    return interpretNoest(status);
  }

  private order(input: CarrierShipmentInput, bulk = false): Omit<NoestCreateOrderRequest, "user_guid"> {
    return {
      reference: input.reference,
      client: input.customerName,
      phone: input.phone,
      ...(input.phone2 ? { phone_2: input.phone2 } : {}),
      adresse: input.address.trim() || input.destination.commune.name,
      wilaya_id: input.destination.wilaya.number,
      commune: input.destination.commune.name,
      montant: input.amount,
      produit: input.productDescription,
      type_id: 1,
      stop_desk: input.stopDesk ? 1 : 0,
      ...(input.stopDesk && input.stationCode ? { station_code: input.stationCode } : {}),
      ...(input.remarks ? { remarque: input.remarks } : {}),
      ...(input.weight !== undefined ? { poids: input.weight } : bulk ? { poids: 0 } : {}),
    };
  }

  private parcel(tracking: string, raw: unknown): CarrierParcel {
    return { carrierParcelId: tracking, trackingNumber: tracking, carrierData: raw, labelUrl: null };
  }

  async createShipment(input: CarrierShipmentInput): Promise<CarrierParcel> {
    const res = await this.http.write<NoestCreateOrderResponse>("POST", "/create/order", { user_guid: this.userGuid, ...this.order(input) });
    if (res.tracking) return this.parcel(res.tracking, res);
    if (res.success === false || res.errors || res.message) throw refusal(res, "NOEST refused the order");
    throw new CarrierError("noest", "ambiguous", "NOEST answered without a tracking number");
  }

  /** NOEST keys bulk answers by each order's index in the request. */
  async createShipments(inputs: CarrierShipmentInput[]): Promise<CarrierBulkItem[]> {
    const res = await this.http.write<NoestBulkCreateResponse>("POST", "/create/orders", {
      user_guid: this.userGuid,
      orders: inputs.map((input) => this.order(input, true)),
    });
    const passed = byIndex(res.passed);
    const failed = byIndex(res.failed);
    return inputs.map((input, i): CarrierBulkItem => {
      const reference = input.reference;
      const ok = passed.get(i) as { tracking?: string } | undefined;
      if (ok?.tracking) return { reference, ok: true, parcel: this.parcel(ok.tracking, ok) };
      const refused = failed.get(i);
      if (refused !== undefined) {
        return { reference, ok: false, error: refusal(typeof refused === "string" ? { message: refused } : { errors: withoutReference(refused) }, "NOEST refused this order") };
      }
      return { reference, ok: false, error: new CarrierError("noest", "ambiguous", "NOEST's answer does not say what happened to this order") };
    });
  }

  /**
   * NOEST has no read that takes the partner GUID, so the check posts an order
   * that cannot be created — the GUID alone — and reads how it is refused: 401
   * is the token, 404 "Partenaire introuvable" the GUID, and field errors for
   * the missing client mean both were accepted.
   */
  async verifyConnection(): Promise<CarrierConnectionCheck> {
    try {
      await this.http.read("POST", "/create/order", { user_guid: this.userGuid });
      return { ok: true, code: "valid", message: "Token and partner GUID are valid" };
    } catch (error) {
      if (!(error instanceof CarrierError)) throw error;
      if (error.kind === "auth" || error.httpStatus === 401) return { ok: false, code: "invalid_token", message: "The API token was refused" };
      if (error.httpStatus === 404 && /partenaire/i.test(error.message)) return { ok: false, code: "invalid_user_guid", message: "The partner GUID was refused" };
      if (error.httpStatus === 422) {
        if (/user_guid/i.test(error.message)) return { ok: false, code: "invalid_user_guid", message: "The partner GUID was refused" };
        if (/suspen/i.test(error.message)) return { ok: false, code: "account_suspended", message: "The NOEST partner account is suspended" };
        return { ok: true, code: "valid", message: "Token and partner GUID are valid" };
      }
      throw error;
    }
  }

  /** Validating an order NOEST already validated changes nothing — it counts as done. */
  async validate(ref: CarrierRef): Promise<void> {
    const res = await this.http.write<NoestAnswer>("POST", "/valid/order", { user_guid: this.userGuid, tracking: ref.carrierParcelId });
    if (res.success === false && !/d[ée]j[àa] valid[ée]e/i.test(res.message ?? "")) {
      throw refusal(res, "NOEST refused to validate the order");
    }
  }

  /** Before shipment NOEST edits the order directly; omitted fields stay as they are. */
  async update(ref: CarrierRef, patch: CarrierShipmentPatch): Promise<void> {
    const body: NoestUpdateBeforeExpeditionRequest = { tracking: ref.carrierParcelId };
    if (patch.customerName !== undefined) body.client = patch.customerName;
    if (patch.phone !== undefined) body.tel = patch.phone;
    if (patch.phone2 !== undefined) body.tel2 = patch.phone2;
    if (patch.address !== undefined) body.adresse = patch.address;
    if (patch.destination !== undefined) {
      body.wilaya = patch.destination.wilaya.number;
      body.commune = patch.destination.commune.name;
    }
    if (patch.amount !== undefined) body.montant = patch.amount;
    if (patch.remarks !== undefined) body.remarque = patch.remarks;
    if (patch.weight !== undefined) body.poids = String(patch.weight);
    const res = await this.http.write<NoestAnswer>("POST", "/update/order/before/expedition", body);
    if (res.success === false) throw refusal(res, "NOEST refused the update — the order has probably been shipped");
  }

  async cancel(ref: CarrierRef): Promise<void> {
    const res = await this.http.write<NoestAnswer>("POST", "/delete/order", { user_guid: this.userGuid, tracking: ref.carrierParcelId });
    if (res.success === false) throw refusal(res, "NOEST will not delete this order — it is probably already validated");
  }

  async addRemark(ref: CarrierRef, content: string): Promise<void> {
    const res = await this.http.write<NoestAnswer>("POST", "/add/maj", { tracking: ref.carrierParcelId, content });
    if (res.success === false) throw refusal(res, "NOEST refused the remark");
  }

  async askReturn(ref: CarrierRef): Promise<void> {
    const res = await this.http.write<NoestAnswer>("POST", "/ask/return", { tracking: ref.carrierParcelId });
    if (res.success === false) throw refusal(res, "NOEST refused the return request");
  }

  async requestNewAttempt(ref: CarrierRef): Promise<void> {
    const res = await this.http.write<NoestAnswer>("POST", "/ask/new-tentative", { tracking: ref.carrierParcelId });
    if (res.success === false) throw refusal(res, "NOEST refused the new delivery attempt");
  }

  async fetchHistory(refs: CarrierRef[]): Promise<Map<string, CarrierUpdate[]>> {
    const byParcel = new Map<string, CarrierUpdate[]>(refs.map((r) => [r.carrierParcelId, []]));
    if (refs.length === 0) return byParcel;
    let res: NoestTrackingInfoResponse;
    try {
      res = await this.http.read<NoestTrackingInfoResponse>("POST", "/get/trackings/info", { trackings: refs.map((r) => r.carrierParcelId) });
    } catch (error) {
      // "Trackings non trouvés": none of these parcels exists at NOEST — no history, not an outage.
      if (error instanceof CarrierError && error.kind === "rejected" && /non trouv/i.test(error.message)) return byParcel;
      throw error;
    }
    for (const [tracking, info] of Object.entries(res ?? {})) {
      const updates = byParcel.get(tracking);
      if (!updates) continue;
      const match = { carrierParcelId: tracking, trackingNumber: tracking };
      for (const activity of info.activity ?? []) {
        const occurredAt = carrierInstant(activity.date);
        const key = activity.event_key ?? activity.event;
        if (!occurredAt || !key) continue;
        updates.push({ match, status: { vocabulary: "event", value: key, label: activity.event ?? null }, reason: activity.content || null, occurredAt, raw: activity });
      }
      for (const attempt of info.deliveryAttempts ?? []) {
        const occurredAt = carrierInstant(attempt.created_at);
        if (!occurredAt) continue;
        updates.push({ match, status: { ...NOEST_ATTEMPT }, reason: attempt.content || null, occurredAt, raw: attempt });
      }
    }
    return byParcel;
  }

  /** The label is a PDF behind the same token. */
  async label(ref: CarrierRef): Promise<CarrierLabel> {
    const response = await this.http.readRaw(`/get/order/label?tracking=${encodeURIComponent(ref.carrierParcelId)}`);
    return { kind: "pdf", body: await response.arrayBuffer() };
  }

  /**
   * NOEST checks a commune by its own spelling inside the wilaya. A commune
   * or wilaya NOEST has switched off is listed as not delivered to: NOEST
   * refuses parcels there. Its prices are the account's grid, one per wilaya.
   */
  async places(): Promise<CarrierPlace[]> {
    const [wilayaList, communes, fees] = await Promise.all([
      this.http.read<NoestWilaya[]>("GET", "/get/wilayas"),
      this.http.read<NoestCommunesResponse>("GET", "/get/communes"),
      this.http.read<NoestFeesResponse>("GET", "/fees"),
    ]);
    const delivery = fees.tarifs?.delivery ?? {};
    const returns = fees.tarifs?.return ?? {};
    const rateOf = (wilaya: number) => tarifRate(delivery[String(wilaya)], returns[String(wilaya)]);
    const wilayas = new Map((Array.isArray(wilayaList) ? wilayaList : []).map((w) => [w.code, w]));
    const places: CarrierPlace[] = [];
    for (const c of Object.values(communes ?? {})) {
      const wilaya = c ? wilayas.get(c.wilaya_id) : undefined;
      if (!c || !wilaya) continue;
      places.push({
        wilaya: { ref: String(wilaya.code), number: wilaya.code, name: wilaya.nom },
        commune: { ref: String(c.id), name: c.nom },
        home: c.is_active !== 0 && wilaya.is_active !== 0,
        rate: rateOf(wilaya.code),
      });
    }
    return places;
  }

  /**
   * NOEST publishes no wilaya per desk: its codes start with the wilaya
   * number ("16A"). Its commune field is free text (live, 2026-11-08: "Bordj
   * Bou Arreridj «Ras El Oued»" for the desk named Ras El Oued), so a desk is
   * placed by that or by its name, which is its town.
   */
  async stopDesks(): Promise<CarrierStopDesk[]> {
    const res = await this.http.read<NoestStopDesksResponse>("GET", "/desks");
    return Object.values(res ?? {}).map((d) => {
      const wilaya = Number.parseInt(d.code, 10);
      return {
        code: d.code,
        name: d.name,
        commune: d.commune?.trim() || null,
        communeRef: null,
        address: d.address ?? null,
        phones: d.phones ? Object.values(d.phones).filter(Boolean) : [],
        wilayaNumber: Number.isInteger(wilaya) && wilaya >= 1 ? wilaya : null,
      };
    });
  }
}
