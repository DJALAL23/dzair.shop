import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { CarrierError, type CarrierAdapter, type CarrierShipmentInput } from "../contract";
import { ZrExpressCarrier, internationalPhone, zrConfigSchema, zrWebhook } from "./adapter";
import { zrInterpreter } from "./interpret";

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
  new ZrExpressCarrier({ apiKey: "zr-key", tenantId: "zr-tenant" }, zrConfigSchema.parse(config));
const call = (i: number) => {
  const [url, init] = fetchMock.mock.calls[i] as [string, RequestInit];
  return { url, init, body: init.body ? JSON.parse(String(init.body)) : undefined };
};

const PARCEL = "11111111-2222-3333-4444-555555555555";
const ref = { carrierParcelId: PARCEL, trackingNumber: "16-ABC-ZR", carrierData: { parcelId: PARCEL } };
/** Alger Centre as the company's map of places holds it: ZR's own territory ids. */
const destination = { wilaya: { ref: "city-16", number: 16, name: "Alger" }, commune: { ref: "district-1", name: "Alger Centre" } };

const input: CarrierShipmentInput = {
  reference: "ORD-001",
  customerName: "Karim Benali",
  phone: "0551234567",
  address: "Rue 1",
  destination,
  amount: 4500,
  productDescription: "T-shirt (ORD-001)",
  stopDesk: false,
};

async function failure(promise: Promise<unknown>): Promise<CarrierError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(CarrierError);
    return error as CarrierError;
  }
  throw new Error("expected a CarrierError");
}

const urls = () => fetchMock.mock.calls.map(([url]) => String(url));

describe("createShipment", () => {
  it("creates the customer and the parcel at the map's territories, then reads the tracking number", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ id: "cust-1" }))
      .mockResolvedValueOnce(json({ id: PARCEL }))
      .mockResolvedValueOnce(json({ id: PARCEL, trackingNumber: "16-ABC-ZR" }));

    const parcel = await carrier().createShipment({ ...input, phone2: "0661111111" });

    expect(call(0).init.headers).toMatchObject({ "X-Api-Key": "zr-key", "X-Tenant": "zr-tenant" });
    expect(call(0)).toMatchObject({ url: "https://api.zrexpress.app/api/v1/customers/individual", body: { phone: { number1: "+213551234567", number2: "+213661111111" } } });
    expect(call(1).url).toBe("https://api.zrexpress.app/api/v1/parcels");
    expect(call(1).body).toMatchObject({
      customer: { customerId: "cust-1" },
      deliveryAddress: { cityTerritoryId: "city-16", districtTerritoryId: "district-1", street: "Rue 1" },
      deliveryType: "home",
      amount: 4500,
      externalId: "ORD-001",
    });
    expect(parcel).toEqual({ carrierParcelId: PARCEL, trackingNumber: "16-ABC-ZR", carrierData: { parcelId: PARCEL }, labelUrl: null });
  });

  it("never searches ZR's territories for a name: the ids come from the map", async () => {
    fetchMock.mockResolvedValueOnce(json({ id: "cust-1" })).mockResolvedValueOnce(json({ id: PARCEL })).mockResolvedValueOnce(json({ id: PARCEL, trackingNumber: "T" }));
    await carrier().createShipment(input);
    expect(urls().some((u) => u.includes("/territories"))).toBe(false);
  });

  it("sends a pickup point's hub and takes its territories from the hub", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ items: [{ id: "hub-9", isPickupPoint: true, address: { cityTerritoryId: "c", districtTerritoryId: "d" } }], totalPages: 1 }))
      .mockResolvedValueOnce(json({ id: "cust-1" }))
      .mockResolvedValueOnce(json({ id: PARCEL }))
      .mockResolvedValueOnce(json({ id: PARCEL, trackingNumber: "T" }));
    await carrier().createShipment({ ...input, stopDesk: true, stationCode: "hub-9" });
    expect(call(2).body).toMatchObject({ hubId: "hub-9", deliveryType: "pickup-point", deliveryAddress: { cityTerritoryId: "c", districtTerritoryId: "d" } });
  });

  it("a failure before the parcel call means nothing was shipped — unavailable, not ambiguous", async () => {
    fetchMock.mockResolvedValueOnce(json({}, 500));
    expect((await failure(carrier().createShipment(input))).kind).toBe("unavailable");
  });

  it("a server error on the parcel call itself is ambiguous", async () => {
    fetchMock.mockResolvedValueOnce(json({ id: "cust-1" })).mockResolvedValueOnce(json({}, 502));
    expect((await failure(carrier().createShipment(input))).kind).toBe("ambiguous");
  });

  it("ZR's refusal of a territory pair is the carrier's answer, not a guess of ours", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ id: "cust-1" }))
      .mockResolvedValueOnce(json({ title: "ParcelErrors.DistrictDoesNotBelongToCity", detail: "The district territory does not belong to the city territory." }, 400));
    const error = await failure(carrier().createShipment(input));
    expect(error.kind).toBe("rejected");
    expect(error.message).toContain("DistrictDoesNotBelongToCity");
  });

  it("keeps a created parcel even when its tracking number cannot be read yet", async () => {
    fetchMock.mockResolvedValueOnce(json({ id: "cust-1" })).mockResolvedValueOnce(json({ id: PARCEL })).mockRejectedValue(new TypeError("down"));
    expect(await carrier().createShipment(input)).toMatchObject({ carrierParcelId: PARCEL, trackingNumber: null });
  });
});

describe("createShipments", () => {
  it("maps ZR's per-index answer back to each order, joining every reason", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith("/customers/individual")) return json({ id: "cust" });
      return json({
        successes: [{ index: 0, parcelId: "p-1", trackingNumber: "T-1" }],
        failures: [
          { index: 1, errorMessage: "Name is required" },
          { index: 1, errorMessage: "Description is required" },
        ],
      });
    });
    const items = await carrier().createShipments!([
      { ...input, reference: "A" },
      { ...input, reference: "B" },
      { ...input, reference: "C" },
    ]);
    expect(items[0]).toMatchObject({ ok: true, parcel: { carrierParcelId: "p-1", trackingNumber: "T-1" } });
    expect(items[1]).toMatchObject({ ok: false, error: { kind: "rejected", message: "Name is required; Description is required" } });
    expect(items[2]).toMatchObject({ ok: false, error: { kind: "ambiguous" } });
  });

  it("sends each parcel to its own commune's territories", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith("/customers/individual")) return json({ id: "cust" });
      return json({ successes: [{ index: 0, parcelId: "p-0", trackingNumber: "T-0" }, { index: 1, parcelId: "p-1", trackingNumber: "T-1" }], failures: [] });
    });
    const babEzzouar = { ...destination, commune: { ref: "district-2", name: "Bab Ezzouar" } };
    await carrier().createShipments!([{ ...input, reference: "A" }, { ...input, reference: "B", destination: babEzzouar }]);
    const bulk = fetchMock.mock.calls.map(([url, init]) => [String(url), init as RequestInit]).find(([url]) => (url as string).endsWith("/parcels/bulk"))!;
    const parcels = JSON.parse(String((bulk[1] as RequestInit).body)).parcels;
    expect(parcels.map((p: any) => p.deliveryAddress.districtTerritoryId)).toEqual(["district-1", "district-2"]);
    expect(urls().some((u) => u.includes("/territories"))).toBe(false);
  });
});

describe("places", () => {
  const territories = [
    [{ id: "city-51", level: "wilaya", code: 51, name: "Ouled Djellal" }, { id: "d-besbes", level: "commune", code: 232, name: "Besbes", parentId: "city-51", delivery: { hasHomeDelivery: true } }],
    [
      { id: "d-x", level: "commune", code: 9, name: "Doucen", parentId: "city-51", delivery: { hasHomeDelivery: false } },
      { id: "city-03", level: "wilaya", code: 3, name: "Laghouat" },
      { id: "d-aflou", level: "commune", code: 319, name: "Aflou", parentId: "city-03", delivery: { hasHomeDelivery: true } },
    ],
  ];
  const prices = (home: number, desk: number, back: number, discountedHome: number | null = null) => [
    { deliveryType: "home", price: home, discountedPrice: discountedHome },
    { deliveryType: "pickup-point", price: desk, discountedPrice: null },
    { deliveryType: "return", price: back, discountedPrice: null },
  ];
  beforeEach(() => {
    fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
      if (url.endsWith("/delivery-pricing/rates")) {
        return json({
          rates: [
            { toTerritoryId: "city-51", toTerritoryLevel: "wilaya", deliveryPrices: prices(750, 530, 200) },
            { toTerritoryId: "d-besbes", toTerritoryLevel: "commune", deliveryPrices: prices(500, 380, 200, 450) },
            { toTerritoryId: "unknown", toTerritoryLevel: "Unknown", deliveryPrices: prices(0, 10, 0) },
          ],
        });
      }
      const page = JSON.parse(String(init.body)).pageNumber as number;
      return json({ items: territories[page - 1], totalPages: 2 });
    });
  });

  it("lists every commune territory under the wilaya territory ZR files it in, across pages", async () => {
    const places = await carrier().places();
    expect(places.map((p) => [p.wilaya.ref, p.wilaya.number, p.commune.ref, p.commune.name, p.home])).toEqual([
      ["city-51", 51, "d-besbes", "Besbes", true],
      ["city-51", 51, "d-x", "Doucen", false],
      ["city-03", 3, "d-aflou", "Aflou", true],
    ]);
    const searches = fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/territories/search")).map(([, init]) => JSON.parse(String((init as RequestInit).body)));
    expect(searches).toEqual([expect.objectContaining({ keyword: "", pageSize: 1000, pageNumber: 1 }), expect.objectContaining({ pageNumber: 2 })]);
  });

  it("prices a commune at its own rate where ZR sets one (its discount first), at its wilaya's otherwise, and not at all where ZR has none", async () => {
    const [besbes, doucen, aflou] = await carrier().places();
    expect(besbes.rate).toEqual({ home: 450, stopDesk: 380, homeReturn: 200, stopDeskReturn: 200 });
    expect(doucen.rate).toEqual({ home: 750, stopDesk: 530, homeReturn: 200, stopDeskReturn: 200 });
    expect(aflou.rate).toEqual({ home: null, stopDesk: null, homeReturn: null, stopDeskReturn: null });
  });
});

describe("update", () => {
  it("patches only what changed, each aspect on its own endpoint", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ id: PARCEL, amount: 4500, customer: { name: "Karim", phone: { number1: "+213551234567" } }, deliveryAddress: { street: "Rue 1", cityTerritoryId: "city-16", districtTerritoryId: "district-1" } }))
      .mockResolvedValueOnce(json({}))
      .mockResolvedValueOnce(json({}));
    await carrier().update!(ref, { amount: 5000, customerName: "Karim", phone: "0551234567", address: "Rue 2", destination });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(call(1)).toMatchObject({ url: `https://api.zrexpress.app/api/v1/parcels/${PARCEL}/amount`, body: { amount: 5000 } });
    expect(call(2)).toMatchObject({ url: expect.stringContaining("/deliveryAddress"), body: { deliveryAddress: { street: "Rue 2", cityTerritoryId: "city-16", districtTerritoryId: "district-1" } } });
    expect(call(2).init.method).toBe("PATCH");
  });

  it("moves a parcel to the map's territories of its new commune", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ id: PARCEL, deliveryAddress: { street: "Rue 1", cityTerritoryId: "city-16", districtTerritoryId: "district-1" } }))
      .mockResolvedValueOnce(json({}));
    const besbes = { wilaya: { ref: "city-51", number: 51, name: "Ouled Djellal" }, commune: { ref: "d-besbes", name: "Besbes" } };
    await carrier().update!(ref, { destination: besbes });
    expect(call(1).body).toMatchObject({ deliveryAddress: { cityTerritoryId: "city-51", districtTerritoryId: "d-besbes" } });
    expect(urls().some((u) => u.includes("/territories"))).toBe(false);
  });

  it("a pickup-point address change carries the hub serving the new district", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ id: PARCEL, deliveryType: "pickup-point", deliveryAddress: { cityTerritoryId: "city-16", districtTerritoryId: "old" } }))
      .mockResolvedValueOnce(json({ items: [{ id: "hub-1", address: { districtTerritoryId: "district-1" } }], totalPages: 1 }))
      .mockResolvedValueOnce(json({}));
    await carrier().update!(ref, { destination });
    expect(call(2).body).toMatchObject({ hubId: "hub-1", deliveryAddress: { cityTerritoryId: "city-16", districtTerritoryId: "district-1" } });
  });

  it("a refusal is an error", async () => {
    fetchMock.mockResolvedValueOnce(json({ id: PARCEL, amount: 1 })).mockResolvedValueOnce(json({ title: "Locked" }, 400));
    expect((await failure(carrier().update!(ref, { amount: 2 }))).kind).toBe("rejected");
  });
});

describe("cancel", () => {
  it("deletes by tracking number with the DELETE method", async () => {
    fetchMock.mockResolvedValueOnce(json({ successCount: 1 }));
    await carrier().cancel!(ref);
    expect(call(0)).toMatchObject({ url: "https://api.zrexpress.app/api/v1/parcels/bulk/by-tracking-number", body: { trackingNumbers: ["16-ABC-ZR"] } });
    expect(call(0).init.method).toBe("DELETE");
  });

  it("a parcel already gone counts as cancelled", async () => {
    fetchMock.mockResolvedValueOnce(json({ successCount: 0, failures: [{ index: 0, errorMessage: "Parcel not found" }] }));
    await carrier().cancel!(ref);
    fetchMock.mockResolvedValueOnce(json({ title: "Not Found" }, 404));
    await carrier().cancel!(ref);
  });

  it("a refusal names ZR's reason", async () => {
    fetchMock.mockResolvedValueOnce(json({ successCount: 0, failures: [{ index: 0, errorMessage: "Parcel already picked up" }] }));
    const error = await failure(carrier().cancel!(ref));
    expect(error.kind).toBe("rejected");
    expect(error.message).toContain("already picked up");
  });
});

describe("fetchHistory", () => {
  it("reads each parcel's state history by UUID, keeping slug and wording", async () => {
    fetchMock.mockResolvedValueOnce(json([{ id: "h1", createdAt: "2026-10-01T10:00:00Z", newState: { name: "en_livraison", description: "En livraison" } }]));
    const history = await carrier().fetchHistory!([ref]);
    expect(call(0).url).toBe(`https://api.zrexpress.app/api/v1/parcels/${PARCEL}/state-history`);
    expect(history.get(PARCEL)).toEqual([
      expect.objectContaining({ status: { vocabulary: "state", value: "en_livraison", label: "En livraison" }, occurredAt: "2026-10-01T10:00:00.000Z" }),
    ]);
  });
});

describe("label and stop desks", () => {
  it("returns ZR's signed PDF link", async () => {
    fetchMock.mockResolvedValueOnce(json({ parcelLabelFiles: [{ fileUrl: "https://blob/label.pdf" }] }));
    expect(await carrier().label!(ref)).toEqual({ kind: "url", url: "https://blob/label.pdf" });
  });

  it("no label is an error, not a null", async () => {
    fetchMock.mockResolvedValueOnce(json({ parcelLabelFiles: [], failedTrackingNumbers: ["16-ABC-ZR"] }));
    expect((await failure(carrier().label!(ref))).kind).toBe("rejected");
  });

  it("lists pickup-point hubs by the district territory they stand in", async () => {
    fetchMock.mockResolvedValueOnce(
      json({ items: [{ id: "h1", name: "Hub Alger", isPickupPoint: true, address: { cityTerritoryId: "city-16", districtTerritoryId: "district-1" } }, { id: "h2", isPickupPoint: false }], totalPages: 1 }),
    );
    expect(await carrier().stopDesks!()).toEqual([{ code: "h1", name: "Hub Alger", commune: null, communeRef: "district-1", address: null, phones: [], wilayaNumber: null }]);
  });

  it("an outage is an error, never an empty list that would wipe the synced desks", async () => {
    fetchMock.mockRejectedValue(new TypeError("down"));
    expect((await failure(carrier().stopDesks!())).kind).toBe("unavailable");
  });
});

describe("webhook", () => {
  const headers = new Headers({ "svix-id": "msg_1" });
  const envelope = (eventType: string, data: Record<string, unknown>, occurredAt = "2026-10-01T10:00:00Z") =>
    zrWebhook.split(JSON.stringify({ eventType, occurredAt, data }), headers)[0];

  it("one Svix message is one inbox envelope keyed by svix-id", () => {
    expect(envelope("parcel.state.updated", {})).toMatchObject({ eventId: "msg_1", eventType: "parcel.state.updated" });
    expect(() => zrWebhook.split("{}", new Headers())).toThrow(CarrierError);
  });

  it("reads a state change with slug, wording and every way to match the parcel", () => {
    const reading = zrWebhook.read(envelope("parcel.state.updated", { id: PARCEL, trackingNumber: "T", externalId: "ORD-1", state: { name: "livre", description: "Livré" } }));
    expect(reading).toEqual({
      kind: "update",
      update: {
        match: { carrierParcelId: PARCEL, trackingNumber: "T", reference: "ORD-1" },
        status: { vocabulary: "state", value: "livre", label: "Livré" },
        reason: null,
        occurredAt: "2026-10-01T10:00:00.000Z",
        raw: expect.anything(),
      },
    });
  });

  it("attributes a return parcel's events to the original parcel", () => {
    const reading = zrWebhook.read(envelope("parcel.state.updated", { id: "return-p", originalParcelId: PARCEL, state: { name: "x" } }));
    expect(reading).toMatchObject({ update: { match: { carrierParcelId: PARCEL } } });
  });

  it("a return flag turning on is a status; turning off is ignored", () => {
    expect(zrWebhook.read(envelope("parcel.isReturn.updated", { id: PARCEL, isReturn: true }))).toMatchObject({ update: { status: { vocabulary: "event", value: "isReturn:true" } } });
    expect(zrWebhook.read(envelope("parcel.isReturn.updated", { id: PARCEL, isReturn: false })).kind).toBe("ignored");
  });

  it("a situation is kept with its name as the reason", () => {
    expect(zrWebhook.read(envelope("parcel.state.situation.created", { id: PARCEL, situation: { name: "Client injoignable" } }))).toMatchObject({
      update: { status: { vocabulary: "situation", value: "Client injoignable" }, reason: "Client injoignable" },
    });
  });

  it("ignores other events and events without a parcel", () => {
    expect(zrWebhook.read(envelope("parcel.created", { id: PARCEL })).kind).toBe("ignored");
    expect(zrWebhook.read(envelope("parcel.state.updated", { state: { name: "livre" } })).kind).toBe("ignored");
  });

  it("refuses an unreadable time", () => {
    expect(() => zrWebhook.read(envelope("parcel.state.updated", { id: PARCEL, state: { name: "livre" } }, "soon"))).toThrow(CarrierError);
  });
});

describe("interpretation", () => {
  const meaning = (value: string, label?: string, statusMap?: Record<string, string[]>) =>
    zrInterpreter(statusMap)({ vocabulary: "state", value, label });

  it.each([
    ["en_livraison", { kind: "milestone", milestone: "out_for_delivery" }],
    ["livre", { kind: "milestone", milestone: "delivered" }],
    ["encaisse", { kind: "collection" }],
    ["recouvert", { kind: "collection" }],
    ["retour_sous_traitant", { kind: "milestone", milestone: "return_started" }],
    ["attente_recuperation_fournisseur", { kind: "milestone", milestone: "return_started", attention: true }],
    ["recupere_par_fournisseur", { kind: "milestone", milestone: "returned" }],
    ["commande_recue", { kind: "progress" }],
  ])("default workflow: %s", (value, expected) => {
    expect(meaning(value)).toEqual(expected);
  });

  it("matches without accents or case, and falls back to the French wording", () => {
    expect(meaning("Livré")).toEqual({ kind: "milestone", milestone: "delivered" });
    expect(meaning("custom_slug_42", "Livré au client")).toEqual({ kind: "milestone", milestone: "delivered" });
  });

  it("a tenant's own mapping wins over the defaults", () => {
    expect(meaning("livre", undefined, { exception: ["livre"] })).toEqual({ kind: "exception" });
    expect(meaning("Colis chez nous", undefined, { returned: ["colis chez nous"] })).toEqual({ kind: "milestone", milestone: "returned" });
  });

  it("an unknown state is unknown, never guessed", () => {
    expect(meaning("remboursement_reinjecte")).toEqual({ kind: "unknown" });
    expect(meaning("whatever")).toEqual({ kind: "unknown" });
  });

  it("situations are progress unless the tenant maps them", () => {
    const interpret = zrInterpreter({ failed_attempt: ["Client injoignable"] });
    expect(interpret({ vocabulary: "situation", value: "Client injoignable" })).toEqual({ kind: "failed_attempt" });
    expect(interpret({ vocabulary: "situation", value: "Autre" })).toEqual({ kind: "progress" });
  });

  it("a return flag starts a return; it is not the goods coming back", () => {
    expect(zrInterpreter()({ vocabulary: "event", value: "isReturn:true" })).toEqual({ kind: "milestone", milestone: "return_started" });
  });
});

describe("config and phones", () => {
  it("accepts a status map keyed by meaning only", () => {
    expect(zrConfigSchema.parse({ statusMap: { delivered: ["Livré"] } })).toEqual({ statusMap: { delivered: ["Livré"] } });
    expect(zrConfigSchema.safeParse({ statusMap: { assigned: ["x"] } }).success).toBe(false);
    expect(zrConfigSchema.safeParse({ other: 1 }).success).toBe(false);
  });

  it("writes Algerian numbers in international form", () => {
    expect(internationalPhone("0551234567")).toBe("+213551234567");
    expect(internationalPhone("00213551234567")).toBe("+213551234567");
    expect(internationalPhone("+213551234567")).toBe("+213551234567");
  });
});

describe("verifyConnection", () => {
  const text = (body: string, status: number) => new Response(body, { status });

  it("proves the key and the tenant with a tenant-scoped read (the profile accepts any tenant)", async () => {
    fetchMock.mockResolvedValue(json({ items: [], totalPages: 1 }));
    expect(await carrier().verifyConnection!()).toMatchObject({ ok: true, code: "valid" });
    const { url, init, body } = call(0);
    expect(url).toMatch(/\/hubs\/search$/);
    expect(init.method).toBe("POST");
    expect(body).toMatchObject({ pageSize: 1 });
    expect(new Headers(init.headers).get("x-tenant")).toBe("zr-tenant");
  });

  it("a refused key is a check result, not an error (ZR answers 401 in plain text)", async () => {
    fetchMock.mockImplementation(async () => text("Invalid API Key", 401));
    expect(await carrier().verifyConnection!()).toMatchObject({ ok: false, code: "invalid_key" });
  });

  it("a refused tenant is told apart from a refused key (403)", async () => {
    fetchMock.mockImplementation(async () => text("", 403));
    expect(await carrier().verifyConnection!()).toMatchObject({ ok: false, code: "invalid_tenant" });
  });

  it("an outage is still an error, never a verdict on the credentials", async () => {
    fetchMock.mockImplementation(async () => text("down", 503));
    expect((await failure(carrier().verifyConnection!())).kind).toBe("unavailable");
  });
});
