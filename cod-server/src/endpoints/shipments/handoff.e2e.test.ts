/**
 * Handing orders to a carrier, through the real route stack onto real D1,
 * with the real adapters talking HTTP to a faithful EcoTrack double (and a
 * Yalidine stub where its rules are the subject).
 *
 * What is proved: what each carrier answer means for the shipment and the
 * order; that one order is never sent twice, however many clicks race; that
 * single and bulk handoffs are the same handoff; and that an unknown outcome
 * is resolved — never re-sent.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { OpenAPIHono } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import type { AppContext } from "@/types";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import * as schema from "@/db/schema";
import { createEcotrackMockServer, type EcotrackMockServer } from "@/carriers/ecotrack/test/mock-server";
import { CREATE_WILAYA_REFUSED_RESPONSE } from "@/carriers/ecotrack/test/fixtures";
import { getShipmentWithEvents } from "../../../../cod-shared/shipments/queries";
import { markHandoffUnknown, reserveCarrierShipment } from "../../../../cod-shared/shipments/handoff";
import { seedOrder as seedOrderIn, seedStore, shipmentsApp, T0, type OrderSeed } from "./test/harness";

const dbModule = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/db", () => dbModule);

const failures = vi.hoisted(() => ({ accept: false }));
vi.mock("../../../../cod-shared/shipments/handoff", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../../../cod-shared/shipments/handoff")>();
  return {
    ...real,
    acceptCarrierHandoff: async (...args: Parameters<typeof real.acceptCarrierHandoff>) => {
      if (failures.accept) throw new Error("D1_ERROR: storage unavailable");
      return real.acceptCarrierHandoff(...args);
    },
  };
});

let d1: TestD1;
let app: OpenAPIHono<AppContext>;
let scopes: string[] = [];
let server: EcotrackMockServer;
const realFetch = globalThis.fetch;
const CREATE = "/api/v1/create/order";
const BULK = "/api/v1/create/orders";

beforeAll(async () => {
  d1 = await createTestD1();
  app = shipmentsApp(d1, () => scopes);
}, 120_000);

afterAll(async () => {
  await d1?.dispose();
});

let commune16: string;

beforeEach(async () => {
  dbModule.getDb.mockReturnValue(d1.db);
  scopes = ["delivery:dispatch", "orders:read"];
  failures.accept = false;
  server = createEcotrackMockServer();
  globalThis.fetch = ((url: string | URL, init?: RequestInit) => server.fetch(url, init)) as typeof fetch;
  commune16 = await seedStore(d1.db, server);
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

const seedOrder = (seed: OrderSeed) => seedOrderIn(d1.db, commune16, seed);

const post = (path: string, body: unknown) =>
  app.request(path, { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
const handOff = (orderId: string, body: Record<string, unknown> = {}) => post(`/api/orders/${orderId}/shipment`, { kind: "carrier", companyId: "eco", ...body });
const bulk = (orderIds: string[], companyId = "eco") => post("/api/shipments/bulk", { companyId, orderIds });
const resolve = (shipmentId: string, body: unknown) => post(`/api/shipments/${shipmentId}/resolve`, body);

const shipmentOf = (orderId: string) => d1.db.select().from(schema.shipments).where(eq(schema.shipments.orderId, orderId)).get();
const orderStatus = async (orderId: string) => (await d1.db.select({ status: schema.orders.status }).from(schema.orders).where(eq(schema.orders.id, orderId)).get())?.status;
const history = async (shipmentId: string) => (await getShipmentWithEvents(d1.db, shipmentId))!.events.map((e) => [e.source, e.providerStatus]);
const creates = () => server.callsFor(CREATE).length + server.callsFor(BULK).length;

describe("handing one order to a carrier", () => {
  it("the carrier creates the parcel and the company's auto-validation validates it; the order stays ready", async () => {
    await seedOrder({ id: "o1" });
    const res = await handOff("o1");
    expect(res.status).toBe(201);
    const { data } = (await res.json()) as any;
    expect(data).toMatchObject({ orderId: "o1", orderNumber: "ORD-o1", outcome: "accepted", validationError: null });
    expect(data.shipment).toMatchObject({ kind: "carrier", companyId: "eco", handoffState: "accepted", trackingNumber: "ECMOCK0000000001", codAmount: 1900, deliveryType: "home" });
    expect(data.shipment.validatedAt).not.toBeNull();
    expect(data.shipment).not.toHaveProperty("revision");
    expect(data.shipment).not.toHaveProperty("carrierData");

    expect(server.parcel("ECMOCK0000000001")).toMatchObject({ validated: true, reference: "ORD-o1" });
    expect(server.parcel("ECMOCK0000000001")!.params).toMatchObject({ montant: "1900", code_wilaya: "16", produit: "Robe kabyle — ORD-o1", stop_desk: "0" });
    expect(await orderStatus("o1")).toBe("ready");
    expect(await history(data.shipment.id)).toEqual([["handoff", "created"], ["handoff", "validated"]]);

    const logs = await d1.db.select().from(schema.companyApiLogs).all();
    expect(logs.map((l) => [l.action, l.orderId, l.success])).toEqual([["createShipment", "o1", true], ["validate", "o1", true]]);
    const activity = await d1.db.select().from(schema.activityLogs).all();
    expect(activity.map((a) => [a.action, a.entityId])).toEqual([["order.dispatched", "o1"]]);
  });

  it("without auto-validation the parcel waits, and validating is what is offered next", async () => {
    await seedOrder({ id: "o1" });
    const { data } = (await (await handOff("o1", { companyId: "eco-manual" })).json()) as any;
    expect(data.shipment.validatedAt).toBeNull();
    expect(data.shipment.actions).toContain("validate");
    expect(server.callsFor("/api/v1/valid/order")).toHaveLength(0);
    expect(server.parcel(data.shipment.trackingNumber)!.validated).toBe(false);
  });

  it("a validation the carrier refuses is kept in the history; the parcel stays created", async () => {
    await seedOrder({ id: "o1" });
    server.override("/api/v1/valid/order", () => Response.json({ success: false, message: "Commande déjà validée" }));
    const res = await handOff("o1");
    expect(res.status).toBe(201);
    const { data } = (await res.json()) as any;
    expect(data.validationError).toMatch(/déjà validée/);
    expect(data.shipment).toMatchObject({ handoffState: "accepted", validatedAt: null });
    const events = (await getShipmentWithEvents(d1.db, data.shipment.id))!.events;
    expect(events.map((e) => [e.providerStatus, e.reason])).toEqual([["created", null], ["validation_failed", expect.stringMatching(/déjà validée/)]]);
  });

  it("the merchant's choices win over the order's: stop desk, weight, fragile, remarks", async () => {
    await seedOrder({ id: "o1", notes: "Appeler avant" });
    const { data } = (await (await handOff("o1", { deliveryType: "stop_desk", stationCode: "160101", weight: 2.5, fragile: true, remarks: "Fragile" })).json()) as any;
    expect(data.shipment).toMatchObject({ deliveryType: "stop_desk", stationCode: "160101", weight: 2.5, isFragile: true, codAmount: 1900 });
    expect(server.parcel(data.shipment.trackingNumber)!.params).toMatchObject({ stop_desk: "1", code_postal: "160101", weight: "2.5", fragile: "1", remarque: "Fragile" });
    expect((await d1.db.select({ t: schema.orders.deliveryType }).from(schema.orders).where(eq(schema.orders.id, "o1")).get())!.t).toBe("home");
  });

  it("the order's notes go to the courier when the merchant gives no remark", async () => {
    await seedOrder({ id: "o1", notes: "Appeler avant" });
    const { data } = (await (await handOff("o1")).json()) as any;
    expect(server.parcel(data.shipment.trackingNumber)!.params.remarque).toBe("Appeler avant");
  });
});

describe("the parcel the carrier receives", () => {
  it("the cash to collect is the order total — goods and delivery fee", async () => {
    await seedOrder({ id: "o1", price: 5_200, deliveryFee: 400 });
    const { data } = (await (await handOff("o1")).json()) as any;
    expect(server.parcel(data.shipment.trackingNumber)!.params.montant).toBe("5600");
  });

  it("names every product and keeps the order number, even when a large basket is cut short", async () => {
    await seedOrder({ id: "small", lines: ["Shirt", "Mug", "Cap"] });
    await seedOrder({ id: "large", lines: Array.from({ length: 40 }, (_, i) => `Produit artisanal numéro ${i + 1}`) });
    await handOff("small");
    await handOff("large");
    const sent = (orderId: string) => server.requests.find((r) => r.path === CREATE && r.searchParams.get("reference") === `ORD-${orderId}`)!.searchParams.get("produit")!;
    expect(sent("small")).toBe("Shirt, Mug, Cap — ORD-small");
    expect(sent("large").length).toBeLessThanOrEqual(255);
    expect(sent("large").endsWith("— ORD-large")).toBe(true);
  });

  it("an unweighed basket is weighed from its variants", async () => {
    await d1.db.insert(schema.productVariants).values([
      { id: "v1", productId: "p1", variations: "{}", price: 1500, sku: "V1", weightKg: 0.4, createdAt: T0, updatedAt: T0 },
      { id: "v2", productId: "p1", variations: "{}", price: 1500, sku: "V2", weightKg: 1.1, createdAt: T0, updatedAt: T0 },
    ]);
    await seedOrder({ id: "o1", lines: [] });
    await d1.db.insert(schema.orderProducts).values([
      { id: "l1", orderId: "o1", productId: "p1", variantId: "v1", productName: "Robe", quantity: 3, pricePerUnit: 1500, lineTotal: 4500, createdAt: T0 },
      { id: "l2", orderId: "o1", productId: "p1", variantId: "v2", productName: "Robe", quantity: 1, pricePerUnit: 1500, lineTotal: 1500, createdAt: T0 },
    ]);
    const { data } = (await (await handOff("o1")).json()) as any;
    expect(data.shipment.weight).toBe(2.3);
    expect(server.parcel(data.shipment.trackingNumber)!.params.weight).toBe("2.3");
  });

  it("a carrier with no published ceiling is never blocked", async () => {
    await seedOrder({ id: "o1", price: 9_000_000 });
    expect((await handOff("o1")).status).toBe(201);
  });

  it("a carrier that matches addresses by name gets its own spelling, once synced", async () => {
    const sent: any[] = [];
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      const parcels = JSON.parse(String(init.body));
      sent.push(...parcels);
      return Response.json(Object.fromEntries(parcels.map((p: any) => [p.order_id, { success: true, tracking: `yal-${p.order_id}`, label: null, message: "" }])));
    }) as unknown as typeof fetch;
    await d1.db.insert(schema.carrierWilayas).values({ carrierCode: "yalidine", wilayaId: 16, carrierName: "Alger (Yalidine)" });
    await d1.db.insert(schema.carrierCommunes).values({ carrierCode: "yalidine", communeId: commune16, carrierName: "Commune (Yalidine)" });
    await seedOrder({ id: "o1" });
    expect((await handOff("o1", { companyId: "yal" })).status).toBe(201);
    expect(sent[0]).toMatchObject({ to_wilaya_name: "Alger (Yalidine)", to_commune_name: "Commune (Yalidine)", price: 1900 });
  });
});

describe("refused before the carrier is called — nothing reserved, nothing sent", () => {
  it.each([
    ["an order that is not ready", { id: "o1", status: "confirmed" as const }, {}, 422, "ORDER_NOT_READY_FOR_HANDOFF"],
    ["a home delivery with no street address", { id: "o1", address: "  " }, {}, 400, "MISSING_ADDRESS"],
    ["a stop desk with no desk", { id: "o1", deliveryType: "stop_desk" as const }, {}, 400, "MISSING_STATION_CODE"],
    ["a delivery type the company does not offer", { id: "o1" }, { companyId: "eco-home-only", deliveryType: "stop_desk", stationCode: "1" }, 422, "DELIVERY_NOT_AVAILABLE"],
    ["an inactive company", { id: "o1" }, { companyId: "off" }, 422, "COMPANY_INACTIVE"],
    ["a company with no credentials", { id: "o1" }, { companyId: "unconnected" }, 400, "MISSING_API_CREDENTIALS"],
  ])("%s", async (_what, seed, body, status, code) => {
    await seedOrder(seed);
    const res = await handOff("o1", body);
    expect(res.status).toBe(status);
    expect(((await res.json()) as any).code).toBe(code);
    expect(await shipmentOf("o1")).toBeUndefined();
    expect(server.requests).toHaveLength(0);
  });

  it("an unknown order or company is a 404", async () => {
    expect((await handOff("missing")).status).toBe(404);
    await seedOrder({ id: "o1" });
    expect((await handOff("o1", { companyId: "nope" })).status).toBe(404);
  });

  describe("a parcel over the carrier's value ceiling (Yalidine: 150,000 DZD)", () => {
    let yalidineCalls: number;
    beforeEach(() => {
      yalidineCalls = 0;
      globalThis.fetch = (async () => {
        yalidineCalls++;
        return Response.json({});
      }) as unknown as typeof fetch;
    });

    it("is refused with what to do instead, single and bulk alike", async () => {
      await seedOrder({ id: "big", price: 149_700, deliveryFee: 400 });
      const single = await handOff("big", { companyId: "yal" });
      expect(single.status).toBe(422);
      const body = (await single.json()) as any;
      expect(body.code).toBe("VALUE_OUT_OF_RANGE");
      expect(body.error).toMatch(/150000 DZD.*Split it/);

      expect(yalidineCalls).toBe(0);
      expect(await shipmentOf("big")).toBeUndefined();
    });

    it("in a bulk handoff, only the parcel over the ceiling is held back", async () => {
      const sent: string[] = [];
      globalThis.fetch = (async (_url: string, init: RequestInit) => {
        yalidineCalls++;
        const parcels = JSON.parse(String(init.body));
        sent.push(...parcels.map((p: any) => p.order_id));
        return Response.json(Object.fromEntries(parcels.map((p: any) => [p.order_id, { success: true, tracking: `yal-${p.order_id}`, label: null, message: "" }])));
      }) as unknown as typeof fetch;
      await seedOrder({ id: "big", price: 149_700, deliveryFee: 400 });
      await seedOrder({ id: "small" });
      await seedOrder({ id: "small2" });
      const many = (await (await bulk(["big", "small", "small2"], "yal")).json()) as any;
      expect(many.data.results.map((r: any) => [r.orderId, r.outcome, r.error?.code ?? null])).toEqual([
        ["big", "refused", "VALUE_OUT_OF_RANGE"],
        ["small", "accepted", null],
        ["small2", "accepted", null],
      ]);
      expect(yalidineCalls).toBe(1);
      expect(sent).toEqual(["ORD-small", "ORD-small2"]);
      expect(await shipmentOf("big")).toBeUndefined();
    });

    it("exactly the ceiling is accepted", async () => {
      globalThis.fetch = (async (_url: string, init: RequestInit) => {
        yalidineCalls++;
        const [parcel] = JSON.parse(String(init.body));
        return Response.json({ [parcel.order_id]: { success: true, tracking: "yal-1", label: null, message: "" } });
      }) as unknown as typeof fetch;
      await seedOrder({ id: "edge", price: 149_600, deliveryFee: 400 });
      expect((await handOff("edge", { companyId: "yal" })).status).toBe(201);
      expect(yalidineCalls).toBe(1);
    });
  });
});

describe("what each carrier failure means", () => {
  const html = (status: number) => new Response("<html><body>Blocked</body></html>", { status, headers: { "content-type": "text/html" } });

  it.each([
    ["refused (EcoTrack business refusal)", () => Response.json(CREATE_WILAYA_REFUSED_RESPONSE), 422, "CARRIER_REJECTED"],
    ["refused (validation errors)", () => Response.json({ message: "invalid", errors: { telephone: ["invalid"] } }, { status: 422 }), 422, "CARRIER_REJECTED"],
    ["bad credentials", () => Response.json({ message: "Unauthenticated." }, { status: 401 }), 409, "CARRIER_AUTH_FAILED"],
    ["throttled", () => new Response("{}", { status: 429, headers: { "retry-after": "30" } }), 429, "CARRIER_RATE_LIMITED"],
    ["never reached the carrier (edge block page)", () => html(403), 502, "CARRIER_UNAVAILABLE"],
  ])("%s → nothing was created: the reservation goes, the order can be sent again", async (_what, answer, status, code) => {
    await seedOrder({ id: "o1" });
    server.override(CREATE, answer);
    const res = await handOff("o1");
    expect(res.status).toBe(status);
    expect(((await res.json()) as any).code).toBe(code);
    expect(await shipmentOf("o1")).toBeUndefined();
    expect(await orderStatus("o1")).toBe("ready");

    server.restore(CREATE);
    expect((await handOff("o1")).status).toBe(201);
  });

  it.each([
    ["a server error", () => new Response("{}", { status: 500 })],
    ["a success without a tracking number", () => Response.json({ success: true })],
    ["a success that is not JSON", () => new Response("<html>ok</html>", { status: 200 })],
    [
      "a dropped connection",
      () => {
        throw new TypeError("network connection lost");
      },
    ],
  ])("%s → the parcel may exist: unknown, kept with the reason, never re-sent", async (_what, answer) => {
    await seedOrder({ id: "o1" });
    server.override(CREATE, answer as () => Response);
    const res = await handOff("o1");
    expect(res.status).toBe(202);
    const { data } = (await res.json()) as any;
    expect(data).toMatchObject({ outcome: "unknown", shipment: { handoffState: "unknown", trackingNumber: null } });
    expect(data.shipment.actions).toEqual(expect.arrayContaining(["resolve", "lookup"]));
    expect(data.message).toBeTruthy();
    const events = (await getShipmentWithEvents(d1.db, data.shipment.id))!.events;
    expect(events.map((e) => [e.source, e.providerStatus, e.reason])).toEqual([["system", "handoff_outcome_unknown", data.message]]);

    server.restore(CREATE);
    const again = await handOff("o1");
    expect(again.status).toBe(409);
    expect(((await again.json()) as any).code).toBe("ORDER_HAS_SHIPMENT");
    expect(server.callsFor(CREATE)).toHaveLength(1);
  });

  it("a parcel created but not recorded is kept as unknown, with its tracking number in the reason", async () => {
    await seedOrder({ id: "o1" });
    failures.accept = true;
    const res = await handOff("o1");
    expect(res.status).toBe(202);
    const { data } = (await res.json()) as any;
    expect(data.message).toMatch(/ECMOCK0000000001.*storage unavailable/);
    expect((await shipmentOf("o1"))!.handoffState).toBe("unknown");
  });
});

describe("one order is never sent twice", () => {
  it("five dispatches at once: one carrier call, one shipment, four refusals", async () => {
    await seedOrder({ id: "o1" });
    const responses = await Promise.all(Array.from({ length: 5 }, () => handOff("o1")));
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409, 409, 409, 409]);
    expect(server.callsFor(CREATE)).toHaveLength(1);
    expect(await d1.db.select().from(schema.shipments).all()).toHaveLength(1);
  });

  it("an order already in a bulk handoff is refused by a single one, and the reverse", async () => {
    await seedOrder({ id: "o1" });
    await seedOrder({ id: "o2" });
    await bulk(["o1", "o2"]);
    expect(((await (await handOff("o1")).json()) as any).code).toBe("ORDER_HAS_SHIPMENT");
    const again = (await (await bulk(["o2"])).json()) as any;
    expect(again.data.results[0]).toMatchObject({ outcome: "refused", error: { code: "ORDER_HAS_SHIPMENT" } });
    expect(creates()).toBe(1);
  });
});

describe("bulk is the same handoff", () => {
  const comparable = (row: typeof schema.shipments.$inferSelect) => ({
    kind: row.kind,
    companyId: row.companyId,
    handoffState: row.handoffState,
    deliveryType: row.deliveryType,
    stationCode: row.stationCode,
    codAmount: row.codAmount,
    weight: row.weight,
    isFragile: row.isFragile,
    validated: row.validatedAt !== null,
  });
  const sentParams = (tracking: string) => {
    const { reference: _r, produit, ...rest } = server.parcel(tracking)!.params;
    return { ...rest, produit: produit.replace(/ORD-\w+/, "ORD-x") };
  };

  it("identical orders give identical shipments and identical parcels, one at a time or a hundred at once", async () => {
    for (const id of ["single", "bulk1", "bulk2"]) await seedOrder({ id, lines: ["Robe", "Foulard"], notes: "Sonner deux fois" });
    await handOff("single");
    const many = (await (await bulk(["bulk1", "bulk2"])).json()) as any;
    expect(many.data.summary).toEqual({ accepted: 2, unknown: 0, refused: 0 });
    expect(server.callsFor(BULK)).toHaveLength(1);

    const [single, bulk1, bulk2] = await Promise.all(["single", "bulk1", "bulk2"].map(shipmentOf));
    expect(comparable(bulk1!)).toEqual(comparable(single!));
    expect(comparable(bulk2!)).toEqual(comparable(single!));
    expect(sentParams(bulk1!.trackingNumber!)).toEqual(sentParams(single!.trackingNumber!));
    expect(await history(bulk1!.id)).toEqual(await history(single!.id));
  });

  it("one result per order, in request order; a refused order does not stop the others", async () => {
    await seedOrder({ id: "ok1" });
    await seedOrder({ id: "notReady", status: "preparing" });
    await seedOrder({ id: "badWilaya", wilayaId: 12 });
    await seedOrder({ id: "ok2" });
    const res = await bulk(["ok1", "notReady", "missing", "badWilaya", "ok2", "ok1"]);
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as any;
    expect(data.results.map((r: any) => [r.orderId, r.outcome, r.error?.code ?? null])).toEqual([
      ["ok1", "accepted", null],
      ["notReady", "refused", "ORDER_NOT_READY_FOR_HANDOFF"],
      ["missing", "refused", "ORDER_NOT_FOUND"],
      ["badWilaya", "refused", "CARRIER_REJECTED"],
      ["ok2", "accepted", null],
    ]);
    expect(data.summary).toEqual({ accepted: 2, unknown: 0, refused: 3 });
    expect(await shipmentOf("badWilaya")).toBeUndefined();
    expect(data.results[0].shipment.trackingNumber).toBe((await shipmentOf("ok1"))!.trackingNumber);
  });

  it("a whole call that may have created parcels leaves every one unknown", async () => {
    await seedOrder({ id: "o1" });
    await seedOrder({ id: "o2" });
    server.override(BULK, () => new Response("{}", { status: 500 }));
    const { data } = (await (await bulk(["o1", "o2"])).json()) as any;
    expect(data.results.map((r: any) => r.outcome)).toEqual(["unknown", "unknown"]);
    expect((await shipmentOf("o1"))!.handoffState).toBe("unknown");
    expect((await shipmentOf("o2"))!.handoffState).toBe("unknown");
  });

  it("a whole call the carrier refused frees every order", async () => {
    await seedOrder({ id: "o1" });
    await seedOrder({ id: "o2" });
    server.override(BULK, () => new Response("{}", { status: 429 }));
    const { data } = (await (await bulk(["o1", "o2"])).json()) as any;
    expect(data.results.map((r: any) => [r.outcome, r.error.code])).toEqual([["refused", "CARRIER_RATE_LIMITED"], ["refused", "CARRIER_RATE_LIMITED"]]);
    expect(await d1.db.select().from(schema.shipments).all()).toHaveLength(0);
  });

  it("an answer that leaves a parcel out leaves that parcel unknown", async () => {
    await seedOrder({ id: "o1" });
    await seedOrder({ id: "o2" });
    server.override(BULK, () => Response.json({ results: { "ORD-o1": { success: true, tracking: "ECX1" } } }));
    const { data } = (await (await bulk(["o1", "o2"])).json()) as any;
    expect(data.results.map((r: any) => r.outcome)).toEqual(["accepted", "unknown"]);
  });
});

describe("resolving an unknown outcome — never by sending again", () => {
  /** The carrier creates the parcel but the answer is lost. */
  async function lostAnswer(orderId: string) {
    await seedOrder({ id: orderId });
    server.override(CREATE, async (req) => {
      server.restore(CREATE);
      await server.fetch(req.url, { method: "POST", headers: req.headers });
      return new Response("{}", { status: 504 });
    });
    const { data } = (await (await handOff(orderId)).json()) as any;
    expect(data.outcome).toBe("unknown");
    return data.shipment.id as string;
  }

  it("lookup finds the parcel by the order number and records it", async () => {
    const id = await lostAnswer("o1");
    const createsSoFar = server.callsFor(CREATE).length;
    const res = await resolve(id, { action: "lookup" });
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as any;
    expect(data).toMatchObject({ outcome: "accepted", shipment: { handoffState: "accepted", trackingNumber: "ECMOCK0000000001" } });
    expect(await history(id)).toEqual([["system", "handoff_outcome_unknown"], ["system", "created"]]);
    expect(server.callsFor(CREATE)).toHaveLength(createsSoFar);
  });

  it("lookup that finds nothing leaves it unknown", async () => {
    await seedOrder({ id: "o1" });
    server.override(CREATE, () => new Response("{}", { status: 500 }));
    const { data: handed } = (await (await handOff("o1")).json()) as any;
    const { data } = (await (await resolve(handed.shipment.id, { action: "lookup" })).json()) as any;
    expect(data).toEqual({ outcome: "not_found" });
    expect((await shipmentOf("o1"))!.handoffState).toBe("unknown");
  });

  it("attach records the tracking number the merchant found", async () => {
    const id = await lostAnswer("o1");
    const { data } = (await (await resolve(id, { action: "attach", trackingNumber: " ECMOCK0000000001 " })).json()) as any;
    expect(data.shipment).toMatchObject({ handoffState: "accepted", trackingNumber: "ECMOCK0000000001", carrierParcelId: "ECMOCK0000000001" });
    expect(await history(id)).toEqual([["system", "handoff_outcome_unknown"], ["merchant", "created"]]);
  });

  it("attach refuses a parcel that already belongs to another shipment", async () => {
    await seedOrder({ id: "other" });
    const { data: taken } = (await (await handOff("other")).json()) as any;
    const id = await lostAnswer("o1");
    const res = await resolve(id, { action: "attach", trackingNumber: taken.shipment.trackingNumber });
    expect(res.status).toBe(409);
    expect((await shipmentOf("o1"))!.handoffState).toBe("unknown");
  });

  it("release: the carrier has nothing — the order is ready to hand off again", async () => {
    await seedOrder({ id: "o1" });
    server.override(CREATE, () => new Response("{}", { status: 500 }));
    const { data: handed } = (await (await handOff("o1")).json()) as any;
    const { data } = (await (await resolve(handed.shipment.id, { action: "release" })).json()) as any;
    expect(data).toEqual({ outcome: "released" });
    expect(await shipmentOf("o1")).toBeUndefined();
    const activity = await d1.db.select().from(schema.activityLogs).all();
    expect(activity.map((a) => a.action)).toEqual(["shipment.released"]);

    server.restore(CREATE);
    expect((await handOff("o1")).status).toBe(201);
  });

  it("an accepted shipment is not resolved", async () => {
    await seedOrder({ id: "o1" });
    const { data: handed } = (await (await handOff("o1")).json()) as any;
    for (const body of [{ action: "release" }, { action: "attach", trackingNumber: "X" }, { action: "lookup" }]) {
      const res = await resolve(handed.shipment.id, body);
      expect(res.status).toBe(409);
      expect(((await res.json()) as any).code).toBe("SHIPMENT_ACTION_NOT_AVAILABLE");
    }
    expect((await shipmentOf("o1"))!.handoffState).toBe("accepted");
  });

  it("lookup is refused, without a call, for a carrier that cannot search by order number", async () => {
    await seedOrder({ id: "o1" });
    const reserved = await reserveCarrierShipment(d1.db, { orderId: "o1", companyId: "zr", deliveryType: "home", stationCode: null, weight: null, isFragile: null, createdBy: null });
    if (!reserved.ok) throw new Error("reservation failed");
    await markHandoffUnknown(d1.db, reserved.shipmentId, "timeout");
    const calls = vi.fn(realFetch);
    globalThis.fetch = calls as typeof fetch;
    const res = await resolve(reserved.shipmentId, { action: "lookup" });
    expect(res.status).toBe(422);
    expect(((await res.json()) as any).code).toBe("OPERATION_NOT_SUPPORTED");
    expect(calls).not.toHaveBeenCalled();
    const { data } = (await (await resolve(reserved.shipmentId, { action: "attach", trackingNumber: "ZR-123", carrierParcelId: "uuid-1" })).json()) as any;
    expect(data.shipment).toMatchObject({ trackingNumber: "ZR-123", carrierParcelId: "uuid-1" });
  });
});

describe("reading a shipment", () => {
  it("shows its history and what can be done now", async () => {
    await seedOrder({ id: "o1" });
    const { data: handed } = (await (await handOff("o1", { companyId: "eco-manual" })).json()) as any;
    const res = await app.request(`/api/shipments/${handed.shipment.id}`);
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as any;
    expect(data.events.map((e: any) => [e.source, e.providerStatus, e.interpretation])).toEqual([["handoff", "created", "progress"]]);
    expect(data.actions).toEqual(expect.arrayContaining(["validate", "update", "void", "label", "addRemark", "listRemarks", "sync"]));
    expect(data.actions).not.toContain("resolve");
    expect(JSON.stringify(data)).not.toContain(server.token);
    expect((await app.request("/api/shipments/nope")).status).toBe(404);
  });
});

describe("who may hand off", () => {
  it("reading orders is not enough", async () => {
    await seedOrder({ id: "o1" });
    scopes = ["orders:read", "orders:update"];
    expect((await handOff("o1")).status).toBe(403);
    expect((await bulk(["o1"])).status).toBe(403);
    expect(server.requests).toHaveLength(0);
  });
});
