/**
 * NOEST adapter — against the official NOEST Public API v2.3
 * (`api_documentation_v2_3.pdf`). Response bodies below are the
 * documentation's own examples wherever it gives one.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { CarrierError, type CarrierAdapter, type CarrierRef, type CarrierShipmentInput } from "../contract";
import { NOEST_TIMEOUT_MS, NoestCarrier, noestConfigSchema } from "./adapter";
import { NOEST_EVENTS, interpretNoest } from "./interpret";

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
const carrier = (): CarrierAdapter => new NoestCarrier({ apiToken: "noest-token", userGuid: "guid-1" });
const call = (i = 0) => {
  const [url, init] = fetchMock.mock.calls[i] as [string, RequestInit];
  return { url, init, body: init.body ? JSON.parse(String(init.body)) : undefined };
};
const ref = (tracking: string): CarrierRef => ({ carrierParcelId: tracking, trackingNumber: tracking, carrierData: null });

const input: CarrierShipmentInput = {
  reference: "ORD-20260824-0042",
  customerName: "Ahmed Ahmed",
  phone: "0550505050",
  address: "Rue des Martyrs, Bab Ezzouar",
  wilayaId: 16,
  wilaya: "Alger",
  commune: "Bab Ezzouar",
  amount: 3500,
  productDescription: "Smartphone Samsung Galaxy",
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

describe("1. create/order", () => {
  it("POSTs the documented fields with user_guid and our reference", async () => {
    fetchMock.mockResolvedValueOnce(json({ success: true, tracking: "ECS1234567890", reference: "REF001", regional_hub_name: "W", wilaya_rank: "16B" }));
    const parcel = await carrier().createShipment({ ...input, phone2: "0660606060", remarks: "Appeler avant livraison", weight: 0.5 });
    expect(call().url).toBe("https://app.noest-dz.com/api/public/create/order");
    expect(call().init.headers).toMatchObject({ Authorization: "Bearer noest-token", "Content-Type": "application/json" });
    expect(call().body).toEqual({
      user_guid: "guid-1",
      reference: "ORD-20260824-0042",
      client: "Ahmed Ahmed",
      phone: "0550505050",
      phone_2: "0660606060",
      adresse: "Rue des Martyrs, Bab Ezzouar",
      wilaya_id: 16,
      commune: "Bab Ezzouar",
      montant: 3500,
      produit: "Smartphone Samsung Galaxy",
      type_id: 1,
      stop_desk: 0,
      remarque: "Appeler avant livraison",
      poids: 0.5,
    });
    expect(parcel).toMatchObject({ carrierParcelId: "ECS1234567890", trackingNumber: "ECS1234567890" });
  });

  it("sends the station code for stop desk, and no weight when none is known", async () => {
    fetchMock.mockResolvedValueOnce(json({ success: true, tracking: "T" }));
    await carrier().createShipment({ ...input, stopDesk: true, stationCode: "16A" });
    expect(call().body).toMatchObject({ stop_desk: 1, station_code: "16A" });
    expect(call().body).not.toHaveProperty("poids");
  });

  it("a reference already used is refused as duplicate_order — NOEST never ships it twice", async () => {
    fetchMock.mockResolvedValueOnce(json({ success: false, message: "Colis déja existant" }));
    const error = await failure(carrier().createShipment(input));
    expect(error.kind).toBe("rejected");
    expect(error.carrierCode).toBe("duplicate_order");
  });

  it("business and validation refusals carry NOEST's words", async () => {
    fetchMock.mockResolvedValueOnce(json({ success: false, message: "Module stopdesk désactivé pour cette wilaya" }));
    expect((await failure(carrier().createShipment(input))).message).toContain("stopdesk");
    fetchMock.mockResolvedValueOnce(json({ message: "invalid", errors: { phone: ["Le champ phone doit contenir entre 9 et 10 chiffres."] } }, 422));
    const error = await failure(carrier().createShipment(input));
    expect(error.kind).toBe("rejected");
    expect(error.message).toContain("phone");
  });

  it("a success without a tracking number is ambiguous", async () => {
    fetchMock.mockResolvedValueOnce(json({ success: true }));
    expect((await failure(carrier().createShipment(input))).kind).toBe("ambiguous");
  });
});

describe("2. create/orders — results by request index", () => {
  const two = [{ ...input, reference: "REF001" }, { ...input, reference: "REF002" }];

  it("reads the documented error answer: passed and failed keyed by index", async () => {
    fetchMock.mockResolvedValueOnce(json({
      success: false,
      passed: { 0: { success: true, tracking: "TRK123456789" } },
      failed: { 1: { reference: "REF002", phone: ["Le champ phone est requis."], commune: ["Le champ commune sélectionné est invalide."] } },
    }));
    const items = await carrier().createShipments!(two);
    expect(call().body).toMatchObject({ user_guid: "guid-1", orders: [expect.objectContaining({ reference: "REF001" }), expect.objectContaining({ reference: "REF002" })] });
    expect(items[0]).toMatchObject({ reference: "REF001", ok: true, parcel: { trackingNumber: "TRK123456789" } });
    expect(items[1]).toMatchObject({ reference: "REF002", ok: false, error: { kind: "rejected" } });
    const message = (items[1] as { error: CarrierError }).error.message;
    expect(message).toContain("phone");
    expect(message).not.toContain("REF002");
  });

  it("reads the array form PHP sends when the indices run 0..n", async () => {
    fetchMock.mockResolvedValueOnce(json({ success: true, passed: [{ success: true, tracking: "A" }, { success: true, tracking: "B" }], failed: [] }));
    const items = await carrier().createShipments!(two);
    expect(items.map((i) => i.ok && i.parcel.trackingNumber)).toEqual(["A", "B"]);
  });

  it("a failure given as a plain message is still that order's refusal", async () => {
    fetchMock.mockResolvedValueOnce(json({ success: false, passed: {}, failed: { 0: "Stock indisponible", 1: "Colis déja existant" } }));
    const items = await carrier().createShipments!(two);
    expect(items[0]).toMatchObject({ ok: false, error: { message: "Stock indisponible" } });
    expect(items[1]).toMatchObject({ ok: false, error: { carrierCode: "duplicate_order" } });
  });

  it("never matches by position: only order 1 passing does not make order 0 pass", async () => {
    fetchMock.mockResolvedValueOnce(json({ success: false, passed: { 1: { success: true, tracking: "B" } }, failed: { 0: "Stock indisponible" } }));
    const items = await carrier().createShipments!(two);
    expect(items[0]).toMatchObject({ reference: "REF001", ok: false, error: { message: "Stock indisponible" } });
    expect(items[1]).toMatchObject({ reference: "REF002", ok: true, parcel: { trackingNumber: "B" } });
  });

  it("an order the answer does not mention is ambiguous", async () => {
    fetchMock.mockResolvedValueOnce(json({ success: true, passed: { 0: { success: true, tracking: "A" } }, failed: {} }));
    const items = await carrier().createShipments!(two);
    expect(items[1]).toMatchObject({ ok: false, error: { kind: "ambiguous" } });
  });
});

describe("what NOEST does that its documentation does not say (live, 2026-10-16)", () => {
  it("a bulk order always carries a weight — NOEST refuses a bulk order without one — a single order does not need it", async () => {
    fetchMock.mockResolvedValueOnce(json({ success: true, passed: { 0: { success: true, tracking: "A" }, 1: { success: true, tracking: "B" } }, failed: {} }));
    await carrier().createShipments!([{ ...input, reference: "REF001" }, { ...input, reference: "REF002", weight: 2.5 }]);
    expect(call().body.orders.map((o: { poids?: number }) => o.poids)).toEqual([0, 2.5]);
    fetchMock.mockResolvedValueOnce(json({ success: true, tracking: "T" }));
    await carrier().createShipment(input);
    expect(call(1).body).not.toHaveProperty("poids");
  });

  it("a stop-desk order without a street address is sent with its commune as the address (NOEST requires one)", async () => {
    fetchMock.mockResolvedValueOnce(json({ success: true, tracking: "T" }));
    await carrier().createShipment({ ...input, stopDesk: true, stationCode: "16A", address: "  " });
    expect(call().body).toMatchObject({ adresse: "Bab Ezzouar", stop_desk: 1 });
    fetchMock.mockResolvedValueOnce(json({ success: true, passed: { 0: { success: true, tracking: "A" } }, failed: {} }));
    await carrier().createShipments!([{ ...input, stopDesk: true, stationCode: "16A", address: "" }]);
    expect(call(1).body.orders[0].adresse).toBe("Bab Ezzouar");
  });

  it("a repeated reference is not always refused: the answer is read as a parcel, never assumed to be a duplicate", async () => {
    fetchMock.mockResolvedValue(json({ success: true, tracking: "NEW" }));
    expect((await carrier().createShipment(input)).trackingNumber).toBe("NEW");
  });
});

describe("verifyConnection — proves the token and the partner GUID without creating anything", () => {
  it("sends an order that cannot be created: the GUID alone", async () => {
    fetchMock.mockResolvedValueOnce(json({ message: "The given data was invalid.", errors: { client: ["Le champ client est obligatoire."] } }, 422));
    expect(await carrier().verifyConnection!()).toMatchObject({ ok: true, code: "valid" });
    expect(call().url).toBe("https://app.noest-dz.com/api/public/create/order");
    expect(call().body).toEqual({ user_guid: "guid-1" });
  });

  it("a refused token is a check result (401)", async () => {
    fetchMock.mockResolvedValue(json({ error: "Unauthenticated." }, 401));
    expect(await carrier().verifyConnection!()).toMatchObject({ ok: false, code: "invalid_token" });
  });

  it("an unknown GUID is told apart from a refused token (404 Partenaire introuvable, or a user_guid field error)", async () => {
    fetchMock.mockResolvedValueOnce(json({ success: false, message: "Partenaire introuvable" }, 404));
    expect(await carrier().verifyConnection!()).toMatchObject({ ok: false, code: "invalid_user_guid" });
    fetchMock.mockResolvedValueOnce(json({ message: "invalid", errors: { user_guid: ["Le champ user_guid sélectionné est invalide."] } }, 422));
    expect(await carrier().verifyConnection!()).toMatchObject({ ok: false, code: "invalid_user_guid" });
  });

  it("a suspended account is reported, not called valid", async () => {
    fetchMock.mockResolvedValueOnce(json({ success: false, message: "Compte partenaire suspendu" }, 422));
    expect(await carrier().verifyConnection!()).toMatchObject({ ok: false, code: "account_suspended" });
  });

  it("an outage is an error, never a verdict on the credentials", async () => {
    fetchMock.mockImplementation(async () => new Response("down", { status: 503 }));
    expect((await failure(carrier().verifyConnection!())).kind).toBe("unavailable");
  });
});

describe("limits", () => {
  it("waits longer than the 30 seconds NOEST allows a request", () => {
    expect(NOEST_TIMEOUT_MS).toBeGreaterThan(30_000);
  });
});

describe("3. valid/order", () => {
  it("validates with user_guid and tracking", async () => {
    fetchMock.mockResolvedValueOnce(json({ success: true }));
    await carrier().validate!(ref("TRK1"));
    expect(call()).toMatchObject({ url: "https://app.noest-dz.com/api/public/valid/order", body: { user_guid: "guid-1", tracking: "TRK1" } });
  });

  it("an order already validated counts as validated", async () => {
    fetchMock.mockResolvedValueOnce(json({ success: false, message: "Commande déjà validée" }));
    await carrier().validate!(ref("TRK1"));
  });

  it("any other refusal is an error", async () => {
    fetchMock.mockResolvedValueOnce(json({ success: false, message: "Commande introuvable" }));
    expect((await failure(carrier().validate!(ref("TRK1")))).message).toContain("introuvable");
  });
});

describe("5.1 update/order/before/expedition", () => {
  it("edits the order directly, sending only what changed", async () => {
    fetchMock.mockResolvedValueOnce(json({ success: true }));
    await carrier().update!(ref("TRK1"), { customerName: "Ahmed Ahmed", phone: "0550000000", amount: 4500, address: "Rue des Martyrs, Bab Ezzouar", commune: "Bab Ezzouar", weight: 1.5 });
    expect(call().url).toBe("https://app.noest-dz.com/api/public/update/order/before/expedition");
    expect(call().body).toEqual({ tracking: "TRK1", client: "Ahmed Ahmed", tel: "0550000000", montant: 4500, adresse: "Rue des Martyrs, Bab Ezzouar", commune: "Bab Ezzouar", poids: "1.5" });
  });

  it("an order already shipped refuses the edit", async () => {
    fetchMock.mockResolvedValueOnce(json({ success: false, message: "Commande non trouvée dans l'étape de modification" }));
    const error = await failure(carrier().update!(ref("TRK1"), { address: "x" }));
    expect(error.kind).toBe("rejected");
    expect(error.message).toContain("modification");
  });
});

describe("6–9. delete, remark, return, new attempt", () => {
  it("uses the documented endpoints and bodies", async () => {
    fetchMock.mockImplementation(async () => json({ success: true }));
    await carrier().cancel!(ref("TRK1"));
    await carrier().addRemark!(ref("TRK1"), "Client préfère la livraison l'après-midi");
    await carrier().askReturn!(ref("TRK1"));
    await carrier().requestNewAttempt!(ref("TRK1"));
    expect(call(0)).toMatchObject({ url: "https://app.noest-dz.com/api/public/delete/order", body: { user_guid: "guid-1", tracking: "TRK1" } });
    expect(call(1)).toMatchObject({ url: "https://app.noest-dz.com/api/public/add/maj", body: { tracking: "TRK1", content: "Client préfère la livraison l'après-midi" } });
    expect(call(2)).toMatchObject({ url: "https://app.noest-dz.com/api/public/ask/return", body: { tracking: "TRK1" } });
    expect(call(3)).toMatchObject({ url: "https://app.noest-dz.com/api/public/ask/new-tentative", body: { tracking: "TRK1" } });
  });

  it("a validated order cannot be deleted", async () => {
    fetchMock.mockResolvedValueOnce(json({ success: false }));
    expect((await failure(carrier().cancel!(ref("TRK1")))).kind).toBe("rejected");
  });
});

describe("11. get/trackings/info", () => {
  it("reads the documented answer, with or without event_key, plus delivery attempts", async () => {
    fetchMock.mockResolvedValueOnce(json({
      TRK123456789: {
        OrderInfo: { tracking: "TRK123456789", reference: "REF0001" },
        activity: [
          { event: "Uploadé sur le système", causer: "PARTENAIRE", date: "2024-01-15 12:45:04" },
          { event: "Validé", causer: "PARTENAIRE", date: "2024-01-15 13:20:15" },
        ],
        deliveryAttempts: [{ causer: "NOEST", driver: "Livreur 001", content: "Client injoignable", created_at: "2024-01-16 11:00:00" }],
      },
      TRK987654321: {
        activity: [{ event: "Retour transmis au partenaire", event_key: "return_dispatched_to_partenaire", causer: "NOEST", date: "2024-01-20 10:18:12" }],
        deliveryAttempts: [],
      },
    }));
    const history = await carrier().fetchHistory!([ref("TRK123456789"), ref("TRK987654321")]);
    expect(call().body).toEqual({ trackings: ["TRK123456789", "TRK987654321"] });

    const first = history.get("TRK123456789")!;
    expect(first.map((u) => [u.status.value, u.occurredAt])).toEqual([
      ["Uploadé sur le système", "2024-01-15T11:45:04.000Z"],
      ["Validé", "2024-01-15T12:20:15.000Z"],
      ["delivery_attempt", "2024-01-16T10:00:00.000Z"],
    ]);
    expect(first.map((u) => carrier().interpret(u.status).kind)).toEqual(["progress", "progress", "failed_attempt"]);
    expect(first[2].reason).toBe("Client injoignable");

    const second = history.get("TRK987654321")!;
    expect(second[0].status).toEqual({ vocabulary: "event", value: "return_dispatched_to_partenaire", label: "Retour transmis au partenaire" });
    expect(carrier().interpret(second[0].status)).toEqual({ kind: "milestone", milestone: "return_started" });
  });

  it('"Trackings non trouvés" means no history, not an outage', async () => {
    fetchMock.mockResolvedValueOnce(json({ message: "Trackings non trouvés" }, 404));
    const history = await carrier().fetchHistory!([ref("TRK-GONE")]);
    expect(history.get("TRK-GONE")).toEqual([]);
  });

  it("an outage is an error", async () => {
    fetchMock.mockRejectedValue(new TypeError("down"));
    expect((await failure(carrier().fetchHistory!([ref("TRK1")]))).kind).toBe("unavailable");
  });
});

describe("10 & 12. label and desks", () => {
  it("lists desks from the documented answer, deriving the wilaya from the code", async () => {
    fetchMock.mockResolvedValueOnce(json({
      "01A": { code: "1A", name: "Adrar", address: "Cité les palmier en face l'hopital", map: "", phones: { 0: "0550602181", 1: "0561623531", 2: "", 3: "" }, email: "adrar@noest-dz.com" },
      "02A": { code: "2A", name: "Chlef", address: "Rue Lac des Forêts (À côté du CNRC)", map: "", phones: { 0: "0770582116", 1: "", 2: "", 3: "" } },
    }));
    expect(await carrier().stopDesks!()).toEqual([
      { code: "1A", name: "Adrar", commune: null, address: "Cité les palmier en face l'hopital", phones: ["0550602181", "0561623531"], wilayaId: 1 },
      { code: "2A", name: "Chlef", commune: null, address: "Rue Lac des Forêts (À côté du CNRC)", phones: ["0770582116"], wilayaId: 2 },
    ]);
  });

  it("fetches the label PDF", async () => {
    fetchMock.mockResolvedValueOnce(new Response(new Uint8Array([37, 80, 68, 70]), { status: 200 }));
    expect((await carrier().label!(ref("TRK1"))).kind).toBe("pdf");
    expect(call().url).toBe("https://app.noest-dz.com/api/public/get/order/label?tracking=TRK1");
  });
});

// "Liste des événements", typed from the documentation (pages 21–23).
const DOCUMENTED_EVENT_KEYS = [
  "upload", "customer_validation", "validation_collect_colis", "validation_reception_admin", "validation_reception",
  "fdr_activated", "sent_to_redispatch", "nouvel_tentative_asked_by_customer", "return_asked_by_customer",
  "return_asked_by_hub", "retour_dispatched_to_partenaires", "return_dispatched_to_partenaire",
  "colis_retour_transmit_to_partner", "colis_pickup_transmit_to_partner", "annulation_dispatch_retour",
  "cancel_return_dispatched_to_partenaire", "livraison_echoue_recu", "return_validated_by_partener",
  "return_redispatched_to_livraison", "return_dispatched_to_warehouse", "pickedup", "valid_return_pickup",
  "pickup_picked_recu", "colis_suspendu", "livre", "livred", "verssement_admin_cust", "verssement_admin_cust_canceled",
  "verssement_hub_cust_canceled", "validation_reception_cash_by_partener", "echange_valide", "echange_valid_by_hub",
  "ask_to_delete_by_admin", "ask_to_delete_by_hub", "edited_informations", "edit_price", "edit_wilaya", "extra_fee",
  "mise_a_jour",
];

describe("interpretation — the documented event list", () => {
  const event = (value: string, label?: string) => interpretNoest({ vocabulary: "event", value, label });

  it("covers every documented event and nothing invented", () => {
    expect(Object.keys(NOEST_EVENTS).sort()).toEqual([...DOCUMENTED_EVENT_KEYS].sort());
    for (const key of DOCUMENTED_EVENT_KEYS) expect(event(key).kind, key).not.toBe("unknown");
  });

  it.each([
    ["fdr_activated", { kind: "milestone", milestone: "out_for_delivery" }],
    ["livre", { kind: "milestone", milestone: "delivered" }],
    ["livred", { kind: "milestone", milestone: "delivered" }],
    ["return_asked_by_hub", { kind: "milestone", milestone: "return_started" }],
    ["livraison_echoue_recu", { kind: "milestone", milestone: "returned" }],
    ["return_validated_by_partener", { kind: "milestone", milestone: "returned" }],
    ["colis_suspendu", { kind: "exception" }],
    ["verssement_admin_cust", { kind: "collection" }],
    ["validation_reception_cash_by_partener", { kind: "collection" }],
  ])("%s", (key, expected) => {
    expect(event(key)).toEqual(expected);
  });

  it("a merchant asking for a return is a request, not the parcel moving back", () => {
    expect(event("return_asked_by_customer")).toEqual({ kind: "progress" });
  });

  it("only the merchant receiving the goods is a return", () => {
    const returned = DOCUMENTED_EVENT_KEYS.filter((k) => {
      const m = event(k);
      return m.kind === "milestone" && m.milestone === "returned";
    });
    expect(returned.sort()).toEqual(["livraison_echoue_recu", "return_validated_by_partener"]);
  });

  it("a cancelled payout is bookkeeping, not a delivery", () => {
    expect(event("verssement_admin_cust_canceled")).toEqual({ kind: "progress" });
  });

  it("an event without event_key is read from its French label, accents and case aside", () => {
    expect(event("Uploadé sur le système")).toEqual({ kind: "progress" });
    expect(event("En livraison")).toEqual({ kind: "milestone", milestone: "out_for_delivery" });
    expect(event("RETOUR RECU PAR LE PARTENAIRE")).toEqual({ kind: "milestone", milestone: "returned" });
    expect(event("whatever", "Livré")).toEqual({ kind: "milestone", milestone: "delivered" });
  });

  it("delivery attempts come from deliveryAttempts[]; mise_a_jour (also written for remarks) is not one", () => {
    expect(interpretNoest({ vocabulary: "attempt", value: "delivery_attempt" })).toEqual({ kind: "failed_attempt" });
    expect(event("mise_a_jour")).toEqual({ kind: "progress" });
  });

  it("guesses nothing else", () => {
    for (const value of ["delivered", "returned", "toString", ""]) expect(event(value)).toEqual({ kind: "unknown" });
    expect(interpretNoest({ vocabulary: "attempt", value: "other" })).toEqual({ kind: "unknown" });
    expect(noestConfigSchema.safeParse({ any: 1 }).success).toBe(false);
  });
});
