import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { CarrierError, type CarrierAdapter, type CarrierShipmentInput } from "../contract";
import { FEES_CALL_SPACING_MS, YalidineCarrier, yalidineConfigSchema, yalidineWebhook } from "./adapter";
import { interpretYalidine } from "./interpret";

const realFetch = globalThis.fetch;
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const carrier = (config: Record<string, unknown> = {}): CarrierAdapter =>
  new YalidineCarrier({ apiId: "yal-id", apiToken: "yal-token" }, yalidineConfigSchema.parse(config));
const urls = () => fetchMock.mock.calls.map(([url]) => String(url));
const call = (i = 0) => {
  const [url, init] = fetchMock.mock.calls[i] as [string, RequestInit];
  return { url, init, body: init.body ? JSON.parse(String(init.body)) : undefined };
};

const input: CarrierShipmentInput = {
  reference: "ORD-001",
  customerName: "Karim Ben Ali",
  phone: "0551234567",
  address: "Rue 1",
  destination: { wilaya: { ref: "16", number: 16, name: "Alger" }, commune: { ref: "1630", name: "Bordj El Kiffan" } },
  amount: 4500.4,
  productDescription: "T-shirt (ORD-001)",
  stopDesk: false,
};

const created = (orderId: string, tracking: string) => ({
  [orderId]: { success: true, order_id: orderId, tracking, import_id: 1, label: `https://yalidine.app/l/${tracking}`, labels: null, message: "" },
});

async function failure(promise: Promise<unknown>): Promise<CarrierError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(CarrierError);
    return error as CarrierError;
  }
  throw new Error("expected a CarrierError");
}

describe("createShipment", () => {
  it("POSTs a one-parcel array keyed by our reference, with Yalidine's field names", async () => {
    fetchMock.mockResolvedValueOnce(json(created("ORD-001", "yal-AAA")));
    const parcel = await carrier({ fromWilayaName: "Batna" }).createShipment({ ...input, phone2: "0661111111", weight: 3 });

    const { url, init, body } = call();
    expect(url).toBe("https://api.yalidine.app/v1/parcels/");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ "X-API-ID": "yal-id", "X-API-TOKEN": "yal-token" });
    expect(body).toEqual([
      expect.objectContaining({
        order_id: "ORD-001",
        from_wilaya_name: "Batna",
        firstname: "Karim",
        familyname: "Ben Ali",
        contact_phone: "0551234567,0661111111",
        to_wilaya_name: "Alger",
        to_commune_name: "Bordj El Kiffan",
        price: 4500,
        declared_value: 4500,
        weight: 3,
        freeshipping: true,
        is_stopdesk: false,
        stopdesk_id: null,
        has_exchange: false,
      }),
    ]);
    expect(parcel).toEqual({
      carrierParcelId: "yal-AAA",
      trackingNumber: "yal-AAA",
      carrierData: expect.objectContaining({ tracking: "yal-AAA" }),
      labelUrl: "https://yalidine.app/l/yal-AAA",
    });
  });

  it("sends the stop-desk center id", async () => {
    fetchMock.mockResolvedValueOnce(json(created("ORD-001", "yal-B")));
    await carrier().createShipment({ ...input, stopDesk: true, stationCode: "163001" });
    expect(call().body[0]).toMatchObject({ is_stopdesk: true, stopdesk_id: 163001 });
  });

  it("refuses a stop-desk parcel without a numeric center id, without calling Yalidine", async () => {
    for (const stationCode of [undefined, "16A"]) {
      const error = await failure(carrier().createShipment({ ...input, stopDesk: true, stationCode }));
      expect(error.kind).toBe("rejected");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a parcel Yalidine refused is rejected, with its message", async () => {
    fetchMock.mockResolvedValueOnce(
      json({ "ORD-001": { success: false, order_id: "ORD-001", tracking: null, import_id: null, label: null, labels: null, message: "commune inconnue" } }),
    );
    const error = await failure(carrier().createShipment(input));
    expect(error.kind).toBe("rejected");
    expect(error.message).toBe("commune inconnue");
  });

  it("an answer that omits our parcel is ambiguous — it may have been created", async () => {
    fetchMock.mockResolvedValueOnce(json({}));
    expect((await failure(carrier().createShipment(input))).kind).toBe("ambiguous");
  });

  it("a server error during creation is ambiguous", async () => {
    fetchMock.mockResolvedValueOnce(json({ message: "boom" }, 500));
    expect((await failure(carrier().createShipment(input))).kind).toBe("ambiguous");
  });
});

describe("createShipments", () => {
  it("reports each parcel on its own; a bad one does not stop the others", async () => {
    fetchMock.mockResolvedValueOnce(json({ ...created("ORD-1", "yal-1"), "ORD-3": { success: false, order_id: "ORD-3", tracking: null, import_id: null, label: null, labels: null, message: "bad phone" } }));
    const items = await carrier().createShipments!([
      { ...input, reference: "ORD-1" },
      { ...input, reference: "ORD-2", stopDesk: true },
      { ...input, reference: "ORD-3" },
    ]);
    expect(call().body.map((p: { order_id: string }) => p.order_id)).toEqual(["ORD-1", "ORD-3"]);
    expect(items.map((i) => (i.ok ? i.parcel.trackingNumber : i.error.kind))).toEqual(["yal-1", "rejected", "rejected"]);
  });
});

describe("update", () => {
  it("PATCHes the parcel with Yalidine's field names", async () => {
    fetchMock.mockResolvedValueOnce(json({ tracking: "yal-A" }));
    await carrier().update!({ carrierParcelId: "yal-A", trackingNumber: "yal-A", carrierData: null }, {
      customerName: "Amina Kaci",
      phone: "0550000000",
      address: "Cité 5",
      destination: { wilaya: { ref: "31", number: 31, name: "Oran" }, commune: { ref: "3104", name: "Bir El Djir" } },
      amount: 3000,
      weight: 2,
    });
    const { url, init, body } = call();
    expect(url).toBe("https://api.yalidine.app/v1/parcels/yal-A");
    expect(init.method).toBe("PATCH");
    expect(body).toEqual({
      firstname: "Amina",
      familyname: "Kaci",
      contact_phone: "0550000000",
      address: "Cité 5",
      to_wilaya_name: "Oran",
      to_commune_name: "Bir El Djir",
      price: 3000,
      declared_value: 3000,
      weight: 2,
    });
  });

  it("surfaces a refusal instead of pretending it worked", async () => {
    fetchMock.mockResolvedValueOnce(json({ message: "parcel is not in preparation" }, 422));
    const error = await failure(carrier().update!({ carrierParcelId: "yal-A", trackingNumber: "yal-A", carrierData: null }, { address: "x" }));
    expect(error.kind).toBe("rejected");
  });
});

describe("cancel", () => {
  const ref = { carrierParcelId: "yal-A", trackingNumber: "yal-A", carrierData: null };

  it("succeeds when Yalidine deletes the parcel", async () => {
    fetchMock.mockResolvedValueOnce(json([{ tracking: "yal-A", deleted: true }]));
    await carrier().cancel!(ref);
    expect(call().init.method).toBe("DELETE");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("succeeds when the parcel is already gone", async () => {
    fetchMock.mockResolvedValueOnce(json([{ tracking: "yal-A", deleted: false }]));
    fetchMock.mockResolvedValueOnce(json({ has_more: false, total_data: 0, data: [] }));
    await carrier().cancel!(ref);
  });

  it("is rejected, naming the status, when the parcel still exists", async () => {
    fetchMock.mockResolvedValueOnce(json([{ tracking: "yal-A", deleted: false }]));
    fetchMock.mockResolvedValueOnce(json({ has_more: false, total_data: 1, data: [{ tracking: "yal-A", last_status: "Expédié" }] }));
    const error = await failure(carrier().cancel!(ref));
    expect(error.kind).toBe("rejected");
    expect(error.message).toContain("Expédié");
  });
});

describe("fetchHistory", () => {
  it("groups history by parcel, keeps reasons, converts Algiers times, follows pages", async () => {
    fetchMock.mockResolvedValueOnce(json({
      has_more: true,
      total_data: 3,
      data: [
        { date_status: "2026-10-01 10:00:00", tracking: "yal-A", status: "Sorti en livraison", reason: "" },
        { date_status: "2026-10-01 12:30:00", tracking: "yal-A", status: "Tentative échouée", reason: "Client ne répond pas" },
      ],
    }));
    fetchMock.mockResolvedValueOnce(json({
      has_more: false,
      total_data: 3,
      data: [{ date_status: "2026-10-02 09:00:00", tracking: "yal-B", status: "Livré", reason: "" }],
    }));
    const refs = ["yal-A", "yal-B", "yal-C"].map((t) => ({ carrierParcelId: t, trackingNumber: t, carrierData: null }));
    const history = await carrier().fetchHistory!(refs);

    expect(call(0).url).toContain("/histories/?tracking=yal-A,yal-B,yal-C&page_size=1000&page=1");
    expect(call(1).url).toContain("&page=2");
    expect(history.get("yal-A")).toEqual([
      expect.objectContaining({ status: { vocabulary: "status", value: "Sorti en livraison" }, reason: null, occurredAt: "2026-10-01T09:00:00.000Z" }),
      expect.objectContaining({ status: { vocabulary: "status", value: "Tentative échouée" }, reason: "Client ne répond pas" }),
    ]);
    expect(history.get("yal-B")).toHaveLength(1);
    expect(history.get("yal-C")).toEqual([]);
  });

  it("an outage is an error, never an empty history", async () => {
    fetchMock.mockRejectedValue(new TypeError("down"));
    const refs = [{ carrierParcelId: "yal-A", trackingNumber: "yal-A", carrierData: null }];
    expect((await failure(carrier().fetchHistory!(refs))).kind).toBe("unavailable");
  });
});

describe("findByReference", () => {
  const list = (data: unknown[]) => json({ has_more: false, total_data: data.length, data });

  it("finds the one parcel carrying our order number", async () => {
    fetchMock.mockResolvedValueOnce(list([{ tracking: "yal-Z", order_id: "ORD-001", label: "https://l/z", date_creation: "2026-10-01 10:00:00" }]));
    expect(await carrier().findByReference!("ORD-001", new Date())).toMatchObject({ carrierParcelId: "yal-Z", trackingNumber: "yal-Z", labelUrl: "https://l/z" });
    expect(call().url).toContain("/parcels/?order_id=ORD-001");
  });

  it("returns null when Yalidine has none", async () => {
    fetchMock.mockResolvedValueOnce(list([]));
    expect(await carrier().findByReference!("ORD-001", new Date())).toBeNull();
  });

  it("refuses to guess between several parcels", async () => {
    fetchMock.mockResolvedValueOnce(list([
      { tracking: "yal-1", order_id: "ORD-001", label: null },
      { tracking: "yal-2", order_id: "ORD-001", label: null },
    ]));
    expect((await failure(carrier().findByReference!("ORD-001", new Date()))).kind).toBe("rejected");
  });
});

describe("label", () => {
  it("uses the label link Yalidine returned at creation", async () => {
    const label = await carrier().label!({ carrierParcelId: "yal-A", trackingNumber: "yal-A", carrierData: { label: "https://l/a" } });
    expect(label).toEqual({ kind: "url", url: "https://l/a" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("asks Yalidine when it was not kept", async () => {
    fetchMock.mockResolvedValueOnce(json({ has_more: false, total_data: 1, data: [{ tracking: "yal-A", label: "https://l/b" }] }));
    expect(await carrier().label!({ carrierParcelId: "yal-A", trackingNumber: "yal-A", carrierData: null })).toEqual({ kind: "url", url: "https://l/b" });
  });
});

describe("stop desks and geo names", () => {
  it("lists every center across pages, with its commune and wilaya", async () => {
    fetchMock.mockResolvedValueOnce(json({ has_more: true, total_data: 2, data: [{ center_id: 10101, name: "Centre de Adrar", address: "Cité", commune_id: 101, commune_name: "Adrar", wilaya_id: 1 }] }));
    fetchMock.mockResolvedValueOnce(json({ has_more: false, total_data: 2, data: [{ center_id: 163001, name: "Bordj El Kiffan", address: "", commune_id: 1630, commune_name: "Bordj El Kiffan", wilaya_id: 16 }] }));
    expect(await carrier().stopDesks!()).toEqual([
      { code: "10101", name: "Centre de Adrar", commune: "Adrar", communeRef: "101", address: "Cité", phones: [], wilayaNumber: 1 },
      { code: "163001", name: "Bordj El Kiffan", commune: "Bordj El Kiffan", communeRef: "1630", address: null, phones: [], wilayaNumber: 16 },
    ]);
  });

  it("a refused credential is an error, never an empty desk list", async () => {
    fetchMock.mockResolvedValueOnce(json({ error: { message: "API ID and/or Token are wrong" } }, 401));
    const error = await failure(carrier().stopDesks!());
    expect(error.kind).toBe("auth");
    expect(error.message).toContain("API ID and/or Token are wrong");
  });

  const yalidine = (fees: (to: number) => unknown) =>
    fetchMock.mockImplementation(async (url: string) => {
      const u = new URL(url);
      if (u.pathname.endsWith("/wilayas/")) return json({ has_more: false, data: [{ id: 16, name: "Alger", is_deliverable: 1 }, { id: 33, name: "Illizi", is_deliverable: 0 }, { id: 3, name: "Laghouat", is_deliverable: 1 }] });
      if (u.pathname.endsWith("/fees/")) return json(fees(Number(u.searchParams.get("to_wilaya_id"))));
      return u.searchParams.get("page") === "1"
        ? json({ has_more: true, data: [{ id: 1630, name: "Bordj El Kiffan", wilaya_id: 16, is_deliverable: 1 }, { id: 1631, name: "Rouiba", wilaya_id: 16, is_deliverable: 0 }] })
        : json({ has_more: false, data: [{ id: 3301, name: "Illizi", wilaya_id: 33, is_deliverable: 1 }, { id: 319, name: "Aflou", wilaya_id: 3, is_deliverable: 1 }] });
    });
  const FEES: Record<number, unknown> = {
    16: { retour_fee: 150, per_commune: { 1630: { commune_id: 1630, express_home: 450, express_desk: 300 }, 1631: { commune_id: 1631, express_home: 500, express_desk: null } } },
    3: { retour_fee: 0, per_commune: { 319: { commune_id: 319, express_home: 1050, express_desk: 1000 } } },
  };

  it("lists its communes under its wilayas, delivered to only where both are deliverable", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    yalidine((to) => FEES[to]);
    const reading = carrier().places();
    await vi.runAllTimersAsync();
    const places = await reading;
    vi.useRealTimers();
    expect(places.map((p) => [p.wilaya.ref, p.wilaya.number, p.commune.ref, p.commune.name, p.home])).toEqual([
      ["16", 16, "1630", "Bordj El Kiffan", true],
      ["16", 16, "1631", "Rouiba", false],
      ["33", 33, "3301", "Illizi", false],
      ["3", 3, "319", "Aflou", true],
    ]);
    expect(urls().some((u) => u.includes("/communes/?page_size=1000&page=2"))).toBe(true);
  });

  it("prices each commune at the account's express rate from the sender's wilaya, its return at the zone's fee (0 is free), and leaves one Yalidine does not price unpriced", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    yalidine((to) => FEES[to]);
    const reading = carrier().places();
    await vi.runAllTimersAsync();
    const rates = Object.fromEntries((await reading).map((p) => [p.commune.name, p.rate]));
    vi.useRealTimers();
    expect(rates["Bordj El Kiffan"]).toEqual({ home: 450, stopDesk: 300, homeReturn: 150, stopDeskReturn: 150 });
    expect(rates["Rouiba"]).toEqual({ home: 500, stopDesk: null, homeReturn: 150, stopDeskReturn: 150 });
    expect(rates["Aflou"]).toEqual({ home: 1050, stopDesk: 1000, homeReturn: 0, stopDeskReturn: 0 });
    expect(rates["Illizi"]).toEqual({ home: null, stopDesk: null, homeReturn: null, stopDeskReturn: null });
    const fees = urls().filter((u) => u.includes("/fees/"));
    expect(fees).toEqual([expect.stringContaining("from_wilaya_id=16&to_wilaya_id=16"), expect.stringContaining("from_wilaya_id=16&to_wilaya_id=3")]);
  });

  it("spaces its fees calls under Yalidine's 50 a minute", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    yalidine((to) => FEES[to]);
    const reading = carrier().places();
    const feesCalls = () => urls().filter((u) => u.includes("/fees/")).length;
    await vi.advanceTimersByTimeAsync(0);
    expect(feesCalls()).toBe(1);
    await vi.advanceTimersByTimeAsync(FEES_CALL_SPACING_MS - 1);
    expect(feesCalls()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(feesCalls()).toBe(2);
    await reading;
    vi.useRealTimers();
    expect(60_000 / FEES_CALL_SPACING_MS).toBeLessThanOrEqual(48);
  });

  it("refuses to read prices from a sender's wilaya Yalidine does not have", async () => {
    yalidine((to) => FEES[to]);
    const error = await failure(carrier({ fromWilayaName: "Atlantis" }).places());
    expect(error.kind).toBe("misconfigured");
    expect(error.message).toContain("Atlantis");
  });
});

describe("egress relay", () => {
  it("routes calls through the relay with its secret", async () => {
    fetchMock.mockResolvedValueOnce(json({ has_more: false, data: [] }));
    await carrier({ proxyBaseUrl: "https://relay.example/yal/", proxySecret: "s3" }).stopDesks!();
    expect(call().url).toBe("https://relay.example/yal/centers/?page_size=1000&page=1");
    expect(call().init.headers).toMatchObject({ "X-Proxy-Secret": "s3" });
  });

  it("calls Yalidine directly without a relay header otherwise", async () => {
    fetchMock.mockResolvedValueOnce(json({ has_more: false, data: [] }));
    await carrier().stopDesks!();
    expect(call().url.startsWith("https://api.yalidine.app/v1/")).toBe(true);
    expect(call().init.headers).not.toHaveProperty("X-Proxy-Secret");
  });
});

describe("Guepex — the same API on its own host", () => {
  it("calls api.guepex.app with the same headers and paths", async () => {
    fetchMock.mockResolvedValueOnce(json(created("ORD-001", "gpx-1")));
    await carrier({ platform: "guepex" }).createShipment(input);
    expect(call().url).toBe("https://api.guepex.app/v1/parcels/");
    expect(call().init.headers).toMatchObject({ "X-API-ID": "yal-id", "X-API-TOKEN": "yal-token" });
  });

  it("names Guepex in its errors", async () => {
    fetchMock.mockResolvedValueOnce(json({ message: "bad token" }, 401));
    const error = await failure(carrier({ platform: "guepex" }).stopDesks!());
    expect(error.message).toMatch(/^Guepex HTTP 401/);
    expect(error.provider).toBe("yalidine");
  });

  it("documents no webhooks, so its parcels are pulled", () => {
    const guepex = carrier({ platform: "guepex" });
    expect(guepex.capabilities.updates).toBe("pull");
    expect(guepex.webhook).toBeUndefined();
    expect(guepex.capabilities.history).toBe(true);
    const yalidine = carrier();
    expect(yalidine.capabilities.updates).toBe("webhook");
    expect(yalidine.webhook).toBeDefined();
  });

  it("speaks Yalidine's status vocabulary", () => {
    expect(carrier({ platform: "guepex" }).interpret({ vocabulary: "status", value: "Retourné au vendeur" })).toEqual({ kind: "milestone", milestone: "returned" });
  });
});

describe("config", () => {
  it("defaults the sender wilaya and refuses unknown keys", () => {
    expect(yalidineConfigSchema.parse({})).toEqual({ platform: "yalidine", fromWilayaName: "Alger" });
    expect(yalidineConfigSchema.safeParse({ platform: "maystro" }).success).toBe(false);
    expect(yalidineConfigSchema.safeParse({ from_wilaya_name: "Oran" }).success).toBe(false);
    expect(yalidineConfigSchema.safeParse({ proxyBaseUrl: "not a url" }).success).toBe(false);
  });
});

describe("webhook", () => {
  const delivery = (type: string, events: unknown[]) => JSON.stringify({ type, events });
  const one = (type: string, data: Record<string, unknown>, occurred_at = "2026-10-01 10:00:00") =>
    yalidineWebhook.split(delivery(type, [{ event_id: "e1", occurred_at, data }]), new Headers())[0];

  it("splits a batch into one inbox envelope per event", () => {
    const envelopes = yalidineWebhook.split(
      delivery("parcel_status_updated", [
        { event_id: "e1", occurred_at: "2026-10-01 10:00:00", data: { tracking: "yal-A", status: "Livré" } },
        { event_id: "e2", occurred_at: "2026-10-01 10:05:00", data: { tracking: "yal-B", status: "Centre" } },
      ]),
      new Headers(),
    );
    expect(envelopes.map((e) => [e.eventId, e.eventType])).toEqual([["e1", "parcel_status_updated"], ["e2", "parcel_status_updated"]]);
  });

  it("reads a status change with its reason and time", () => {
    expect(yalidineWebhook.read(one("parcel_status_updated", { tracking: "yal-A", status: "Tentative échouée", reason: "Client ne répond pas" }))).toEqual({
      kind: "update",
      update: {
        match: { carrierParcelId: "yal-A", trackingNumber: "yal-A" },
        status: { vocabulary: "status", value: "Tentative échouée" },
        reason: "Client ne répond pas",
        occurredAt: "2026-10-01T09:00:00.000Z",
        raw: expect.anything(),
      },
    });
  });

  it("reads a deletion as a status of its own", () => {
    const reading = yalidineWebhook.read(one("parcel_deleted", { tracking: "yal-A" }));
    expect(reading).toMatchObject({ kind: "update", update: { status: { vocabulary: "event", value: "parcel_deleted" } } });
  });

  it("keeps payment events for settlement and ignores the rest", () => {
    expect(yalidineWebhook.read(one("parcel_payment_updated", { tracking: "yal-A", status: "ready" }))).toEqual({ kind: "settlement" });
    expect(yalidineWebhook.read(one("parcel_edited", { tracking: "yal-A" })).kind).toBe("ignored");
  });

  it("reads a creation as proof the parcel exists for our order number, with its label", () => {
    expect(yalidineWebhook.read(one("parcel_created", { order_id: "ORD-1", tracking: "yal-A", label: "https://yalidine.app/bordereau?t=1" }))).toEqual({
      kind: "created",
      reference: "ORD-1",
      parcel: { carrierParcelId: "yal-A", trackingNumber: "yal-A", carrierData: { label: "https://yalidine.app/bordereau?t=1" }, labelUrl: "https://yalidine.app/bordereau?t=1" },
    });
    expect(yalidineWebhook.read(one("parcel_created", { tracking: "yal-A" })).kind).toBe("ignored");
    expect(yalidineWebhook.read(one("parcel_created", { order_id: "ORD-1" })).kind).toBe("ignored");
  });

  it("refuses an event whose time cannot be read rather than inventing one", () => {
    expect(() => yalidineWebhook.read(one("parcel_status_updated", { tracking: "yal-A", status: "Livré" }, "yesterday"))).toThrow(CarrierError);
  });
});

// The 36 statuses Yalidine documents (Parcels `last_status` + Histories), typed
// from the official docs, not from the adapter's table.
const DOCUMENTED = [
  "Pas encore expédié", "A vérifier", "En préparation", "Pas encore ramassé", "Prêt à expédier", "En passation",
  "Ramassé", "Bloqué", "Débloqué", "Transfert", "Expédié", "Centre", "En localisation", "Vers Wilaya", "En transit",
  "Reçu à Wilaya", "En attente du client", "Prêt pour livreur", "Sorti en livraison", "En attente", "Annulé",
  "En alerte", "Alerte résolue", "Tentative échouée", "Livré", "Echèc livraison", "Retour vers centre",
  "Retourné au centre", "Retour transfert", "Retour groupé", "Retour à retirer", "Retour non retiré",
  "Colis abandonné", "Retour vers vendeur", "Retourné au vendeur", "Echange échoué",
];

describe("interpretation", () => {
  const meaning = (value: string) => interpretYalidine({ vocabulary: "status", value });

  it("understands every documented status", () => {
    expect(DOCUMENTED).toHaveLength(36);
    for (const status of DOCUMENTED) expect(meaning(status).kind, status).not.toBe("unknown");
  });

  it.each([
    ["Sorti en livraison", { kind: "milestone", milestone: "out_for_delivery" }],
    ["En attente du client", { kind: "milestone", milestone: "out_for_delivery" }],
    ["Tentative échouée", { kind: "failed_attempt" }],
    ["Livré", { kind: "milestone", milestone: "delivered" }],
    ["Echèc livraison", { kind: "milestone", milestone: "return_started" }],
    ["Retour vers vendeur", { kind: "milestone", milestone: "return_started" }],
    ["Retour à retirer", { kind: "milestone", milestone: "return_started", attention: true }],
    ["Retourné au vendeur", { kind: "milestone", milestone: "returned" }],
    ["Annulé", { kind: "milestone", milestone: "cancelled" }],
    ["En alerte", { kind: "exception" }],
    ["Centre", { kind: "progress" }],
  ])("%s", (status, expected) => {
    expect(meaning(status)).toEqual(expected);
  });

  it("only the merchant receiving the parcel is a return — never the way back", () => {
    const returnedStatuses = DOCUMENTED.filter((s) => {
      const m = meaning(s);
      return m.kind === "milestone" && m.milestone === "returned";
    });
    expect(returnedStatuses).toEqual(["Retourné au vendeur"]);
  });

  it("matches regardless of case and surrounding space; anything else is unknown", () => {
    expect(meaning("  livré ")).toEqual({ kind: "milestone", milestone: "delivered" });
    expect(meaning("Livre")).toEqual({ kind: "unknown" });
    expect(interpretYalidine({ vocabulary: "event", value: "parcel_deleted" })).toEqual({ kind: "milestone", milestone: "cancelled" });
    expect(interpretYalidine({ vocabulary: "other", value: "Livré" })).toEqual({ kind: "unknown" });
  });
});
