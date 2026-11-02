/**
 * ZR Express (https://api.zrexpress.app) — the carrier contract over its API.
 *
 * Auth: `X-Api-Key` + `X-Tenant`. Facts that shape this adapter (its swagger,
 * live-verified 2026-09-10):
 *   - A parcel's stable id is its UUID; the tracking number can change
 *     (`oldTrackingNumber`), so CodFlow addresses parcels by UUID.
 *   - Creating a parcel takes a ZR customer, the city and district territories
 *     (accent-free names; search is accent-sensitive), and for a pickup point a
 *     real hub id. A single create answers only the UUID; the tracking number
 *     is read back separately and may come later.
 *   - No validation step. Deletion is `DELETE /parcels/bulk/by-tracking-number`.
 *   - State history is per parcel and needs the UUID.
 *   - Four wilayas (33, 37, 50, 56) have no ZR territory at all.
 *   - Updates arrive by Svix webhook; states are per-tenant (see interpret.ts).
 */

import { z } from "zod";
import type { Interpretation } from "../../../../cod-shared/shipments/interpretation";
import {
  CarrierError,
  type CarrierAdapter,
  type CarrierBulkItem,
  type CarrierCapabilities,
  type CarrierLabel,
  type CarrierParcel,
  type CarrierRef,
  type CarrierShipmentInput,
  type CarrierShipmentPatch,
  type CarrierStatus,
  type CarrierStopDesk,
  type CarrierUpdate,
  type CarrierWebhook,
  type InboxEnvelope,
  type WebhookReading,
} from "../contract";
import { createCarrierHttp, flattenErrorBag, type CarrierHttp } from "../http";
import { carrierInstant } from "../time";
import { ZR_MAPPABLE_MEANINGS, zrInterpreter } from "./interpret";
import { verifySvixSignature } from "./signature";
import { stripAccents } from "./text";
import type { CarrierConnectionCheck } from "../contract";
import type {
  ZrCreateBulkParcelsResponse,
  ZrCreateCustomerResponse,
  ZrCreateParcelResponse,
  ZrDeleteBulkResponse,
  ZrGenerateLabelResponse,
  ZrGetParcelResponse,
  ZrHubItem,
  ZrPagedListHubs,
  ZrPagedListTerritories,
  ZrSearchTerritoriesRequest,
  ZrSingleParcelCreationRequest,
  ZrStateHistoryResponse,
  ZrTerritoryItem,
  ZrUpdateCustomerRequest,
  ZrUpdateDeliveryAddressRequest,
} from "./types";

const BASE_URL = "https://api.zrexpress.app/api/v1";

export const zrConfigSchema = z
  .object({
    /** This tenant's state names, by meaning; wins over the default workflow. */
    statusMap: z.partialRecord(z.enum(ZR_MAPPABLE_MEANINGS), z.array(z.string().trim().min(1))).optional(),
  })
  .strict();

export type ZrConfig = z.infer<typeof zrConfigSchema>;

export interface ZrCredentials {
  apiKey: string;
  tenantId: string;
}

export const ZR_CAPABILITIES: CarrierCapabilities = {
  homeDelivery: true,
  stopDesk: true,
  separateValidation: false,
  bulkCreate: 100,
  parcelFields: { weight: false, fragile: false, remarks: false },
  limits: { maxAmount: null, maxDescription: 255 },
  update: true,
  cancel: true,
  remarks: { add: false, list: false },
  history: true,
  historyBatch: 1,
  findByReference: false,
  updates: "webhook",
  label: true,
  askReturn: false,
  requestNewAttempt: false,
  confirmReturn: false,
  stopDeskList: true,
  geoNames: false,
  verifyConnection: true,
};

function describeError(_status: number, json: unknown): string | null {
  const body = (json ?? {}) as { title?: string; detail?: string; message?: string; errors?: unknown };
  return [body.title, body.detail, flattenErrorBag(body.errors)].filter(Boolean).join(" — ") || body.message || null;
}

/** "0551234500" → "+213551234500"; ZR stores international numbers. */
export function internationalPhone(phone: string): string {
  const p = phone.trim().replace(/\s+/g, "");
  if (p.startsWith("+")) return p;
  if (p.startsWith("00")) return `+${p.slice(2)}`;
  if (p.startsWith("0") && p.length === 10) return `+213${p.slice(1)}`;
  return `+${p}`;
}

/**
 * Steps before the parcel itself is created (customer, territories, hub)
 * cannot leave a parcel behind: an unclear outcome there means nothing was
 * shipped, so it is "unavailable", never "ambiguous".
 */
async function beforeParcel<T>(step: () => Promise<T>): Promise<T> {
  try {
    return await step();
  } catch (error) {
    if (error instanceof CarrierError && error.kind === "ambiguous") {
      throw new CarrierError(error.provider, "unavailable", error.message, { httpStatus: error.httpStatus });
    }
    throw error;
  }
}

const isNotFound = (error: unknown) =>
  error instanceof CarrierError && (error.httpStatus === 404 || /not found/i.test(error.message));

export class ZrExpressCarrier implements CarrierAdapter {
  readonly provider = "zr_express" as const;
  readonly capabilities = ZR_CAPABILITIES;
  readonly interpret: (status: CarrierStatus) => Interpretation;
  private readonly http: CarrierHttp;
  private readonly cities = new Map<number, ZrTerritoryItem>();
  private readonly districts = new Map<string, ZrTerritoryItem>();
  private hubs: ZrHubItem[] | null = null;
  private wilayaByTerritory: Map<string, number> | null = null;

  constructor(credentials: ZrCredentials, config: ZrConfig) {
    this.interpret = zrInterpreter(config.statusMap);
    this.http = createCarrierHttp({
      provider: "zr_express",
      baseUrl: BASE_URL,
      headers: () => ({
        "X-Api-Key": credentials.apiKey,
        "X-Tenant": credentials.tenantId,
        "Content-Type": "application/json",
        Accept: "application/json",
      }),
      describeError,
    });
  }

  // ─── Territories and hubs ───────────────────────────────────────────────────

  private async searchTerritories(keyword: string, extra: Partial<ZrSearchTerritoriesRequest> = {}): Promise<ZrTerritoryItem[]> {
    const res = await this.http.read<ZrPagedListTerritories>("POST", "/territories/search", {
      keyword,
      pageSize: 50,
      pageNumber: 1,
      ...extra,
    });
    return res.items ?? [];
  }

  /** The city (wilaya) territory: by accent-free name, then by number (live: 51/58 by name). */
  private async city(wilayaId: number, wilayaName: string): Promise<ZrTerritoryItem> {
    const cached = this.cities.get(wilayaId);
    if (cached) return cached;
    const isTarget = (t: ZrTerritoryItem) => t.code === wilayaId && t.level === "wilaya";
    const found =
      (await this.searchTerritories(stripAccents(wilayaName))).find(isTarget) ??
      (await this.searchTerritories(String(wilayaId), { pageSize: 200 })).find(isTarget);
    if (!found) {
      throw new CarrierError(
        "zr_express",
        "rejected",
        `ZR Express does not serve wilaya ${wilayaId} ("${wilayaName}") — unserved: 33 Illizi, 37 Tindouf, 50 Bordj Badji Mokhtar, 56 Djanet`,
      );
    }
    this.cities.set(wilayaId, found);
    return found;
  }

  /** The commune territory inside that city — never an arbitrary first result. */
  private async district(communeName: string, city: ZrTerritoryItem): Promise<ZrTerritoryItem> {
    const key = `${city.id}|${stripAccents(communeName).toLowerCase().trim()}`;
    const cached = this.districts.get(key);
    if (cached) return cached;
    const found = await this.findDistrict(communeName, city);
    this.districts.set(key, found);
    return found;
  }

  private async findDistrict(communeName: string, city: ZrTerritoryItem): Promise<ZrTerritoryItem> {
    const communes = (await this.searchTerritories(stripAccents(communeName))).filter((t) => t.level === "commune");
    const needle = stripAccents(communeName).toLowerCase();
    const found =
      communes.find((t) => t.parentId === city.id) ??
      communes.find((t) => stripAccents(t.name ?? "").toLowerCase() === needle);
    if (!found) {
      throw new CarrierError("zr_express", "rejected", `ZR Express has no commune "${communeName}" in ${city.name ?? city.id}`);
    }
    return found;
  }

  private async loadHubs(): Promise<ZrHubItem[]> {
    if (this.hubs) return this.hubs;
    const hubs: ZrHubItem[] = [];
    for (let page = 1; page <= 10; page++) {
      const res = await this.http.read<ZrPagedListHubs>("POST", "/hubs/search", { pageSize: 200, pageNumber: page });
      hubs.push(...(res.items ?? []));
      if ((res.items ?? []).length === 0 || page >= (res.totalPages ?? 1)) break;
    }
    this.hubs = hubs;
    return hubs;
  }

  /** A pickup point is a hub; older syncs stored its district territory instead of its id. */
  private async hubForStation(stationCode: string): Promise<ZrHubItem> {
    const hubs = await this.loadHubs();
    const hub = hubs.find((h) => h.id === stationCode) ?? hubs.find((h) => h.address?.districtTerritoryId === stationCode);
    if (!hub) {
      throw new CarrierError("zr_express", "rejected", `ZR Express stop desk "${stationCode}" matches no hub; re-sync the stop desks`);
    }
    return hub;
  }

  // ─── Creation ───────────────────────────────────────────────────────────────

  private async parcelPayload(input: CarrierShipmentInput): Promise<ZrSingleParcelCreationRequest> {
    const phone = { number1: internationalPhone(input.phone), ...(input.phone2 ? { number2: internationalPhone(input.phone2) } : {}) };
    let cityTerritoryId: string;
    let districtTerritoryId: string;
    let hubId: string | null = null;
    if (input.stopDesk) {
      if (!input.stationCode) throw new CarrierError("zr_express", "rejected", "ZR Express stop-desk delivery needs a hub id as station code");
      const hub = await this.hubForStation(input.stationCode);
      cityTerritoryId = hub.address?.cityTerritoryId ?? "";
      districtTerritoryId = hub.address?.districtTerritoryId ?? "";
      hubId = hub.id;
      if (!cityTerritoryId || !districtTerritoryId) {
        throw new CarrierError("zr_express", "rejected", `ZR Express hub ${hub.id} has no city/district territory`);
      }
    } else {
      const city = await this.city(input.wilayaId, input.wilaya);
      cityTerritoryId = city.id;
      districtTerritoryId = (await this.district(input.commune, city)).id;
    }
    const customer = await this.http.write<ZrCreateCustomerResponse>("POST", "/customers/individual", { name: input.customerName, phone });
    if (!customer.id) throw new CarrierError("zr_express", "rejected", "ZR Express created no customer");
    return {
      customer: { customerId: customer.id, name: input.customerName, phone },
      deliveryAddress: { cityTerritoryId, districtTerritoryId, street: input.address || null },
      deliveryType: input.stopDesk ? "pickup-point" : "home",
      amount: input.amount,
      description: input.productDescription,
      externalId: input.reference,
      orderedProducts: [{ productName: input.productDescription, unitPrice: input.amount, quantity: 1, stockType: "none" }],
      ...(hubId ? { hubId } : {}),
    };
  }

  async createShipment(input: CarrierShipmentInput): Promise<CarrierParcel> {
    const payload = await beforeParcel(() => this.parcelPayload(input));
    const created = await this.http.write<ZrCreateParcelResponse>("POST", "/parcels", payload);
    if (!created.id) throw new CarrierError("zr_express", "ambiguous", "ZR Express answered the creation without a parcel id");
    let trackingNumber: string | null = null;
    try {
      trackingNumber = (await this.http.read<ZrGetParcelResponse>("GET", `/parcels/${created.id}`)).trackingNumber ?? null;
    } catch {
      // The parcel exists; its tracking number is read again later.
    }
    return { carrierParcelId: created.id, trackingNumber, carrierData: { parcelId: created.id }, labelUrl: null };
  }

  async createShipments(inputs: CarrierShipmentInput[]): Promise<CarrierBulkItem[]> {
    const built: Array<{ reference: string; payload: ZrSingleParcelCreationRequest }> = [];
    const failed = new Map<string, CarrierError>();
    for (const input of inputs) {
      try {
        built.push({ reference: input.reference, payload: await beforeParcel(() => this.parcelPayload(input)) });
      } catch (error) {
        failed.set(input.reference, error instanceof CarrierError ? error : new CarrierError("zr_express", "rejected", String(error)));
      }
    }
    const res = built.length
      ? await this.http.write<ZrCreateBulkParcelsResponse>("POST", "/parcels/bulk", { parcels: built.map((b) => b.payload) })
      : { successes: [], failures: [] };

    const successes = new Map((res.successes ?? []).map((s) => [s.index, s]));
    const failures = new Map<number, string[]>();
    for (const f of res.failures ?? []) failures.set(f.index, [...(failures.get(f.index) ?? []), f.errorMessage ?? f.errorCode ?? "unknown error"]);

    return inputs.map((input): CarrierBulkItem => {
      const reference = input.reference;
      const early = failed.get(reference);
      if (early) return { reference, ok: false, error: early };
      const index = built.findIndex((b) => b.reference === reference);
      const success = successes.get(index);
      if (success?.parcelId) {
        return {
          reference,
          ok: true,
          parcel: { carrierParcelId: success.parcelId, trackingNumber: success.trackingNumber ?? null, carrierData: { parcelId: success.parcelId }, labelUrl: null },
        };
      }
      const reasons = failures.get(index);
      return reasons
        ? { reference, ok: false, error: new CarrierError("zr_express", "rejected", reasons.join("; ")) }
        : { reference, ok: false, error: new CarrierError("zr_express", "ambiguous", "ZR Express returned no result for this parcel") };
    });
  }

  // ─── Operations on a parcel ─────────────────────────────────────────────────

  private async parcel(ref: CarrierRef): Promise<ZrGetParcelResponse> {
    return this.http.read<ZrGetParcelResponse>("GET", `/parcels/${ref.carrierParcelId}`);
  }

  private async tracking(ref: CarrierRef): Promise<string> {
    const tracking = ref.trackingNumber ?? (await this.parcel(ref)).trackingNumber;
    if (!tracking) throw new CarrierError("zr_express", "rejected", `ZR Express parcel ${ref.carrierParcelId} has no tracking number yet`);
    return tracking;
  }

  /**
   * ZR has one PATCH per aspect (amount, customer, delivery address). An
   * address change sends the full territory pair, and a pickup-point parcel
   * also needs the hub that serves the district (live-verified).
   */
  async update(ref: CarrierRef, patch: CarrierShipmentPatch): Promise<void> {
    const id = ref.carrierParcelId;
    const current = await this.parcel(ref);

    if (patch.amount !== undefined && patch.amount !== current.amount) {
      await this.http.write("PATCH", `/parcels/${id}/amount`, { parcelId: id, amount: patch.amount });
    }

    const name = patch.customerName;
    const phone = patch.phone !== undefined ? internationalPhone(patch.phone) : undefined;
    if ((name !== undefined && name !== current.customer?.name) || (phone !== undefined && phone !== current.customer?.phone?.number1)) {
      const body: ZrUpdateCustomerRequest = { parcelId: id };
      if (name !== undefined) body.name = name;
      if (phone !== undefined) body.phone = phone;
      await this.http.write("PATCH", `/parcels/${id}/customer`, body);
    }

    const address = current.deliveryAddress ?? {};
    const moveTerritory =
      (patch.wilayaId !== undefined && patch.wilayaId !== address.cityTerritoryCode) ||
      (patch.commune !== undefined && patch.commune !== address.district);
    const moveStreet = patch.address !== undefined && patch.address !== (address.street ?? "");
    if (!moveTerritory && !moveStreet) return;

    let cityTerritoryId = address.cityTerritoryId ?? undefined;
    let districtTerritoryId = address.districtTerritoryId ?? undefined;
    if (moveTerritory) {
      if (patch.wilayaId === undefined || patch.commune === undefined) {
        throw new CarrierError("zr_express", "rejected", "ZR Express needs both the wilaya and the commune to move a parcel");
      }
      const city = await this.city(patch.wilayaId, patch.wilaya ?? String(patch.wilayaId));
      cityTerritoryId = city.id;
      districtTerritoryId = (await this.district(patch.commune, city)).id;
    }
    const body: ZrUpdateDeliveryAddressRequest = {
      parcelId: id,
      deliveryAddress: { street: patch.address ?? address.street ?? undefined, cityTerritoryId, districtTerritoryId },
    };
    if (current.deliveryType === "pickup-point") {
      const hub = (await this.loadHubs()).find((h) => h.address?.districtTerritoryId === districtTerritoryId);
      if (!hub) throw new CarrierError("zr_express", "rejected", `No ZR Express hub serves district ${districtTerritoryId}`);
      body.hubId = hub.id;
    }
    await this.http.write("PATCH", `/parcels/${id}/deliveryAddress`, body);
  }

  /** A parcel already gone at ZR counts as cancelled. */
  async cancel(ref: CarrierRef): Promise<void> {
    let tracking: string;
    try {
      tracking = await this.tracking(ref);
    } catch (error) {
      if (isNotFound(error)) return;
      throw error;
    }
    let res: ZrDeleteBulkResponse;
    try {
      res = await this.http.write<ZrDeleteBulkResponse>("DELETE", "/parcels/bulk/by-tracking-number", { trackingNumbers: [tracking] });
    } catch (error) {
      if (isNotFound(error)) return;
      throw error;
    }
    if (res.successCount === 1) return;
    const reasons = (res.failures ?? []).map((f) => f.errorMessage ?? f.errorCode ?? "unknown");
    if (reasons.length > 0 && reasons.every((r) => /not found/i.test(r))) return;
    throw new CarrierError("zr_express", "rejected", `ZR Express will not delete parcel ${tracking}: ${reasons.join("; ") || "no reason given"}`);
  }

  async fetchHistory(refs: CarrierRef[]): Promise<Map<string, CarrierUpdate[]>> {
    const byParcel = new Map<string, CarrierUpdate[]>();
    for (const ref of refs) {
      const history = await this.http.read<ZrStateHistoryResponse>("GET", `/parcels/${ref.carrierParcelId}/state-history`);
      const updates: CarrierUpdate[] = [];
      for (const row of history ?? []) {
        const occurredAt = carrierInstant(row.createdAt);
        if (!occurredAt || !row.newState?.name) continue;
        updates.push({
          match: { carrierParcelId: ref.carrierParcelId },
          status: { vocabulary: "state", value: row.newState.name, label: row.newState.description ?? null },
          reason: null,
          occurredAt,
          raw: row,
        });
      }
      byParcel.set(ref.carrierParcelId, updates);
    }
    return byParcel;
  }

  /** ZR issues a time-limited signed PDF link per request. */
  async label(ref: CarrierRef): Promise<CarrierLabel> {
    const tracking = await this.tracking(ref);
    const res = await this.http.read<ZrGenerateLabelResponse>("POST", "/parcels/labels/individual/pdf", {
      trackingNumbers: [tracking],
      format: "a6",
    });
    const url = res.parcelLabelFiles?.[0]?.fileUrl;
    if (!url) throw new CarrierError("zr_express", "rejected", `ZR Express produced no label for ${tracking}`);
    return { kind: "url", url };
  }

  /** ZR stop desks are hubs marked as pickup points; their wilaya comes from the city territory. */
  async stopDesks(): Promise<CarrierStopDesk[]> {
    const [hubs, wilayas] = await Promise.all([this.loadHubs(), this.wilayaCodes()]);
    return hubs
      .filter((h) => h.isPickupPoint)
      .map((h) => ({
        code: h.id,
        name: h.name ?? h.id,
        commune: null,
        address: null,
        phones: [],
        wilayaId: h.address?.cityTerritoryId ? wilayas.get(h.address.cityTerritoryId) ?? null : null,
      }));
  }

  private async wilayaCodes(): Promise<Map<string, number>> {
    if (this.wilayaByTerritory) return this.wilayaByTerritory;
    const map = new Map<string, number>();
    for (let page = 1; page <= 5; page++) {
      const res = await this.http.read<ZrPagedListTerritories>("POST", "/territories/search", { keyword: "", pageSize: 1000, pageNumber: page });
      for (const t of res.items ?? []) if (t.level === "wilaya" && typeof t.code === "number") map.set(t.id, t.code);
      if ((res.items ?? []).length === 0 || page >= (res.totalPages ?? 1)) break;
    }
    this.wilayaByTerritory = map;
    return map;
  }

  /**
   * `/users/profile` answers 200 for any tenant, so it proves only the key. A
   * tenant-scoped read proves both: a refused key is 401, a refused tenant 403.
   */
  async verifyConnection(): Promise<CarrierConnectionCheck> {
    try {
      await this.http.read("POST", "/hubs/search", { pageSize: 1, pageNumber: 1 });
      return { ok: true, code: "valid", message: "API key and tenant are valid" };
    } catch (error) {
      if (error instanceof CarrierError && error.httpStatus === 401) return { ok: false, code: "invalid_key", message: "The API key was refused" };
      if (error instanceof CarrierError && error.httpStatus === 403) return { ok: false, code: "invalid_tenant", message: "The tenant ID was refused" };
      throw error;
    }
  }

  readonly webhook: CarrierWebhook = zrWebhook;
}

interface ZrWebhookPayload {
  eventType?: string;
  occurredAt?: string;
  data?: Record<string, unknown>;
}

/**
 * ZR webhooks are delivered by Svix: one event per request, idempotency key in
 * the `svix-id` header, signature over `id.timestamp.body`.
 */
export const zrWebhook: CarrierWebhook = {
  verify(rawBody, headers, secret) {
    return verifySvixSignature(rawBody, headers.get("svix-id"), headers.get("svix-timestamp"), headers.get("svix-signature"), secret);
  },

  split(rawBody, headers): InboxEnvelope[] {
    const payload = JSON.parse(rawBody) as ZrWebhookPayload;
    const eventId = headers.get("svix-id");
    if (!eventId) throw new CarrierError("zr_express", "rejected", "ZR Express webhook without svix-id");
    return [{ eventId, eventType: payload.eventType ?? "unknown", payload: rawBody }];
  },

  read(envelope): WebhookReading {
    const payload = JSON.parse(envelope.payload) as ZrWebhookPayload;
    const data = payload.data ?? {};
    const text = (v: unknown) => (typeof v === "string" && v ? v : undefined);
    // A return can be its own parcel; its updates belong to the original one.
    const carrierParcelId = text(data.originalParcelId) ?? text(data.id);
    const match = { carrierParcelId, trackingNumber: text(data.trackingNumber), reference: text(data.externalId) };
    if (!match.carrierParcelId && !match.trackingNumber && !match.reference) return { kind: "ignored", reason: "no parcel identity in event" };

    let status: CarrierStatus;
    let reason: string | null = null;
    switch (envelope.eventType) {
      case "parcel.state.updated": {
        const state = (data.state ?? {}) as { name?: unknown; description?: unknown };
        if (!text(state.name)) return { kind: "ignored", reason: "state without a name" };
        status = { vocabulary: "state", value: text(state.name)!, label: text(state.description) ?? null };
        break;
      }
      case "parcel.isReturn.updated":
        if (data.isReturn !== true) return { kind: "ignored", reason: "return flag cleared" };
        status = { vocabulary: "event", value: "isReturn:true" };
        break;
      case "parcel.state.situation.created": {
        const situation = (data.situation ?? {}) as { name?: unknown };
        if (!text(situation.name)) return { kind: "ignored", reason: "situation without a name" };
        status = { vocabulary: "situation", value: text(situation.name)! };
        reason = text(situation.name)!;
        break;
      }
      default:
        return { kind: "ignored", reason: `event type ${envelope.eventType}` };
    }

    const occurredAt = carrierInstant(payload.occurredAt);
    if (!occurredAt) throw new CarrierError("zr_express", "rejected", `Unreadable occurredAt "${payload.occurredAt}" in event ${envelope.eventId}`);
    return { kind: "update", update: { match, status, reason, occurredAt, raw: payload } };
  },
};
