/**
 * What the merchant does to a shipment after the handoff, through the real
 * routes onto real D1, with the real adapters over the EcoTrack double (and
 * stubs for Yalidine and NOEST where their own operations are the subject).
 *
 * What is proved: each operation asks the carrier first and records only
 * what the carrier accepted; it is refused — before any carrier call — when
 * the carrier cannot do it or the shipment is not in a state for it; and the
 * merchant's reports follow who may say what.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { SYSTEM } from "@/test-utils/events";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import type { AppContext } from "@/types";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import * as schema from "@/db/schema";
import { createEcotrackMockServer, type EcotrackMockServer } from "@/carriers/ecotrack/test/mock-server";
import { LABEL_PDF_BYTES, NOT_MODIFIABLE_RESPONSE, RETURNS_NOT_ELIGIBLE_RESPONSE } from "@/carriers/ecotrack/test/fixtures";
import { acceptCarrierHandoff, handOffToDriver, markHandoffUnknown, reserveCarrierShipment } from "../../../../cod-shared/shipments/handoff";
import { getShipmentWithEvents } from "../../../../cod-shared/shipments/queries";
import { recordShipmentEvents } from "../../../../cod-shared/shipments/record-events";
import { jsonRequest, seedOrder as seedOrderIn, seedStore, shipmentsApp, T0, type OrderSeed } from "./test/harness";

const dbModule = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/db", () => dbModule);

let d1: TestD1;
let app: OpenAPIHono<AppContext>;
let scopes: string[] = [];
let server: EcotrackMockServer;
let commune16: string;
const realFetch = globalThis.fetch;
const AT = "2026-10-14T10:00:00.000Z";

beforeAll(async () => {
  d1 = await createTestD1();
  app = shipmentsApp(d1, () => scopes);
}, 120_000);

afterAll(async () => {
  await d1?.dispose();
});

beforeEach(async () => {
  dbModule.getDb.mockReturnValue(d1.db);
  scopes = ["delivery:dispatch", "orders:read"];
  server = createEcotrackMockServer();
  globalThis.fetch = ((url: string | URL, init?: RequestInit) => server.fetch(url, init)) as typeof fetch;
  commune16 = await seedStore(d1.db, server);
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

const seedOrder = (seed: OrderSeed) => seedOrderIn(d1.db, commune16, seed);
const req = (method: string, path: string, body?: unknown) => jsonRequest(app, method, `/api/shipments${path}`, body);
const codeOf = async (res: Response) => ((await res.json()) as any).code;
const row = (id: string) => d1.db.select().from(schema.shipments).where(eq(schema.shipments.id, id)).get();
const steps = async (id: string) => (await getShipmentWithEvents(d1.db, id))!.events.map((e) => [e.source, e.providerStatus]);

/** A ready order handed to an EcoTrack company through the real route. */
async function handedOff(orderId: string, companyId = "eco-manual", seed: Partial<OrderSeed> = {}) {
  await seedOrder({ id: orderId, ...seed });
  const res = await jsonRequest(app, "POST", `/api/orders/${orderId}/shipment`, { kind: "carrier", companyId });
  const { data } = (await res.json()) as any;
  return { id: data.shipment.id as string, tracking: data.shipment.trackingNumber as string };
}

/** An accepted shipment at a carrier whose create the test does not exercise. */
async function accepted(orderId: string, companyId: string, carrierData: unknown = null) {
  await seedOrder({ id: orderId });
  const reserved = await reserveCarrierShipment(d1.db, { orderId, companyId, deliveryType: "home", stationCode: null, weight: 1, isFragile: null, shippingCost: null, returnFee: null, createdBy: null });
  if (!reserved.ok) throw new Error("reservation failed");
  await acceptCarrierHandoff(d1.db, reserved.shipmentId, { carrierParcelId: `P-${orderId}`, trackingNumber: `T-${orderId}`, carrierData, labelUrl: null }, { validated: true , author: SYSTEM });
  return reserved.shipmentId;
}

const report = (id: string, status: string, interpretation: Parameters<typeof recordShipmentEvents>[2][number]["interpretation"], occurredAt = AT) =>
  recordShipmentEvents(d1.db, id, [{ source: "webhook", status: { vocabulary: "test", value: status }, interpretation, occurredAt }], SYSTEM);

/** Every fetch the test did not expect is a failure: no carrier call may be made. */
function noCarrierCalls() {
  const calls = vi.fn(async () => {
    throw new Error("no carrier call was expected");
  });
  globalThis.fetch = calls as unknown as typeof fetch;
  return calls;
}

/** A time as EcoTrack writes it (Algiers, UTC+1), this far from now. */
const algiersNow = (offsetMs = 0) => {
  const [date, time] = new Date(Date.now() + offsetMs + 3_600_000).toISOString().slice(0, 19).split("T");
  return { date, time };
};

describe("validating", () => {
  it("validates at the carrier, then records it — once", async () => {
    const { id, tracking } = await handedOff("o1");
    const res = await req("POST", `/${id}/validate`, {});
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as any;
    expect(data.shipment.validatedAt).not.toBeNull();
    expect(data.shipment.actions).not.toContain("validate");
    expect(server.parcel(tracking)!.validated).toBe(true);
    expect(await steps(id)).toEqual([["handoff", "created"], ["handoff", "validated"]]);

    const again = await req("POST", `/${id}/validate`, {});
    expect(again.status).toBe(409);
    expect(await codeOf(again)).toBe("SHIPMENT_ACTION_NOT_AVAILABLE");
    expect(server.callsFor("/api/v1/valid/order")).toHaveLength(1);
  });

  it("a carrier with no separate validation is refused without a call", async () => {
    const id = await accepted("o1", "yal");
    const calls = noCarrierCalls();
    const res = await req("POST", `/${id}/validate`, {});
    expect(res.status).toBe(422);
    expect(await codeOf(res)).toBe("OPERATION_NOT_SUPPORTED");
    expect(calls).not.toHaveBeenCalled();
  });

  it("a carrier that refuses leaves the shipment unvalidated", async () => {
    const { id } = await handedOff("o1");
    server.override("/api/v1/valid/order", () => Response.json({ success: false, message: "refusé" }));
    const res = await req("POST", `/${id}/validate`, {});
    expect(res.status).toBe(422);
    expect(await codeOf(res)).toBe("CARRIER_REJECTED");
    expect((await row(id))!.validatedAt).toBeNull();
  });
});

describe("editing the parcel", () => {
  it("the carrier gets the full details with the changes; the order, its customer and the shipment follow", async () => {
    const { id, tracking } = await handedOff("o1");
    const res = await req("PATCH", `/${id}`, { phone: "0661112233", address: "5 Rue Larbi Ben M'hidi", amount: 2500, fragile: true });
    expect(res.status).toBe(200);
    expect(server.parcel(tracking)!.params).toMatchObject({ tel: "0661112233", adresse: "5 Rue Larbi Ben M'hidi", montant: "2500", client: "Karim Benali", wilaya: "16", fragile: "1" });

    const order = await d1.db.select().from(schema.orders).where(eq(schema.orders.id, "o1")).get();
    expect(order).toMatchObject({ phone: "0661112233", address: "5 Rue Larbi Ben M'hidi", price: 1500 });
    const customer = await d1.db.select().from(schema.customers).where(eq(schema.customers.id, "c1")).get();
    expect(customer).toMatchObject({ phone: "0661112233", address: "5 Rue Larbi Ben M'hidi" });
    expect(await row(id)).toMatchObject({ codAmount: 2500, isFragile: true });
    const events = (await getShipmentWithEvents(d1.db, id))!.events;
    expect(events.at(-1)).toMatchObject({ source: "merchant", providerStatus: "parcel_updated", reason: "phone, address, amount, fragile", actorId: "staff_1" });
  });

  it("a parcel moved to another commune costs what the company charges there; an edit that does not move it keeps its cost", async () => {
    await d1.db.insert(schema.carrierPlaces).values({
      companyId: "eco-manual", communeId: "c-16-003", wilayaRef: "16", wilayaNumber: 16, wilayaName: "Alger", communeRef: "1603", communeName: "El Madania", home: true,
      homeRate: 550, stopDeskRate: 350, homeReturnFee: 100, stopDeskReturnFee: 100,
    });
    const { id } = await handedOff("o1");
    expect(await row(id)).toMatchObject({ shippingCost: null, returnFee: null });
    expect((await req("PATCH", `/${id}`, { wilayaId: 16, communeId: "c-16-003" })).status).toBe(200);
    expect(await row(id)).toMatchObject({ shippingCost: 550, returnFee: 100 });
    await d1.db.update(schema.carrierPlaces).set({ homeRate: 800 }).where(eq(schema.carrierPlaces.communeId, "c-16-003"));
    expect((await req("PATCH", `/${id}`, { phone: "0661112233", wilayaId: 16, communeId: "c-16-003" })).status).toBe(200);
    expect(await row(id)).toMatchObject({ shippingCost: 550, returnFee: 100 });
  });

  it("keeps the parcel's reference at the carrier — EcoTrack clears what an update leaves out", async () => {
    const { id, tracking } = await handedOff("o1");
    expect(server.parcel(tracking)!.params.reference).toBe("ORD-o1");
    expect((await req("PATCH", `/${id}`, { phone: "0661112233" })).status).toBe(200);
    expect(server.parcel(tracking)!.params.reference).toBe("ORD-o1");
  });

  it("a stop-desk parcel with no address is edited with its desk's commune as the address", async () => {
    const { id, tracking } = await handedOff("o1", "eco-manual", { deliveryType: "stop_desk", stationCode: "16001", address: null });
    expect(server.parcel(tracking)!.params.adresse).toBeTruthy();
    expect((await req("PATCH", `/${id}`, { phone: "0661112233" })).status).toBe(200);
    expect(server.parcel(tracking)!.params).toMatchObject({ tel: "0661112233", adresse: expect.stringMatching(/\S/) });
  });

  it("a carrier refusal changes nothing in CodFlow", async () => {
    const { id } = await handedOff("o1");
    server.override("/api/v1/update/order", () => Response.json(NOT_MODIFIABLE_RESPONSE));
    const res = await req("PATCH", `/${id}`, { phone: "0661112233", amount: 9 });
    expect(res.status).toBe(422);
    expect((await d1.db.select().from(schema.orders).where(eq(schema.orders.id, "o1")).get())!.phone).toBe("0551234567");
    expect((await row(id))!.codAmount).toBe(1900);
  });

  it("is refused once validated at a carrier that validates separately — before any call", async () => {
    const { id } = await handedOff("o1", "eco");
    const res = await req("PATCH", `/${id}`, { phone: "0661112233" });
    expect(res.status).toBe(409);
    expect(server.callsFor("/api/v1/update/order")).toHaveLength(0);
  });

  it.each([
    ["nothing to change", {}, 400, "VALIDATION_FAILED"],
    ["a wilaya without its commune", { wilayaId: 31 }, 400, "MISSING_WILAYA_COMMUNE"],
    ["a commune of another wilaya", { wilayaId: 31, communeId: "__COMMUNE16__" }, 400, "MISSING_WILAYA_COMMUNE"],
    ["a home delivery left without an address", { address: " " }, 400, "MISSING_ADDRESS"],
  ])("refuses %s", async (_what, body, status, code) => {
    const { id } = await handedOff("o1");
    const patch = JSON.parse(JSON.stringify(body).replace("__COMMUNE16__", commune16));
    const res = await req("PATCH", `/${id}`, patch);
    expect(res.status).toBe(status);
    expect(await codeOf(res)).toBe(code);
    expect(server.callsFor("/api/v1/update/order")).toHaveLength(0);
  });

  it("refuses a field the carrier does not take", async () => {
    const id = await accepted("o1", "yal");
    const calls = noCarrierCalls();
    const res = await req("PATCH", `/${id}`, { fragile: true });
    expect(res.status).toBe(422);
    expect(await codeOf(res)).toBe("OPERATION_NOT_SUPPORTED");
    expect(calls).not.toHaveBeenCalled();
  });
});

describe("voiding", () => {
  it("cancels at the carrier, removes the shipment, and the order can be handed off again", async () => {
    const { id, tracking } = await handedOff("o1");
    const res = await req("POST", `/${id}/void`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).data).toEqual({ orderId: "o1" });
    expect(server.parcel(tracking)).toBeUndefined();
    expect(await row(id)).toBeUndefined();
    const activity = await d1.db.select().from(schema.activityLogs).all();
    expect(activity.map((a) => a.action)).toContain("shipment.voided");
    expect((await jsonRequest(app, "POST", "/api/orders/o1/shipment", { kind: "carrier", companyId: "eco-manual" })).status).toBe(201);
  });

  it("a carrier that refuses to cancel keeps the shipment", async () => {
    const { id } = await handedOff("o1");
    server.override("/api/v1/delete/order", () => Response.json({ delete: "fail", success: false }));
    const res = await req("POST", `/${id}/void`);
    expect(res.status).toBe(422);
    expect(await row(id)).toBeDefined();
  });

  it("a parcel validated at a carrier that validates separately must be cancelled there", async () => {
    const { id } = await handedOff("o1", "eco");
    const res = await req("POST", `/${id}/void`);
    expect(res.status).toBe(409);
    expect(server.callsFor("/api/v1/delete/order")).toHaveLength(0);
  });

  it("a parcel the carrier already cancelled is released without asking it", async () => {
    const id = await accepted("o1", "yal");
    await report(id, "Colis supprimé", { kind: "milestone", milestone: "cancelled" });
    const calls = noCarrierCalls();
    expect((await req("POST", `/${id}/void`)).status).toBe(200);
    expect(calls).not.toHaveBeenCalled();
    expect(await row(id)).toBeUndefined();
  });

  it("never once the parcel is out for delivery", async () => {
    const id = await accepted("o1", "yal");
    await report(id, "En livraison", { kind: "milestone", milestone: "out_for_delivery" });
    const calls = noCarrierCalls();
    const res = await req("POST", `/${id}/void`);
    expect(res.status).toBe(409);
    expect(await codeOf(res)).toBe("SHIPMENT_NOT_VOIDABLE");
    expect(calls).not.toHaveBeenCalled();
  });

  it("an inactive company's parcel can still be labelled, remarked on and cancelled", async () => {
    const { id } = await handedOff("o1");
    await d1.db.update(schema.deliveryCompanies).set({ active: false }).where(eq(schema.deliveryCompanies.id, "eco-manual"));
    expect((await req("GET", `/${id}/label`)).status).toBe(200);
    expect((await req("POST", `/${id}/remarks`, { content: "Toujours là" })).status).toBe(200);
    expect((await req("POST", `/${id}/void`)).status).toBe(200);
  });
});

describe("remarks, label, and requests to the carrier", () => {
  it("a remark is sent and kept in the history; the carrier's remarks are read back", async () => {
    const { id } = await handedOff("o1");
    expect((await req("POST", `/${id}/remarks`, { content: "Appeler avant 10h" })).status).toBe(200);
    const events = (await getShipmentWithEvents(d1.db, id))!.events;
    expect(events.at(-1)).toMatchObject({ providerStatus: "remark_added", reason: "Appeler avant 10h" });
    const { data } = (await (await req("GET", `/${id}/remarks`)).json()) as any;
    expect(data.map((r: any) => r.content)).toEqual([expect.stringContaining("Appeler avant 10h")]);
  });

  it("remarks at a carrier without them are refused without a call", async () => {
    const id = await accepted("o1", "yal");
    const calls = noCarrierCalls();
    expect((await req("POST", `/${id}/remarks`, { content: "x" })).status).toBe(422);
    expect((await req("GET", `/${id}/remarks`)).status).toBe(422);
    expect(calls).not.toHaveBeenCalled();
  });

  it("the label is fetched behind the company's credentials", async () => {
    const { id, tracking } = await handedOff("o1");
    const res = await req("GET", `/${id}/label`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toContain(`label-${tracking}.pdf`);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array(LABEL_PDF_BYTES));
  });

  it("a label link (Yalidine) is fetched and passed on", async () => {
    const id = await accepted("o1", "yal", { label: "https://labels.example/yal-1.pdf" });
    const fetched: string[] = [];
    globalThis.fetch = (async (url: string) => {
      fetched.push(String(url));
      return new Response(new Uint8Array([37, 80, 68, 70]), { headers: { "content-type": "application/pdf" } });
    }) as unknown as typeof fetch;
    const res = await req("GET", `/${id}/label`);
    expect(res.status).toBe(200);
    expect(fetched).toEqual(["https://labels.example/yal-1.pdf"]);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([37, 80, 68, 70]));
  });

  it("a return is asked once the carrier has the parcel, and noted — not a milestone", async () => {
    const { id: waiting } = await handedOff("o1");
    expect((await req("POST", `/${waiting}/ask-return`)).status).toBe(409);
    const { id, tracking } = await handedOff("o2", "eco");
    expect((await req("POST", `/${id}/ask-return`)).status).toBe(200);
    expect(server.parcel(tracking)!.returnAsked).toBe(true);
    expect((await row(id))!.returnStartedAt).toBeNull();
    expect((await steps(id)).at(-1)).toEqual(["merchant", "return_requested"]);
  });

  it("another attempt is asked after a failed one (NOEST)", async () => {
    const id = await accepted("o1", "noest");
    expect((await req("POST", `/${id}/request-new-attempt`)).status).toBe(409);
    await report(id, "Tentative échouée", { kind: "failed_attempt" });
    const sent: Array<{ url: string; body: unknown }> = [];
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      sent.push({ url: String(url), body: JSON.parse(String(init.body)) });
      return Response.json({ success: true });
    }) as unknown as typeof fetch;
    expect((await req("POST", `/${id}/request-new-attempt`)).status).toBe(200);
    expect(sent).toEqual([{ url: expect.stringMatching(/\/ask\/new-tentative$/), body: { tracking: "P-o1" } }]);
    expect((await steps(id)).at(-1)).toEqual(["merchant", "new_attempt_requested"]);
  });
});

describe("confirming a return at the carrier", () => {
  it("confirms, then records the return: the goods go back in stock", async () => {
    await d1.db.insert(schema.products).values({
      id: "p2", name: "Caftan", handle: "caftan", price: 9000, sku: "CAF", hasVariants: false, inventory: 10, trackInventory: true,
      lowStockThreshold: 1, status: "ACTIVE", visibility: true, showInStore: true, createdAt: T0, updatedAt: T0,
    });
    const { id } = await handedOff("o1", "eco", { lines: [] });
    await d1.db.insert(schema.orderProducts).values({ id: "l1", orderId: "o1", productId: "p2", productName: "Caftan", quantity: 2, pricePerUnit: 9000, lineTotal: 18000, createdAt: T0 });
    const res = await req("POST", `/${id}/confirm-return`);
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as any;
    expect(data).toMatchObject({ recorded: 1, reached: ["returned"] });
    expect(data.shipment.returnedAt).not.toBeNull();
    expect((await d1.db.select().from(schema.products).where(eq(schema.products.id, "p2")).get())!.inventory).toBe(12);
    expect((await steps(id)).at(-1)).toEqual(["merchant", "return_received"]);
  });

  it("nothing eligible at the carrier records nothing", async () => {
    const { id } = await handedOff("o1", "eco");
    server.override("/api/v1/valid/returns", () => Response.json(RETURNS_NOT_ELIGIBLE_RESPONSE));
    const res = await req("POST", `/${id}/confirm-return`);
    expect(res.status).toBe(409);
    expect((await row(id))!.returnedAt).toBeNull();
  });
});

describe("syncing with the carrier", () => {
  it("records what the carrier reports that is new, once", async () => {
    const { id, tracking } = await handedOff("o1", "eco");
    server.parcel(tracking)!.activity.push({ ...algiersNow(60_000), status: "picked", station: "" });
    const first = (await (await req("POST", `/${id}/sync`)).json()) as any;
    expect(first.data).toMatchObject({ recorded: 3, duplicates: 0 });
    expect((await steps(id)).filter(([source]) => source === "pull").map(([, s]) => s).sort()).toEqual(["order_information_received_by_carrier", "picked", "vers_hub"].sort());
    const bucket = (await getShipmentWithEvents(d1.db, id))!.events.find((e) => e.vocabulary === "status");
    expect(bucket).toMatchObject({ providerStatus: "vers_hub", providerStatusLabel: "Vers le hub" });
    expect(first.data.shipment.lastSyncedAt).not.toBeNull();

    const second = (await (await req("POST", `/${id}/sync`)).json()) as any;
    expect(second.data).toMatchObject({ recorded: 0, duplicates: 2 });
  });

  it("reads the carrier's bucket too: a parcel EcoTrack suspends needs the merchant, one it cancels goes back to be shipped", async () => {
    const { id, tracking } = await handedOff("o1", "eco");
    server.parcel(tracking)!.status = "suspendu";
    await req("POST", `/${id}/sync`);
    let order = ((await (await jsonRequest(app, "GET", "/api/orders/o1")).json()) as any).data;
    expect(order).toMatchObject({ needsAttention: true, shipment: { providerStatus: "suspendu", providerStatusLabel: "Suspendu" } });

    server.parcel(tracking)!.status = "annule";
    await req("POST", `/${id}/sync`);
    order = ((await (await jsonRequest(app, "GET", "/api/orders/o1")).json()) as any).data;
    expect(order).toMatchObject({ stage: "delivery_cancelled", needsAttention: true });
    expect(order.shipment.actions).toContain("void");
  });

  it("an unreachable carrier changes nothing", async () => {
    const { id } = await handedOff("o1", "eco");
    server.override("/api/v1/get/tracking/info", () => new Response("{}", { status: 503 }));
    const res = await req("POST", `/${id}/sync`);
    expect(res.status).toBe(502);
    expect((await row(id))!.lastSyncedAt).toBeNull();
  });
});

describe("what the merchant reports", () => {
  const post = (id: string, body: unknown) => req("POST", `/${id}/events`, body);

  it("the goods came back on a carrier shipment: recorded, with its reason and time", async () => {
    const id = await accepted("o1", "yal");
    const utc = new Date(Math.ceil(Date.now() / 1000) * 1000 + 1000);
    const algiers = new Date(utc.getTime() + 3_600_000).toISOString().replace(".000Z", "+01:00");
    const res = await post(id, { status: "returned", reason: "Colis rapporté au magasin", occurredAt: algiers });
    expect(res.status).toBe(200);
    const shipment = await row(id);
    expect(shipment!.returnedAt).toBe(utc.toISOString());
    const event = (await getShipmentWithEvents(d1.db, id))!.events.at(-1);
    expect(event).toMatchObject({ source: "merchant", vocabulary: "merchant", providerStatus: "returned", reason: "Colis rapporté au magasin", actorId: "staff_1" });
  });

  it("a merchant can never say a carrier delivered", async () => {
    const id = await accepted("o1", "yal");
    for (const status of ["delivered", "out_for_delivery", "failed_attempt"]) {
      const res = await post(id, { status });
      expect(res.status).toBe(409);
      expect(await codeOf(res)).toBe("SHIPMENT_REPORT_NOT_ALLOWED");
    }
    expect((await row(id))!.deliveredAt).toBeNull();
  });

  it("a closed shipment takes no report", async () => {
    const id = await accepted("o1", "yal");
    await report(id, "Livré", { kind: "milestone", milestone: "delivered" });
    const res = await post(id, { status: "returned" });
    expect(res.status).toBe(409);
    expect(await codeOf(res)).toBe("SHIPMENT_CLOSED");
  });

  it("a time in the future, or before the handoff, is refused", async () => {
    const id = await accepted("o1", "yal");
    expect((await post(id, { status: "returned", occurredAt: new Date(Date.now() + 3_600_000).toISOString() })).status).toBe(400);
    expect((await post(id, { status: "returned", occurredAt: "2020-01-01T00:00:00.000Z" })).status).toBe(400);
    expect((await row(id))!.returnedAt).toBeNull();
  });

  describe("a driver's progress", () => {
    let id: string;
    beforeEach(async () => {
      await d1.db.insert(schema.drivers).values({ id: "dr1", firstName: "Amine", lastName: "B", phone: "0661111111", createdAt: T0, updatedAt: T0 });
      await d1.db.insert(schema.driverCompensations).values({ id: "comp1", driverId: "dr1", wilayaId: 16, feePerDelivery: 300, createdAt: T0, updatedAt: T0 });
      await seedOrder({ id: "d1" });
      const [handed] = await handOffToDriver(d1.db, { orderIds: ["d1"], driverId: "dr1", author: SYSTEM });
      if (!handed.ok) throw new Error("driver handoff failed");
      id = handed.shipmentId;
    });

    it("is reported in the driver's own words; delivered credits the driver once", async () => {
      scopes = ["orders:assign", "orders:read"];
      expect((await post(id, { status: "out_for_delivery" })).status).toBe(200);
      expect((await post(id, { status: "failed_attempt", reason: "Client ne répond pas" })).status).toBe(200);
      const delivered = await post(id, { status: "delivered" });
      expect(delivered.status).toBe(200);
      expect(((await delivered.json()) as any).data.reached).toEqual(["delivered"]);
      const driver = await d1.db.select().from(schema.drivers).where(eq(schema.drivers.id, "dr1")).get();
      expect(driver).toMatchObject({ totalDelivered: 1, totalEarnings: 300, pendingCash: 1900 });
      const shipment = await row(id);
      expect(shipment).toMatchObject({ deliveryAttempts: 1, providerStatus: "delivered" });
      expect((await getShipmentWithEvents(d1.db, id))!.events.map((e) => e.vocabulary)).toEqual(["codflow", "driver", "driver", "driver"]);
    });

    it("needs the assignment permission, not the dispatch one — and the reverse for a carrier", async () => {
      scopes = ["delivery:dispatch"];
      const res = await post(id, { status: "delivered" });
      expect(res.status).toBe(403);
      expect((await row(id))!.deliveredAt).toBeNull();

      const carrierShipment = await accepted("o1", "yal");
      scopes = ["orders:assign"];
      expect((await post(carrierShipment, { status: "returned" })).status).toBe(403);
    });

    it("carrier operations are not offered to a driver's shipment", async () => {
      for (const [method, path] of [["POST", "validate"], ["POST", "sync"], ["GET", "label"], ["POST", "ask-return"]] as const) {
        const res = await req(method, `/${id}/${path}`, method === "POST" && path === "validate" ? {} : undefined);
        expect(res.status, path).toBe(422);
      }
    });
  });
});

describe("a parcel the carrier has not accepted has nothing to act on", () => {
  it("every operation waits — and never calls the carrier", async () => {
    await seedOrder({ id: "o1" });
    const reserved = await reserveCarrierShipment(d1.db, { orderId: "o1", companyId: "eco", deliveryType: "home", stationCode: null, weight: null, isFragile: null, shippingCost: null, returnFee: null, createdBy: null });
    if (!reserved.ok) throw new Error("reservation failed");
    await markHandoffUnknown(d1.db, reserved.shipmentId, "timeout");
    const calls = noCarrierCalls();
    for (const [method, path, body] of [
      ["POST", "/validate", {}],
      ["PATCH", "", { phone: "0661112233" }],
      ["POST", "/void", undefined],
      ["POST", "/remarks", { content: "x" }],
      ["GET", "/label", undefined],
      ["POST", "/sync", undefined],
      ["POST", "/events", { status: "returned" }],
    ] as const) {
      const res = await req(method, `/${reserved.shipmentId}${path}`, body);
      expect(res.status, path).toBe(409);
      expect(await codeOf(res), path).toBe("SHIPMENT_HANDOFF_PENDING");
    }
    expect(calls).not.toHaveBeenCalled();
  });

  it("an unknown shipment is a 404", async () => {
    expect((await req("POST", "/nope/void")).status).toBe(404);
  });
});

describe("who may act", () => {
  it("reading is not enough to change a shipment", async () => {
    const { id } = await handedOff("o1");
    scopes = ["orders:read"];
    for (const [method, path, body] of [["POST", "/validate", {}], ["PATCH", "", { phone: "0661112233" }], ["POST", "/void", undefined], ["POST", "/sync", undefined]] as const) {
      expect((await req(method, `/${id}${path}`, body)).status, path).toBe(403);
    }
    expect((await req("GET", `/${id}/label`)).status).toBe(200);
  });
});
