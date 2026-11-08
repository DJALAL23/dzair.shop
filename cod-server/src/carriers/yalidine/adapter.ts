/**
 * The Yalidine platform — the carrier contract over its REST API.
 *
 * Two carriers run on it with the same API on different hosts: Yalidine
 * (`api.yalidine.app`) and Guepex (`api.guepex.app`; its documentation is
 * Yalidine's word for word, plus the optional `economic` and
 * `opening_decision` parcel fields, and has no webhook section). A company
 * names its platform in its settings.
 *
 * Auth: `X-API-ID` + `X-API-TOKEN`. Facts that shape this adapter (official
 * docs):
 *   - Parcels are created by POSTing an array; the answer is keyed by our
 *     `order_id` and each parcel succeeds or fails on its own.
 *   - No validation step: a parcel is live at creation. It can be edited or
 *     deleted only while its status is `En préparation`.
 *   - Wilaya and commune are matched by name: a parcel carries the carrier's
 *     own spelling, from the company's map of places (built from its lists).
 *   - `GET /parcels?order_id=` finds a parcel by our reference — what resolves
 *     a creation whose answer was lost.
 *   - GET/PATCH answers mask personal data; never copy it back into CodFlow.
 *   - Yalidine's Cloudflare zone blocks Worker egress (403, error 1106), so an
 *     account may route every call through a relay (`proxyBaseUrl`).
 *   - Rate limits: 5/s, 50/min, 1000/h, 10000/day; 429 with Retry-After.
 */

import { z } from "zod";
import type { Interpretation } from "../../../../cod-shared/shipments/interpretation";
import {
  CarrierError,
  type CarrierAdapter,
  type CarrierBulkItem,
  type CarrierCapabilities,
  type CarrierPlace,
  type CarrierRate,
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
import { placeKey } from "../../../../cod-shared/places";
import { createCarrierHttp, type CarrierHttp } from "../http";
import { NO_RATE, amount, deliveryPrice } from "../price";
import { carrierInstant } from "../time";
import { interpretYalidine } from "./interpret";
import { verifyYalidineSignature } from "./signature";
import type {
  YalidineCenterList,
  YalidineCommuneItem,
  YalidineCommuneList,
  YalidineCreateParcelData,
  YalidineCreateParcelResponse,
  YalidineDeleteParcelResponse,
  YalidineFees,
  YalidineHistoryResponse,
  YalidineParcelList,
  YalidineUpdateParcelRequest,
  YalidineWebhookDelivery,
  YalidineWilayaList,
} from "./types";

/** Platforms that run the Yalidine API, and their hosts. */
export const YALIDINE_PLATFORMS = {
  yalidine: { label: "Yalidine", baseUrl: "https://api.yalidine.app/v1" },
  guepex: { label: "Guepex", baseUrl: "https://api.guepex.app/v1" },
} as const;
export type YalidinePlatform = keyof typeof YALIDINE_PLATFORMS;
/** The documented price and declared-value ceiling. */
const MAX_AMOUNT = 150_000;
const PAGE = "page_size=1000";
/** Between two fees calls: 46 a minute at most, under Yalidine's 50, with room for the two list calls. */
export const FEES_CALL_SPACING_MS = 1_300;
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export const yalidineConfigSchema = z
  .object({
    /** Which carrier on the platform this company is. */
    platform: z.enum(["yalidine", "guepex"]).default("yalidine"),
    /** The sender's wilaya, required on every parcel, in Yalidine's spelling. */
    fromWilayaName: z.string().trim().min(1).default("Alger"),
    /** A relay that mirrors Yalidine's paths, for Worker egress. */
    proxyBaseUrl: z.string().url().optional(),
    proxySecret: z.string().min(1).optional(),
  })
  .strict();

export type YalidineConfig = z.infer<typeof yalidineConfigSchema>;

export interface YalidineCredentials {
  apiId: string;
  apiToken: string;
}

export const YALIDINE_CAPABILITIES: CarrierCapabilities = {
  homeDelivery: true,
  stopDesk: true,
  separateValidation: false,
  bulkCreate: 100,
  parcelFields: { weight: true, fragile: false, remarks: false },
  limits: { maxAmount: MAX_AMOUNT, maxDescription: 255 },
  update: true,
  cancel: true,
  remarks: { add: false, list: false },
  history: true,
  historyBatch: 50,
  findByReference: true,
  updates: "webhook",
  label: true,
  askReturn: false,
  requestNewAttempt: false,
  confirmReturn: false,
  stopDeskList: true,
  verifyConnection: false,
};

/** Yalidine pushes updates; Guepex documents no webhooks, so its parcels are pulled. */
export function yalidineCapabilities(platform: YalidinePlatform): CarrierCapabilities {
  return platform === "yalidine" ? YALIDINE_CAPABILITIES : { ...YALIDINE_CAPABILITIES, updates: "pull" };
}

function splitName(fullName: string): { firstname: string; familyname: string } {
  const parts = fullName.trim().split(/\s+/);
  return { firstname: parts[0], familyname: parts.length > 1 ? parts.slice(1).join(" ") : parts[0] };
}

function describeError(_status: number, json: unknown): string | null {
  const body = json as { message?: unknown; error?: unknown } | null;
  if (!body || typeof body !== "object") return null;
  if (typeof body.message === "string" && body.message) return body.message;
  if (typeof body.error === "string" && body.error) return body.error;
  const nested = body.error as { message?: unknown } | undefined;
  return nested && typeof nested.message === "string" ? nested.message : null;
}

export class YalidineCarrier implements CarrierAdapter {
  readonly provider = "yalidine" as const;
  readonly capabilities: CarrierCapabilities;
  /** Yalidine pushes updates; Guepex documents no webhooks, so its parcels are pulled. */
  readonly webhook?: CarrierWebhook;
  private readonly http: CarrierHttp;
  private readonly fromWilayaName: string;

  constructor(credentials: YalidineCredentials, config: YalidineConfig) {
    const platform = YALIDINE_PLATFORMS[config.platform];
    this.capabilities = yalidineCapabilities(config.platform);
    if (config.platform === "yalidine") this.webhook = yalidineWebhook;
    this.fromWilayaName = config.fromWilayaName;
    const proxySecret = config.proxySecret;
    this.http = createCarrierHttp({
      provider: "yalidine",
      label: platform.label,
      baseUrl: config.proxyBaseUrl ?? platform.baseUrl,
      headers: () => ({
        "X-API-ID": credentials.apiId,
        "X-API-TOKEN": credentials.apiToken,
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(proxySecret ? { "X-Proxy-Secret": proxySecret } : {}),
      }),
      describeError,
    });
  }

  interpret(status: CarrierStatus): Interpretation {
    return interpretYalidine(status);
  }

  private parcelData(input: CarrierShipmentInput): YalidineCreateParcelData {
    let stopdeskId: number | null = null;
    if (input.stopDesk) {
      const code = input.stationCode?.trim() ?? "";
      stopdeskId = /^\d+$/.test(code) ? Number(code) : null;
      if (stopdeskId === null) {
        throw new CarrierError(
          "yalidine",
          "rejected",
          `Yalidine stop-desk delivery needs a center id as station code; got "${input.stationCode ?? ""}"`,
        );
      }
    }
    const amount = Math.round(input.amount);
    return {
      order_id: input.reference,
      from_wilaya_name: this.fromWilayaName,
      ...splitName(input.customerName),
      contact_phone: input.phone2 ? `${input.phone},${input.phone2}` : input.phone,
      address: input.address,
      to_commune_name: input.destination.commune.name,
      to_wilaya_name: input.destination.wilaya.name,
      product_list: input.productDescription,
      price: amount,
      do_insurance: false,
      declared_value: amount,
      length: 1,
      width: 1,
      height: 1,
      weight: input.weight ?? 1,
      // `price` already includes the delivery fee CodFlow charged the customer.
      freeshipping: true,
      is_stopdesk: input.stopDesk,
      stopdesk_id: stopdeskId,
      has_exchange: false,
    };
  }

  private toParcel(item: { tracking: string; label: string | null }, raw: unknown): CarrierParcel {
    return { carrierParcelId: item.tracking, trackingNumber: item.tracking, carrierData: raw, labelUrl: item.label ?? null };
  }

  async createShipment(input: CarrierShipmentInput): Promise<CarrierParcel> {
    const [item] = await this.createShipments([input]);
    if (!item.ok) throw item.error;
    return item.parcel;
  }

  async createShipments(inputs: CarrierShipmentInput[]): Promise<CarrierBulkItem[]> {
    const built: YalidineCreateParcelData[] = [];
    const buildErrors = new Map<string, CarrierError>();
    for (const input of inputs) {
      try {
        built.push(this.parcelData(input));
      } catch (error) {
        buildErrors.set(input.reference, error as CarrierError);
      }
    }
    const response = built.length
      ? await this.http.write<YalidineCreateParcelResponse>("POST", "/parcels/", built)
      : {};

    return inputs.map((input): CarrierBulkItem => {
      const reference = input.reference;
      const buildError = buildErrors.get(reference);
      if (buildError) return { reference, ok: false, error: buildError };
      const item = response[reference];
      if (!item) {
        // The call succeeded but this parcel is missing from the answer: it may exist.
        return {
          reference,
          ok: false,
          error: new CarrierError("yalidine", "ambiguous", `Yalidine returned no result for order_id "${reference}"`),
        };
      }
      if (!item.success || !item.tracking) {
        return {
          reference,
          ok: false,
          error: new CarrierError("yalidine", "rejected", item.message || "Yalidine refused the parcel"),
        };
      }
      return { reference, ok: true, parcel: this.toParcel({ tracking: item.tracking, label: item.label }, item) };
    });
  }

  async update(ref: CarrierRef, patch: CarrierShipmentPatch): Promise<void> {
    const body: YalidineUpdateParcelRequest = {};
    if (patch.customerName !== undefined) Object.assign(body, splitName(patch.customerName));
    if (patch.phone !== undefined) body.contact_phone = patch.phone2 ? `${patch.phone},${patch.phone2}` : patch.phone;
    if (patch.address !== undefined) body.address = patch.address;
    if (patch.destination !== undefined) {
      body.to_wilaya_name = patch.destination.wilaya.name;
      body.to_commune_name = patch.destination.commune.name;
    }
    if (patch.amount !== undefined) {
      body.price = Math.round(patch.amount);
      body.declared_value = Math.round(patch.amount);
    }
    if (patch.weight !== undefined) body.weight = patch.weight;
    await this.http.write("PATCH", `/parcels/${encodeURIComponent(ref.carrierParcelId)}`, body);
  }

  /**
   * Delete the parcel. Yalidine answers `deleted: false` both for "not
   * deletable any more" and "does not exist", so a refusal is checked against
   * the parcel itself: gone counts as cancelled; still there means refused.
   */
  async cancel(ref: CarrierRef): Promise<void> {
    const tracking = encodeURIComponent(ref.carrierParcelId);
    const answer = await this.http.write<YalidineDeleteParcelResponse>("DELETE", `/parcels/${tracking}`);
    if (Array.isArray(answer) && answer[0]?.deleted === true) return;
    const found = await this.http.read<YalidineParcelList>("GET", `/parcels/?tracking=${tracking}&fields=tracking,last_status`);
    const parcel = found.data?.[0];
    if (!parcel) return;
    throw new CarrierError(
      "yalidine",
      "rejected",
      `Yalidine will not delete parcel ${ref.carrierParcelId}: its status is "${parcel.last_status}" (only "En préparation" can be deleted)`,
    );
  }

  async fetchHistory(refs: CarrierRef[]): Promise<Map<string, CarrierUpdate[]>> {
    const byParcel = new Map<string, CarrierUpdate[]>(refs.map((r) => [r.carrierParcelId, []]));
    if (refs.length === 0) return byParcel;
    const trackings = refs.map((r) => encodeURIComponent(r.carrierParcelId)).join(",");
    for (let page = 1; ; page++) {
      const res = await this.http.read<YalidineHistoryResponse>(
        "GET",
        `/histories/?tracking=${trackings}&${PAGE}&page=${page}`,
      );
      for (const row of res.data ?? []) {
        const updates = byParcel.get(row.tracking);
        const occurredAt = carrierInstant(row.date_status);
        if (!updates || !occurredAt) continue;
        updates.push({
          match: { carrierParcelId: row.tracking, trackingNumber: row.tracking },
          status: { vocabulary: "status", value: row.status },
          reason: row.reason || null,
          occurredAt,
          raw: row,
        });
      }
      if (!res.has_more || (res.data?.length ?? 0) === 0) break;
    }
    return byParcel;
  }

  async findByReference(reference: string): Promise<CarrierParcel | null> {
    const res = await this.http.read<YalidineParcelList>(
      "GET",
      `/parcels/?order_id=${encodeURIComponent(reference)}&fields=tracking,order_id,label,date_creation`,
    );
    const matches = (res.data ?? []).filter((p) => p.order_id === reference);
    if (matches.length === 0) return null;
    if (matches.length > 1) {
      throw new CarrierError(
        "yalidine",
        "rejected",
        `Yalidine has ${matches.length} parcels for order "${reference}"; choose the right tracking number by hand`,
      );
    }
    return this.toParcel(matches[0], matches[0]);
  }

  async label(ref: CarrierRef): Promise<CarrierLabel> {
    const stored = (ref.carrierData as { label?: unknown } | null)?.label;
    if (typeof stored === "string" && stored) return { kind: "url", url: stored };
    const res = await this.http.read<YalidineParcelList>(
      "GET",
      `/parcels/?tracking=${encodeURIComponent(ref.carrierParcelId)}&fields=tracking,label`,
    );
    const url = res.data?.[0]?.label;
    if (!url) throw new CarrierError("yalidine", "rejected", `Yalidine has no label for parcel ${ref.carrierParcelId}`);
    return { kind: "url", url };
  }

  async stopDesks(): Promise<CarrierStopDesk[]> {
    const desks: CarrierStopDesk[] = [];
    for (let page = 1; ; page++) {
      const res = await this.http.read<YalidineCenterList>("GET", `/centers/?${PAGE}&page=${page}`);
      for (const c of res.data ?? []) {
        desks.push({
          code: String(c.center_id),
          name: c.name,
          commune: c.commune_name || null,
          communeRef: c.commune_id ? String(c.commune_id) : null,
          address: c.address || null,
          phones: [],
          wilayaNumber: c.wilaya_id,
        });
      }
      if (!res.has_more || (res.data?.length ?? 0) === 0) break;
    }
    return desks;
  }

  /**
   * Yalidine's communes under its wilayas; one it marks undeliverable, or in
   * an undeliverable wilaya, is not delivered to. Its express prices are the
   * account's from the sender's wilaya, read one destination wilaya at a time
   * (Yalidine prices no other way), paced under its quota of 50 calls a minute:
   * a few calls over it, repeated, disable the account's API for a while.
   */
  async places(): Promise<CarrierPlace[]> {
    const wilayas = ((await this.http.read<YalidineWilayaList>("GET", `/wilayas/?${PAGE}`)).data ?? []);
    const from = wilayas.find((w) => placeKey(w.name) === placeKey(this.fromWilayaName));
    if (!from) {
      throw new CarrierError("yalidine", "misconfigured", `The sender's wilaya "${this.fromWilayaName}" is not one of Yalidine's wilayas; write it as Yalidine does`);
    }
    const byId = new Map(wilayas.map((w) => [w.id, w]));
    const communes: YalidineCommuneItem[] = [];
    for (let page = 1; ; page++) {
      const res = await this.http.read<YalidineCommuneList>("GET", `/communes/?${PAGE}&page=${page}`);
      communes.push(...(res.data ?? []));
      if (!res.has_more || (res.data?.length ?? 0) === 0) break;
    }
    const rates = new Map<number, CarrierRate>();
    for (const [i, to] of wilayas.filter((w) => w.is_deliverable === 1).entries()) {
      if (i > 0) await wait(FEES_CALL_SPACING_MS);
      const fees = await this.http.read<YalidineFees>("GET", `/fees/?from_wilaya_id=${from.id}&to_wilaya_id=${to.id}`);
      const returnFee = amount(fees.retour_fee);
      for (const c of Object.values(fees.per_commune ?? {})) {
        rates.set(c.commune_id, { home: deliveryPrice(c.express_home), stopDesk: deliveryPrice(c.express_desk), homeReturn: returnFee, stopDeskReturn: returnFee });
      }
    }
    const places: CarrierPlace[] = [];
    for (const c of communes) {
      const wilaya = byId.get(c.wilaya_id);
      if (!wilaya) continue;
      places.push({
        wilaya: { ref: String(wilaya.id), number: wilaya.id, name: wilaya.name },
        commune: { ref: String(c.id), name: c.name },
        home: c.is_deliverable === 1 && wilaya.is_deliverable === 1,
        rate: rates.get(c.id) ?? NO_RATE,
      });
    }
    return places;
  }

}

/**
 * Yalidine webhooks: one POST carries one event type and a batch of events,
 * each with its own `event_id` and `occurred_at`; delivery order is not
 * guaranteed. Signed with HMAC-SHA256 of the raw body (`X-Yalidine-Signature`).
 */
export const yalidineWebhook: CarrierWebhook = {
  verify(rawBody, headers, secret) {
    const signature = headers.get("x-yalidine-signature") ?? headers.get("x_yalidine_signature");
    return verifyYalidineSignature(rawBody, signature, secret);
  },

  split(rawBody): InboxEnvelope[] {
    const delivery = JSON.parse(rawBody) as Partial<YalidineWebhookDelivery>;
    const type = typeof delivery.type === "string" ? delivery.type : "unknown";
    return (Array.isArray(delivery.events) ? delivery.events : []).map((event) => ({
      eventId: String(event.event_id),
      eventType: type,
      payload: JSON.stringify({ type, event }),
    }));
  },

  read(envelope): WebhookReading {
    const { type, event } = JSON.parse(envelope.payload) as { type: string; event: YalidineWebhookDelivery["events"][number] };
    if (type === "parcel_payment_updated") return { kind: "settlement" };
    if (type === "parcel_created") {
      const { tracking, order_id: reference, label } = (event.data ?? {}) as { tracking?: unknown; order_id?: unknown; label?: unknown };
      if (typeof tracking !== "string" || !tracking || typeof reference !== "string" || !reference) {
        return { kind: "ignored", reason: "parcel created without tracking or order id" };
      }
      const labelUrl = typeof label === "string" && label ? label : null;
      return { kind: "created", reference, parcel: { carrierParcelId: tracking, trackingNumber: tracking, carrierData: { label: labelUrl }, labelUrl } };
    }
    if (type !== "parcel_status_updated" && type !== "parcel_deleted") {
      return { kind: "ignored", reason: `event type ${type}` };
    }
    const tracking = event.data?.tracking;
    if (typeof tracking !== "string" || !tracking) return { kind: "ignored", reason: "no tracking in event" };
    const occurredAt = carrierInstant(event.occurred_at);
    if (!occurredAt) {
      throw new CarrierError("yalidine", "rejected", `Unreadable occurred_at "${event.occurred_at}" in event ${event.event_id}`);
    }
    const status: CarrierStatus =
      type === "parcel_deleted"
        ? { vocabulary: "event", value: "parcel_deleted" }
        : { vocabulary: "status", value: String(event.data?.status ?? "") };
    const reason = event.data?.reason;
    return {
      kind: "update",
      update: {
        match: { carrierParcelId: tracking, trackingNumber: tracking },
        status,
        reason: typeof reason === "string" && reason ? reason : null,
        occurredAt,
        raw: event,
      },
    };
  },
};
