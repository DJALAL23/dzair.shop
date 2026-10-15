/**
 * An order once it has a shipment, through the order routes on real D1: its
 * delivery is the shipment's, so the order shows it, and refuses what would
 * contradict the parcel — a status change, a new address, a driver, its own
 * deletion — while a closed shipment lets it go.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import type { AppContext } from "@/types";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import * as schema from "@/db/schema";
import { createEcotrackMockServer, type EcotrackMockServer } from "@/carriers/ecotrack/test/mock-server";
import { recordShipmentEvents } from "../../../../cod-shared/shipments/record-events";
import { jsonRequest, seedOrder, seedStore, shipmentsApp, T0 } from "./test/harness";

const dbModule = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/db", () => dbModule);

let d1: TestD1;
let app: OpenAPIHono<AppContext>;
let server: EcotrackMockServer;
let commune16: string;
const scopes = ["delivery:dispatch", "orders:read", "orders:update", "orders:delete", "orders:assign"];
const realFetch = globalThis.fetch;

beforeAll(async () => {
  d1 = await createTestD1();
  app = shipmentsApp(d1, () => scopes);
}, 120_000);

afterAll(async () => {
  await d1?.dispose();
});

beforeEach(async () => {
  dbModule.getDb.mockReturnValue(d1.db);
  server = createEcotrackMockServer();
  globalThis.fetch = ((url: string | URL, init?: RequestInit) => server.fetch(url, init)) as typeof fetch;
  commune16 = await seedStore(d1.db, server);
  await d1.db.insert(schema.drivers).values({ id: "dr1", firstName: "Amine", lastName: "B", phone: "0661111111", createdAt: T0, updatedAt: T0 });
  await seedOrder(d1.db, commune16, { id: "o1" });
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

const order = (method: string, path = "", body?: unknown) => jsonRequest(app, method, `/api/orders/o1${path}`, body);
const handOff = async () => {
  const { data } = (await (await order("POST", "/shipment", { kind: "carrier", companyId: "eco-manual" })).json()) as any;
  return data.shipment.id as string;
};
const codeOf = async (res: Response) => ((await res.json()) as any).code;

describe("the order shows its delivery", () => {
  it("before handoff: ready to ship, no shipment", async () => {
    const { data } = (await (await order("GET")).json()) as any;
    expect(data).toMatchObject({ status: "ready", shipment: null, stage: "ready_to_ship", needsAttention: false });
  });

  it("after handoff: the shipment with its history and actions, and the stage it gives the order", async () => {
    const id = await handOff();
    const { data } = (await (await order("GET")).json()) as any;
    expect(data).toMatchObject({ status: "ready", stage: "in_transit", needsAttention: false });
    expect(data.shipment).toMatchObject({ id, handoffState: "accepted", trackingNumber: "ECMOCK0000000001" });
    expect(data.shipment.events.map((e: any) => e.providerStatus)).toEqual(["created"]);
    expect(data.shipment.actions).toContain("validate");
  });

  it("an unknown handoff needs attention", async () => {
    server.override("/api/v1/create/order", () => new Response("{}", { status: 500 }));
    await order("POST", "/shipment", { kind: "carrier", companyId: "eco" });
    const { data } = (await (await order("GET")).json()) as any;
    expect(data).toMatchObject({ stage: "handoff_pending", needsAttention: true });
  });
});

describe("what an order with a shipment refuses", () => {
  beforeEach(async () => {
    await handOff();
  });

  it("a status change — cancelling included", async () => {
    const res = await order("PATCH", "/status", { status: "cancelled" });
    expect(res.status).toBe(409);
    expect(await codeOf(res)).toBe("ORDER_HAS_SHIPMENT");
    expect((await d1.db.select().from(schema.orders).where(eq(schema.orders.id, "o1")).get())!.status).toBe("ready");
  });

  it("a new phone or address — those are the parcel's; the notes still change", async () => {
    const res = await order("PATCH", "", { phone: "0661112233" });
    expect(res.status).toBe(409);
    expect(await codeOf(res)).toBe("ORDER_HAS_SHIPMENT");
    expect((await order("PATCH", "", { notes: "Client VIP" })).status).toBe(200);
  });

  it("a driver as well — one shipment per order", async () => {
    const res = await order("POST", "/shipment", { kind: "driver", driverId: "dr1" });
    expect(res.status).toBe(409);
    expect(await codeOf(res)).toBe("ORDER_HAS_SHIPMENT");
    expect(await d1.db.select().from(schema.shipments).where(eq(schema.shipments.orderId, "o1")).all()).toHaveLength(1);
  });

  it("its deletion while the parcel is out — and allows it once the shipment is closed", async () => {
    const res = await order("DELETE");
    expect(res.status).toBe(409);
    expect(await codeOf(res)).toBe("ORDER_HAS_SHIPMENT");

    const shipment = await d1.db.select().from(schema.shipments).where(eq(schema.shipments.orderId, "o1")).get();
    await recordShipmentEvents(d1.db, shipment!.id, [{ source: "webhook", status: { vocabulary: "activity", value: "livred" }, interpretation: { kind: "milestone", milestone: "delivered" }, occurredAt: new Date().toISOString() }]);
    expect((await order("DELETE")).status).toBe(200);
    expect(await d1.db.select().from(schema.orders).all()).toHaveLength(0);
  });
});

describe("voiding gives the order back", () => {
  it("once voided, the order can be edited, cancelled or handed off again", async () => {
    const id = await handOff();
    expect((await jsonRequest(app, "POST", `/api/shipments/${id}/void`)).status).toBe(200);
    expect((await order("PATCH", "", { phone: "0661112233" })).status).toBe(200);
    expect((await order("PATCH", "/status", { status: "cancelled" })).status).toBe(200);
  });
});
