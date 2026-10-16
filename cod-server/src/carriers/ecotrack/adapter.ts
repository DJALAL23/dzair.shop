/**
 * EcoTrack platform (Packers, TNT, … — `<company>.ecotrack.dz`) — the carrier
 * contract over its public API v1.
 *
 * Auth: `Authorization: Bearer`, except `validate/token` and
 * `get/orders/status`, which take `api_token` as a query parameter. Each
 * company has its own base URL. Facts that shape this adapter (Postman
 * collection and API reference in `.agents/skills/Ecotrack/`):
 *   - Single-order endpoints take query parameters, no body; bulk create and
 *     `valid/returns` take JSON.
 *   - Failures come three ways: HTTP 429 (50 requests/minute), HTTP 422
 *     Laravel field errors, and HTTP 200 `{success:false, error:<code>}`
 *     (10001 not modifiable, 10002 wilaya not served, 10003 not returnable).
 *   - A created parcel waits for `valid/order` ("expédier"); after it, no edit
 *     or deletion. An update must resend the full delivery details (Packers
 *     rejects a partial one) and silently ignores changes after validation.
 *   - No webhooks: CodFlow pulls history (`get/tracking/info`) on a schedule.
 *   - No search by reference: `get/orders` rows carry it, so the handoff day's
 *     pages are scanned.
 */

import { z } from "zod";
import type { Interpretation } from "../../../../cod-shared/shipments/interpretation";
import {
  CarrierError,
  type CarrierAdapter,
  type CarrierBulkItem,
  type CarrierCapabilities,
  type CarrierConnectionCheck,
  type CarrierLabel,
  type CarrierParcel,
  type CarrierRef,
  type CarrierRemark,
  type CarrierShipmentInput,
  type CarrierShipmentPatch,
  type CarrierStatus,
  type CarrierStopDesk,
  type CarrierUpdate,
  type CarrierGeoNames,
} from "../contract";
import { createCarrierHttp, flattenErrorBag, type CarrierHttp } from "../http";
import { carrierInstant } from "../time";
import { ecotrackLabel, interpretEcotrack } from "./interpret";
import type {
  EcotrackBulkCreateResult,
  EcotrackCommunesResponse,
  EcotrackCreateOrderResponse,
  EcotrackDeleteOrderResponse,
  EcotrackGetMajResponse,
  EcotrackOrdersPage,
  EcotrackTrackingInfoResponse,
  EcotrackValidateTokenResponse,
  EcotrackWilayasResponse,
  EcotrackOrdersStatusResponse,
} from "./types";

/** EcoTrack has no settings beyond its credentials. */
export const ecotrackConfigSchema = z.object({}).strict();
export type EcotrackConfig = z.infer<typeof ecotrackConfigSchema>;

export interface EcotrackCredentials {
  apiToken: string;
  /** The company's own EcoTrack host, e.g. https://packers.ecotrack.dz */
  baseUrl: string;
}

export const ECOTRACK_CAPABILITIES: CarrierCapabilities = {
  homeDelivery: true,
  stopDesk: true,
  separateValidation: true,
  bulkCreate: 100,
  parcelFields: { weight: true, fragile: true, remarks: true },
  limits: { maxAmount: null, maxDescription: 255 },
  update: true,
  cancel: true,
  remarks: { add: true, list: true },
  history: true,
  historyBatch: 20,
  findByReference: true,
  updates: "pull",
  label: true,
  askReturn: true,
  requestNewAttempt: false,
  confirmReturn: true,
  stopDeskList: true,
  geoNames: true,
  verifyConnection: true,
};

/** Pages of `get/orders` scanned when looking for a lost creation (40 orders each). */
const REFERENCE_SCAN_PAGES = 10;

function describeError(status: number, json: unknown): string | null {
  const body = (json ?? {}) as { message?: string; errors?: unknown };
  const detail = flattenErrorBag(body.errors);
  if (status === 429) return "rate limit (50 requests/minute)";
  return detail ? `${body.message ?? "request refused"} — ${detail}` : body.message ?? null;
}

interface BusinessAnswer {
  success?: boolean;
  error?: number;
  message?: string;
  errors?: unknown;
}

/** An HTTP-200 refusal: `{success:false, error:<code>}`. */
function businessRefusal(answer: BusinessAnswer, fallback: string): CarrierError {
  const message = flattenErrorBag(answer.errors) ?? answer.message ?? fallback;
  return new CarrierError("ecotrack", "rejected", answer.error != null ? `EcoTrack ${answer.error}: ${message}` : message, {
    carrierCode: answer.error ?? null,
  });
}

const query = (params: Record<string, string | number | undefined>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined) search.set(key, String(value));
  return search.toString();
};

const day = (date: Date) => date.toISOString().slice(0, 10);

/** Parcels per `get/orders/status` call (EcoTrack's limit). */
const STATUS_BATCH = 100;

/** EcoTrack requires an address on every parcel; a stop-desk one may have none, so the desk's commune stands in. */
function addressOf(address: string | undefined, commune: string | undefined): string | undefined {
  return address?.trim() || commune;
}

export class EcotrackCarrier implements CarrierAdapter {
  readonly provider = "ecotrack" as const;
  readonly capabilities = ECOTRACK_CAPABILITIES;
  private readonly http: CarrierHttp;
  private readonly apiToken: string;
  private readonly baseUrl: string;

  constructor(credentials: EcotrackCredentials, _config: EcotrackConfig = {}) {
    this.apiToken = credentials.apiToken;
    this.baseUrl = credentials.baseUrl.replace(/\/+$/, "");
    this.http = createCarrierHttp({
      provider: "ecotrack",
      baseUrl: `${this.baseUrl}/api/v1`,
      headers: () => ({ Authorization: `Bearer ${credentials.apiToken}`, "Content-Type": "application/json", Accept: "application/json" }),
      describeError,
    });
  }

  interpret(status: CarrierStatus): Interpretation {
    return interpretEcotrack(status);
  }

  private orderParams(input: CarrierShipmentInput): Record<string, string | number | undefined> {
    return {
      reference: input.reference,
      nom_client: input.customerName,
      telephone: input.phone,
      telephone_2: input.phone2,
      adresse: addressOf(input.address, input.commune),
      code_wilaya: input.wilayaId,
      commune: input.commune,
      code_postal: input.stopDesk ? input.stationCode : undefined,
      montant: input.amount,
      remarque: input.remarks,
      produit: input.productDescription,
      type: 1,
      stop_desk: input.stopDesk ? 1 : 0,
      weight: input.weight,
      fragile: input.fragile === undefined ? undefined : input.fragile ? 1 : 0,
    };
  }

  private parcel(tracking: string, raw: unknown): CarrierParcel {
    return { carrierParcelId: tracking, trackingNumber: tracking, carrierData: raw, labelUrl: null };
  }

  async createShipment(input: CarrierShipmentInput): Promise<CarrierParcel> {
    const res = await this.http.write<EcotrackCreateOrderResponse>("POST", `/create/order?${query(this.orderParams(input))}`);
    if (res.success === false) throw businessRefusal(res, "EcoTrack refused the order");
    if (!res.tracking) throw new CarrierError("ecotrack", "ambiguous", "EcoTrack answered without a tracking number");
    return this.parcel(res.tracking, res);
  }

  async createShipments(inputs: CarrierShipmentInput[]): Promise<CarrierBulkItem[]> {
    const orders: Record<string, Record<string, string | number>> = {};
    inputs.forEach((input, i) => {
      const params = this.orderParams(input);
      orders[String(i)] = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined)) as Record<string, string | number>;
    });
    const res = await this.http.write<EcotrackBulkCreateResult>("POST", "/create/orders", { orders });
    return inputs.map((input, i): CarrierBulkItem => {
      const reference = input.reference;
      const entry = res.results?.[reference] ?? res.results?.[String(i)];
      if (!entry) {
        return { reference, ok: false, error: new CarrierError("ecotrack", "ambiguous", "EcoTrack returned no result for this order") };
      }
      if ("tracking" in entry && typeof entry.tracking === "string" && entry.tracking) {
        return { reference, ok: true, parcel: this.parcel(entry.tracking, entry) };
      }
      const { success: _flag, ...reasons } = entry as Record<string, unknown>;
      const message = Object.values(reasons).flat().map(String).join("; ") || "EcoTrack refused this order";
      return { reference, ok: false, error: new CarrierError("ecotrack", "rejected", message) };
    });
  }

  async validate(ref: CarrierRef, options?: { requestPickup?: boolean }): Promise<void> {
    const params = query({ tracking: ref.carrierParcelId, ask_collection: options?.requestPickup === undefined ? undefined : options.requestPickup ? 1 : 0 });
    const res = await this.http.write<BusinessAnswer>("POST", `/valid/order?${params}`);
    if (res.success === false) throw businessRefusal(res, "EcoTrack refused to validate the order");
  }

  /** EcoTrack replaces the parcel's delivery details as a whole: every one must be sent. */
  async update(ref: CarrierRef, patch: CarrierShipmentPatch): Promise<void> {
    const missing = (["phone", "address", "wilayaId", "commune", "amount"] as const).filter((k) => patch[k] === undefined);
    if (missing.length > 0) {
      throw new CarrierError("ecotrack", "rejected", `EcoTrack needs the full delivery details to update a parcel (missing: ${missing.join(", ")})`);
    }
    const params = query({
      tracking: ref.carrierParcelId,
      reference: patch.reference,
      type: 1,
      client: patch.customerName,
      tel: patch.phone,
      tel2: patch.phone2,
      adresse: addressOf(patch.address, patch.commune),
      wilaya: patch.wilayaId,
      commune: patch.commune,
      montant: patch.amount,
      remarque: patch.remarks,
      fragile: patch.fragile === undefined ? undefined : patch.fragile ? 1 : 0,
    });
    const res = await this.http.write<BusinessAnswer>("POST", `/update/order?${params}`);
    if (res.success === false) throw businessRefusal(res, "EcoTrack refused the update");
  }

  async cancel(ref: CarrierRef): Promise<void> {
    const res = await this.http.write<EcotrackDeleteOrderResponse>("DELETE", `/delete/order?${query({ tracking: ref.carrierParcelId })}`);
    if (res.delete === "fail" || res.success === false) {
      throw businessRefusal(res, "EcoTrack will not delete this order — it is probably already validated");
    }
  }

  async addRemark(ref: CarrierRef, content: string): Promise<void> {
    const res = await this.http.write<BusinessAnswer>("POST", `/add/maj?${query({ tracking: ref.carrierParcelId, content })}`);
    if (res.success === false) throw businessRefusal(res, "EcoTrack refused the remark");
  }

  async listRemarks(ref: CarrierRef): Promise<CarrierRemark[]> {
    const res = await this.http.read<EcotrackGetMajResponse>("GET", `/get/maj?${query({ tracking: ref.carrierParcelId })}`);
    return (Array.isArray(res) ? res : []).map((e) => ({ content: e.remarque ?? "", createdAt: carrierInstant(e.created_at) }));
  }

  async fetchHistory(refs: CarrierRef[]): Promise<Map<string, CarrierUpdate[]>> {
    const byParcel = new Map<string, CarrierUpdate[]>();
    for (const ref of refs) {
      const res = await this.http.read<EcotrackTrackingInfoResponse>("GET", `/get/tracking/info?${query({ tracking: ref.carrierParcelId })}`);
      const updates: CarrierUpdate[] = [];
      for (const activity of res.activity ?? []) {
        const occurredAt = carrierInstant(activity.date && activity.time ? `${activity.date} ${activity.time}` : activity.date);
        if (!activity.status || !occurredAt) continue;
        updates.push({
          match: { carrierParcelId: ref.carrierParcelId, trackingNumber: ref.carrierParcelId },
          status: { vocabulary: "activity", value: activity.status, label: ecotrackLabel(activity.status) },
          reason: activity.station || null,
          occurredAt,
          raw: activity,
        });
      }
      byParcel.set(ref.carrierParcelId, updates);
    }
    // The dashboard bucket says what the history may not: a parcel the
    // carrier suspended or cancelled has no activity for it.
    const seenAt = new Date(Math.floor(Date.now() / 1000) * 1000).toISOString();
    for (let start = 0; start < refs.length; start += STATUS_BATCH) {
      const trackings = refs.slice(start, start + STATUS_BATCH).map((ref) => ref.carrierParcelId);
      const res = await this.http.read<EcotrackOrdersStatusResponse>("GET", `/get/orders/status?${query({ api_token: this.apiToken, trackings: trackings.join(","), status: "all" })}`);
      for (const tracking of trackings) {
        const bucket = res.data?.[tracking]?.status;
        if (!bucket || bucket === "all") continue;
        byParcel.get(tracking)?.push({
          match: { carrierParcelId: tracking, trackingNumber: tracking },
          status: { vocabulary: "status", value: bucket, label: ecotrackLabel(bucket) },
          reason: null,
          occurredAt: seenAt,
          raw: res.data?.[tracking],
          snapshot: true,
        });
      }
    }
    return byParcel;
  }

  /** One page of the company's in-process orders (40 per page, archived excluded). */
  async listOrders(options: { page: number; from?: Date; to?: Date }): Promise<EcotrackOrdersPage> {
    const res = await this.http.read<Partial<EcotrackOrdersPage>>(
      "GET",
      `/get/orders?${query({ page: options.page, start_date: options.from && day(options.from), end_date: options.to && day(options.to) })}`,
    );
    const data = Array.isArray(res.data) ? res.data : [];
    return {
      current_page: res.current_page ?? options.page,
      data,
      last_page: res.last_page ?? options.page,
      per_page: res.per_page ?? 40,
      total: res.total ?? data.length,
      from: res.from ?? null,
      to: res.to ?? null,
    };
  }

  async findByReference(reference: string, createdOn: Date): Promise<CarrierParcel | null> {
    const from = new Date(createdOn.getTime() - 86_400_000);
    const to = new Date(createdOn.getTime() + 86_400_000);
    const found: string[] = [];
    for (let page = 1; page <= REFERENCE_SCAN_PAGES; page++) {
      const res = await this.listOrders({ page, from, to });
      for (const row of res.data) if (row.reference === reference) found.push(row.tracking);
      if (page >= res.last_page) break;
    }
    if (found.length > 1) {
      throw new CarrierError("ecotrack", "rejected", `EcoTrack has ${found.length} orders for reference "${reference}"; choose the right tracking number by hand`);
    }
    return found.length === 1 ? this.parcel(found[0], { tracking: found[0], reference }) : null;
  }

  /** The label is a PDF behind the same token, so CodFlow fetches it for the merchant. */
  async label(ref: CarrierRef): Promise<CarrierLabel> {
    const response = await this.http.readRaw(`/get/order/label?${query({ tracking: ref.carrierParcelId })}`);
    return { kind: "pdf", body: await response.arrayBuffer() };
  }

  /** A request: EcoTrack documents that the courier may ignore it. */
  async askReturn(ref: CarrierRef): Promise<void> {
    const res = await this.http.write<BusinessAnswer>("POST", `/ask/for/order/return?${query({ tracking: ref.carrierParcelId })}`);
    if (res.success === false) throw businessRefusal(res, "EcoTrack cannot return this parcel now");
  }

  async confirmReturn(refs: CarrierRef[]): Promise<boolean> {
    if (refs.length === 0) return false;
    const res = await this.http.write<{ returned?: string }>("POST", "/valid/returns", { trackings: refs.map((r) => r.carrierParcelId) });
    return res.returned === "success";
  }

  /** On EcoTrack the stop desk is the commune; its code is the postal code. */
  async stopDesks(): Promise<CarrierStopDesk[]> {
    const res = await this.http.read<EcotrackCommunesResponse>("GET", "/get/communes");
    return Object.values(res ?? {})
      .filter((c) => c != null && c.has_stop_desk === 1)
      .map((c) => ({ code: c.code_postal, name: c.nom, commune: c.nom, address: null, phones: [], wilayaId: c.wilaya_id }));
  }

  /**
   * EcoTrack checks a parcel's commune by its own spelling, within the
   * wilaya: its names, mapped once per company, are what parcels carry.
   */
  async geoNames(): Promise<CarrierGeoNames> {
    const [wilayas, communes] = await Promise.all([
      this.http.read<EcotrackWilayasResponse>("GET", "/get/wilayas"),
      this.http.read<EcotrackCommunesResponse>("GET", "/get/communes"),
    ]);
    return {
      wilayas: (Array.isArray(wilayas) ? wilayas : []).map((w) => ({ id: w.wilaya_id, name: w.wilaya_name })),
      communes: Object.values(communes ?? {})
        .filter((c) => c != null)
        .map((c, index) => ({ id: index + 1, name: c.nom, wilayaId: c.wilaya_id })),
    };
  }

  /**
   * `validate/token` authenticates by query parameter; a bad token is a check
   * result, not an error. The documented answer is HTTP 200 `INVALID_TOKEN`,
   * but a live company (mono2, 2026-10-16) answers 401 `Unauthenticated.`.
   */
  async verifyConnection(): Promise<CarrierConnectionCheck> {
    let res: EcotrackValidateTokenResponse;
    try {
      res = await this.http.read<EcotrackValidateTokenResponse>("GET", `/validate/token?${query({ api_token: this.apiToken })}`);
    } catch (error) {
      if (error instanceof CarrierError && (error.kind === "auth" || error.httpStatus === 401)) {
        return { ok: false, code: "invalid_token", message: "The token was refused" };
      }
      throw error;
    }
    if (res.success && res.message === "VALID_TOKEN") {
      try {
        const wilayas = await this.http.read<EcotrackWilayasResponse>("GET", "/get/wilayas");
        const served = Array.isArray(wilayas) ? wilayas.map((w) => w.wilaya_id) : [];
        return { ok: true, code: "valid", message: "Token is valid", details: { servedWilayaIds: served, servedWilayaCount: served.length } };
      } catch {
        return { ok: true, code: "valid", message: "Token is valid" };
      }
    }
    if (res.message === "TOKEN_NOT_ALLOWED") {
      return { ok: false, code: "not_allowed", message: "Public API access is disabled for this account — enable it in the courier's dashboard" };
    }
    return { ok: false, code: "invalid_token", message: res.message ?? "Token is invalid" };
  }
}
