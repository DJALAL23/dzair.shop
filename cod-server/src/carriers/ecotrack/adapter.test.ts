import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { CarrierError, type CarrierAdapter, type CarrierRef, type CarrierShipmentInput } from "../contract";
import { EcotrackCarrier, ecotrackConfigSchema } from "./adapter";
import { ECOTRACK_ACTIVITIES, ECOTRACK_STATUSES, ecotrackLabel, interpretEcotrack } from "./interpret";
import { createEcotrackMockServer, type EcotrackMockServer } from "./test/mock-server";

const TOKEN = "eco-token";
let server: EcotrackMockServer;
const realFetch = globalThis.fetch;

beforeEach(() => {
  server = createEcotrackMockServer({ token: TOKEN });
  globalThis.fetch = server.fetch as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const carrier = (): CarrierAdapter => new EcotrackCarrier({ apiToken: TOKEN, baseUrl: server.baseUrl });
const refOf = (tracking: string): CarrierRef => ({ carrierParcelId: tracking, trackingNumber: tracking, carrierData: null });

const input: CarrierShipmentInput = {
  reference: "ORD-001",
  customerName: "Karim Benali",
  phone: "0551234567",
  address: "Rue 1",
  wilayaId: 16,
  wilaya: "Alger",
  commune: "Alger Centre",
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

const fullDetails = { phone: "0551234567", address: "Rue 2", wilayaId: 16, commune: "Alger Centre", amount: 5000 };

/** A time as EcoTrack writes it (Algiers, UTC+1), this far from now. */
const algiersNow = (offsetMs = 0) => {
  const [date, time] = new Date(Date.now() + offsetMs + 3_600_000).toISOString().slice(0, 19).split("T");
  return { date, time };
};

describe("createShipment", () => {
  it("sends the order as query parameters with our reference and type 1", async () => {
    const parcel = await carrier().createShipment({ ...input, phone2: "0661111111", weight: 2, fragile: true, remarks: "Fragile" });
    const call = server.callsFor("/api/v1/create/order")[0];
    expect(call.body).toBeUndefined();
    expect(Object.fromEntries(call.searchParams)).toMatchObject({
      reference: "ORD-001",
      nom_client: "Karim Benali",
      telephone: "0551234567",
      telephone_2: "0661111111",
      code_wilaya: "16",
      commune: "Alger Centre",
      montant: "4500",
      type: "1",
      stop_desk: "0",
      weight: "2",
      fragile: "1",
      remarque: "Fragile",
    });
    expect(parcel.carrierParcelId).toMatch(/^ECMOCK/);
    expect(parcel.trackingNumber).toBe(parcel.carrierParcelId);
  });

  it("sends the desk's postal code only for stop-desk delivery", async () => {
    await carrier().createShipment({ ...input, stopDesk: true, stationCode: "16001" });
    await carrier().createShipment({ ...input, reference: "ORD-2", stationCode: "16001" });
    const [desk, home] = server.callsFor("/api/v1/create/order");
    expect(desk.searchParams.get("code_postal")).toBe("16001");
    expect(desk.searchParams.get("stop_desk")).toBe("1");
    expect(home.searchParams.has("code_postal")).toBe(false);
  });

  it("always sends an address: a stop-desk parcel without one takes the desk's commune (EcoTrack requires it)", async () => {
    const desk = await carrier().createShipment({ ...input, address: "", stopDesk: true, stationCode: "16001" });
    await carrier().update!(refOf(desk.carrierParcelId), { customerName: "K", phone: "0551234567", address: "  ", wilayaId: 16, commune: "Ain Benian", amount: 1000 });
    expect(server.callsFor("/api/v1/create/order")[0].searchParams.get("adresse")).toBe("Alger Centre");
    expect(server.callsFor("/api/v1/update/order")[0].searchParams.get("adresse")).toBe("Ain Benian");
  });

  it("a wilaya the company does not serve is rejected with EcoTrack's code", async () => {
    const error = await failure(carrier().createShipment({ ...input, wilayaId: 12 }));
    expect(error.kind).toBe("rejected");
    expect(error.carrierCode).toBe("10002");
  });
});

describe("the parcel's life at EcoTrack", () => {
  it("can be edited and deleted until it is validated, and not after", async () => {
    const a = refOf((await carrier().createShipment(input)).carrierParcelId);
    await carrier().update!(a, fullDetails);
    expect(server.parcel(a.carrierParcelId)!.params.adresse).toBe("Rue 2");
    await carrier().cancel!(a);
    expect(server.parcel(a.carrierParcelId)).toBeUndefined();

    const b = refOf((await carrier().createShipment({ ...input, reference: "ORD-2" })).carrierParcelId);
    await carrier().validate!(b, { requestPickup: true });
    expect(server.callsFor("/api/v1/valid/order")[0].searchParams.get("ask_collection")).toBe("1");
    expect((await failure(carrier().update!(b, fullDetails))).carrierCode).toBe("10001");
    expect((await failure(carrier().cancel!(b))).kind).toBe("rejected");
  });

  it("refuses a partial update rather than sending one EcoTrack would reject or garble", async () => {
    const a = refOf((await carrier().createShipment(input)).carrierParcelId);
    const error = await failure(carrier().update!(a, { address: "Rue 3" }));
    expect(error.kind).toBe("rejected");
    expect(error.message).toContain("phone");
    expect(server.callsFor("/api/v1/update/order")).toHaveLength(0);
  });

  it("adds and lists remarks", async () => {
    const a = refOf((await carrier().createShipment(input)).carrierParcelId);
    await carrier().addRemark!(a, "Appeler avant 18h");
    expect(await carrier().listRemarks!(a)).toEqual([expect.objectContaining({ content: expect.stringContaining("Appeler avant 18h") })]);
  });

  it("asks for a return and confirms its reception", async () => {
    const a = refOf((await carrier().createShipment(input)).carrierParcelId);
    await carrier().validate!(a);
    await carrier().askReturn!(a);
    expect(await carrier().confirmReturn!([a])).toBe(true);
    expect(await carrier().confirmReturn!([refOf("ECUNKNOWN")])).toBe(false);
  });
});

describe("fetchHistory", () => {
  it("reads each parcel's activity with exact Algiers times", async () => {
    const a = refOf((await carrier().createShipment(input)).carrierParcelId);
    await carrier().validate!(a);
    server.parcel(a.carrierParcelId)!.activity.push({ ...algiersNow(60_000), status: "picked", station: "" });
    const history = (await carrier().fetchHistory!([a])).get(a.carrierParcelId)!;
    expect(history.map((u) => u.status)).toEqual([
      { vocabulary: "activity", value: "order_information_received_by_carrier", label: "Informations reçues par le transporteur" },
      { vocabulary: "activity", value: "picked", label: "Ramassé" },
      { vocabulary: "status", value: "vers_hub", label: "Vers le hub" },
    ]);
    expect(history.map((u) => u.snapshot ?? false)).toEqual([false, false, true]);
    for (const u of history) expect(u.reason).toBeNull();
    const statusCall = server.callsFor("/api/v1/get/orders/status")[0];
    expect(statusCall.searchParams.get("status")).toBe("all");
    expect(statusCall.searchParams.get("trackings")).toBe(a.carrierParcelId);
    for (const u of history) expect(u.occurredAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/);
  });
});

describe("findByReference", () => {
  it("scans the handoff day's orders for our reference", async () => {
    const created = await carrier().createShipment(input);
    await carrier().createShipment({ ...input, reference: "ORD-OTHER" });
    const found = await carrier().findByReference!("ORD-001", new Date());
    expect(found?.carrierParcelId).toBe(created.carrierParcelId);
    const call = server.callsFor("/api/v1/get/orders")[0];
    expect(call.searchParams.get("start_date")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(call.searchParams.get("end_date")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("returns null when nothing carries it, and refuses to pick between duplicates", async () => {
    expect(await carrier().findByReference!("ORD-NONE", new Date())).toBeNull();
    await carrier().createShipment(input);
    await carrier().createShipment(input);
    expect((await failure(carrier().findByReference!("ORD-001", new Date()))).kind).toBe("rejected");
  });
});

describe("label, desks, connection", () => {
  it("fetches the label PDF with the company's token", async () => {
    const a = refOf((await carrier().createShipment(input)).carrierParcelId);
    const label = await carrier().label!(a);
    expect(label.kind).toBe("pdf");
    expect(server.callsFor("/api/v1/get/order/label")[0].headers.authorization).toBe(`Bearer ${TOKEN}`);
  });

  it("lists only communes with a stop desk, keyed by postal code", async () => {
    const desks = await carrier().stopDesks!();
    expect(desks.length).toBeGreaterThan(0);
    for (const d of desks) expect(d).toMatchObject({ code: expect.any(String), commune: d.name, phones: [] });
    for (const d of desks) expect(d.commune).toBeTruthy();
  });

  it("checks the token by query parameter and reports what it learns", async () => {
    const check = await carrier().verifyConnection!();
    expect(check).toMatchObject({ ok: true, code: "valid", details: { servedWilayaCount: expect.any(Number) } });
    expect(server.callsFor("/api/v1/validate/token")[0].searchParams.get("api_token")).toBe(TOKEN);
  });

  it("a wrong token is a check result, not an error", async () => {
    const check = await new EcotrackCarrier({ apiToken: "wrong", baseUrl: server.baseUrl }).verifyConnection();
    expect(check.ok).toBe(false);
  });
});

describe("place names", () => {
  it("gives EcoTrack's own wilaya and commune spellings, each commune in its wilaya", async () => {
    const names = await carrier().geoNames!();
    expect(names.wilayas.length).toBeGreaterThan(0);
    expect(names.wilayas[0]).toEqual({ id: expect.any(Number), name: expect.any(String) });
    expect(names.communes.length).toBeGreaterThan(0);
    for (const c of names.communes) expect(c).toEqual({ id: expect.any(Number), name: expect.any(String), wilayaId: expect.any(Number) });
    expect(new Set(names.communes.map((c) => c.id)).size).toBe(names.communes.length);
    expect(carrier().capabilities.geoNames).toBe(true);
  });
});

describe("failures", () => {
  it("the rate limit is rate_limited", async () => {
    server.override("/api/v1/create/order", () => new Response(JSON.stringify({ message: "Too Many Attempts." }), { status: 429 }));
    expect((await failure(carrier().createShipment(input))).kind).toBe("rate_limited");
  });

  it("a creation answered without a tracking number is ambiguous", async () => {
    server.override("/api/v1/create/order", () => new Response(JSON.stringify({ success: true }), { status: 200 }));
    expect((await failure(carrier().createShipment(input))).kind).toBe("ambiguous");
  });

  it("a bad token is auth", async () => {
    const error = await failure(new EcotrackCarrier({ apiToken: "wrong", baseUrl: server.baseUrl }).createShipment(input));
    expect(error.kind).toBe("auth");
  });
});

describe("createShipments", () => {
  it("sends one indexed body and reads results by our reference", async () => {
    const items = await carrier().createShipments!([input, { ...input, reference: "ORD-2", wilayaId: 12 }]);
    expect(server.callsFor("/api/v1/create/orders")).toHaveLength(1);
    expect(items[0]).toMatchObject({ reference: "ORD-001", ok: true });
    expect(items[1]).toMatchObject({ reference: "ORD-2", ok: false });
  });
});

describe("interpretation", () => {
  const activity = (value: string) => interpretEcotrack({ vocabulary: "activity", value });
  const status = (value: string) => interpretEcotrack({ vocabulary: "status", value });

  // Typed from the Postman collection, not from the adapter's tables.
  const DOCUMENTED_ACTIVITIES = [
    "order_information_received_by_carrier", "picked", "accepted_by_carrier", "dispatched_to_driver",
    "attempt_delivery", "return_asked", "return_in_transit", "Return_received", "livred", "encaissed", "payed",
  ];
  const DOCUMENTED_STATUSES = [
    "prete_a_expedier", "en_ramassage", "en_preparation_stock", "vers_hub", "en_hub", "vers_wilaya", "en_preparation",
    "en_livraison", "suspendu", "livre_non_encaisse", "encaisse_non_paye", "paiements_prets", "paye_et_archive",
    "retour_chez_livreur", "retour_transit_entrepot", "retour_en_traitement", "retour_recu", "retour_archive", "annule",
  ];

  it("understands every documented activity and status", () => {
    for (const a of DOCUMENTED_ACTIVITIES) expect(activity(a).kind, a).not.toBe("unknown");
    for (const s of DOCUMENTED_STATUSES) expect(status(s).kind, s).not.toBe("unknown");
    expect(Object.keys(ECOTRACK_STATUSES).sort()).toEqual([...DOCUMENTED_STATUSES].sort());
    expect(Object.keys(ECOTRACK_ACTIVITIES).filter((k) => k !== "notification_on_order").sort()).toEqual([...DOCUMENTED_ACTIVITIES].sort());
  });

  it("gives every activity and status EcoTrack's own French words", () => {
    for (const key of [...Object.keys(ECOTRACK_ACTIVITIES), ...Object.keys(ECOTRACK_STATUSES)]) expect(ecotrackLabel(key), key).toBeTruthy();
    expect(ecotrackLabel("a_key_ecotrack_adds_later")).toBeNull();
  });

  it("money states are collection signals, never a delivery status", () => {
    for (const s of ["encaisse_non_paye", "paiements_prets", "paye_et_archive"]) expect(status(s)).toEqual({ kind: "collection" });
    for (const a of ["encaissed", "payed"]) expect(activity(a)).toEqual({ kind: "collection" });
    expect(status("livre_non_encaisse")).toEqual({ kind: "milestone", milestone: "delivered" });
  });

  it("a return is only returned once the goods are back — never on request or in transit", () => {
    for (const s of ["return_asked", "return_in_transit"]) expect(activity(s)).toEqual({ kind: "milestone", milestone: "return_started" });
    for (const s of ["retour_chez_livreur", "retour_transit_entrepot", "retour_en_traitement"]) {
      expect(status(s)).toEqual({ kind: "milestone", milestone: "return_started" });
    }
    expect(activity("Return_received")).toEqual({ kind: "milestone", milestone: "returned" });
    expect(status("retour_recu")).toEqual({ kind: "milestone", milestone: "returned" });
  });

  it("a suspended parcel needs the merchant; it never touches the order", () => {
    expect(status("suspendu")).toEqual({ kind: "exception" });
  });

  it("unknown values and vocabularies are unknown", () => {
    expect(activity("teleported")).toEqual({ kind: "unknown" });
    expect(status("livred")).toEqual({ kind: "unknown" });
    expect(interpretEcotrack({ vocabulary: "state", value: "livred" })).toEqual({ kind: "unknown" });
    expect(activity("constructor")).toEqual({ kind: "unknown" });
  });

  it("EcoTrack takes no settings", () => {
    expect(ecotrackConfigSchema.parse({})).toEqual({});
    expect(ecotrackConfigSchema.safeParse({ x: 1 }).success).toBe(false);
  });
});
