/**
 * An order's delivery through MCP, on real D1 with the real adapters talking
 * to the EcoTrack double: the tools a grant sees follow the permission of
 * each shipment kind, they run the routes' own paths (the same answer as
 * `GET /orders/{id}`, the same refusals), act as the person who granted the
 * access, and every result matches the output schema the tool advertises.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import type { AppContext } from "@/types";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import * as schema from "@/db/schema";
import { createEcotrackMockServer, type EcotrackMockServer } from "@/carriers/ecotrack/test/mock-server";
import { buildToolsForUser } from "@/mcp/registry";
import { executeMcpTool } from "@/mcp/execute-tool";
import type { McpProps } from "@/mcp/props";
import { SCOPES } from "../../../../cod-shared/rbac/scopes";
import { seedOrder, seedStore, shipmentsApp, T0, type OrderSeed } from "./test/harness";

const dbModule = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/db", () => dbModule);

let d1: TestD1;
let app: OpenAPIHono<AppContext>;
let server: EcotrackMockServer;
let commune16: string;
const realFetch = globalThis.fetch;
const capi = { create: vi.fn() };

beforeAll(async () => {
  d1 = await createTestD1();
  app = shipmentsApp(d1, () => ["*"]);
}, 120_000);

afterAll(async () => {
  await d1?.dispose();
});

beforeEach(async () => {
  dbModule.getDb.mockReturnValue(d1.db);
  capi.create.mockReset().mockResolvedValue({});
  server = createEcotrackMockServer();
  globalThis.fetch = ((url: string | URL, init?: RequestInit) => server.fetch(url, init)) as typeof fetch;
  commune16 = await seedStore(d1.db, server);
  await d1.db.insert(schema.drivers).values([
    { id: "dr1", firstName: "Amine", lastName: "B", phone: "0661111111", createdAt: T0, updatedAt: T0 },
    { id: "dr-off", firstName: "Off", lastName: "Duty", phone: "0662222222", status: "inactive", createdAt: T0, updatedAt: T0 },
  ]);
  await d1.db.insert(schema.driverCompensations).values({ id: "comp1", driverId: "dr1", wilayaId: 16, feePerDelivery: 300, createdAt: T0, updatedAt: T0 });
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

const seed = (s: OrderSeed) => seedOrder(d1.db, commune16, s);
const grant = (scopes: string[], role: McpProps["role"] = "staff"): McpProps => ({ userId: "u-ada", role, scopes, name: "Ada", email: "ada@example.com" });
const visible = (props: McpProps) => Object.keys(buildToolsForUser({ DB: d1.raw, CAPI_WORKFLOW: capi } as never, props)).sort();

/** Calls the tool as an MCP client would; the result's structuredContent exists only when it matches the advertised output schema. */
async function call(props: McpProps, name: string, args: Record<string, unknown>) {
  const tool = buildToolsForUser({ DB: d1.raw, CAPI_WORKFLOW: capi } as never, props)[name];
  if (!tool) throw new Error(`${name} is not offered to this grant`);
  const result = await executeMcpTool({ db: d1.db, actor: { id: props.userId, name: props.name, role: props.role }, name, tool, args });
  expect(result.structuredContent, `${name}'s result matches its output schema`).toBeDefined();
  return { ...(result.structuredContent as any), isError: result.isError === true };
}

const dispatcher = grant([SCOPES.DELIVERY_DISPATCH, SCOPES.ORDERS_READ]);
const assigner = grant([SCOPES.ORDERS_ASSIGN, SCOPES.ORDERS_READ]);
const shipmentOf = (orderId: string) => d1.db.select().from(schema.shipments).where(eq(schema.shipments.orderId, orderId)).get();
const driver = () => d1.db.select().from(schema.drivers).where(eq(schema.drivers.id, "dr1")).get().then((d) => d!);

describe("which tools a grant sees", () => {
  it("a carrier's shipment is dispatch work, a driver's assignment work", () => {
    expect(visible(grant([SCOPES.DELIVERY_DISPATCH]))).toEqual(["handOffOrderToCarrier", "reportShipmentEvent"]);
    expect(visible(grant([SCOPES.ORDERS_ASSIGN]))).toEqual(["handOffOrderToDriver", "reportShipmentEvent"]);
    expect(visible(grant([SCOPES.DELIVERY_READ]))).toContain("listDeliveryCompanies");
  });
});

describe("handing an order to a carrier", () => {
  it("creates the parcel, as the person who granted the access", async () => {
    await seed({ id: "o1" });
    const out = await call(dispatcher, "handOffOrderToCarrier", { orderId: "o1", companyId: "eco" });
    expect(out).toMatchObject({ success: true, isError: false, handoff: { outcome: "accepted", orderNumber: "ORD-o1", shipment: { kind: "carrier", handoffState: "accepted" } } });
    expect(out.handoff.shipment.trackingNumber).toBeTruthy();
    expect(out.message).toContain(out.handoff.shipment.trackingNumber);
    expect(await shipmentOf("o1")).toMatchObject({ createdBy: "u-ada", companyId: "eco" });
    const [dispatched] = await d1.db.select().from(schema.activityLogs).where(eq(schema.activityLogs.action, "order.dispatched")).all();
    expect(dispatched).toMatchObject({ actorId: "u-ada", actorName: "Ada", entityId: "o1" });
  });

  it("an unknown outcome says never to hand it off again, and a second try is refused without calling the carrier", async () => {
    await seed({ id: "o1" });
    server.override("/api/v1/create/order", () => new Response("{}", { status: 500 }));
    const out = await call(dispatcher, "handOffOrderToCarrier", { orderId: "o1", companyId: "eco" });
    expect(out).toMatchObject({ success: true, handoff: { outcome: "unknown", shipment: { handoffState: "unknown" } } });
    expect(out.message).toMatch(/do not hand it off again/i);

    server.restore("/api/v1/create/order");
    const again = await call(dispatcher, "handOffOrderToCarrier", { orderId: "o1", companyId: "eco" });
    expect(again).toMatchObject({ success: false, isError: true });
    expect(again.error).toContain("has a shipment");
    expect(server.callsFor("/api/v1/create/order")).toHaveLength(1);
  });

  it("refuses an order not ready, and arguments that do not fit, with nothing sent", async () => {
    await seed({ id: "o1", status: "confirmed" });
    const notReady = await call(dispatcher, "handOffOrderToCarrier", { orderId: "o1", companyId: "eco" });
    expect(notReady).toMatchObject({ success: false, isError: true });
    expect(notReady.error).toContain("only a ready order");
    const bad = await call(dispatcher, "handOffOrderToCarrier", { orderId: "o1", companyId: "eco", weight: -1 });
    expect(bad.error).toMatch(/^Invalid arguments: weight/);
    expect(server.callsFor("/api/v1/create/order")).toHaveLength(0);
    expect(await shipmentOf("o1")).toBeUndefined();
  });
});

describe("giving an order to the store's driver", () => {
  it("is accepted at once with the wilaya's fee, as the granting person", async () => {
    await seed({ id: "o1", price: 2000, deliveryFee: 400 });
    const out = await call(assigner, "handOffOrderToDriver", { orderId: "o1", driverId: "dr1" });
    expect(out).toMatchObject({ success: true, handoff: { outcome: "accepted", shipment: { kind: "driver", driverId: "dr1", codAmount: 2400, driverFee: 300 } } });
    expect(await shipmentOf("o1")).toMatchObject({ createdBy: "u-ada" });
  });

  it("an admin grant holds every permission, as on the dashboard", async () => {
    await seed({ id: "o1" });
    expect(await call(grant([], "admin"), "handOffOrderToDriver", { orderId: "o1", driverId: "dr1" })).toMatchObject({ success: true });
  });

  it("refuses an inactive driver", async () => {
    await seed({ id: "o1" });
    const out = await call(assigner, "handOffOrderToDriver", { orderId: "o1", driverId: "dr-off" });
    expect(out).toMatchObject({ success: false, isError: true });
    expect(out.error).toContain("inactive");
    expect(await shipmentOf("o1")).toBeUndefined();
  });
});

describe("reporting what happened", () => {
  it("a driver's delivery: the milestone, the driver's cash, the conversion — once; the closed shipment takes no more reports", async () => {
    await seed({ id: "o1", price: 2000, deliveryFee: 400 });
    const { handoff } = await call(assigner, "handOffOrderToDriver", { orderId: "o1", driverId: "dr1" });
    const at = new Date().toISOString();
    const first = await call(assigner, "reportShipmentEvent", { shipmentId: handoff.shipment.id, status: "out_for_delivery", occurredAt: at });
    expect(first, first.error).toMatchObject({ recorded: 1 });
    const same = await call(assigner, "reportShipmentEvent", { shipmentId: handoff.shipment.id, status: "out_for_delivery", occurredAt: at });
    expect(same).toMatchObject({ success: true, recorded: 0, duplicates: 1, reached: [] });
    expect(same.message).toMatch(/^Already recorded/);

    const delivered = await call(assigner, "reportShipmentEvent", { shipmentId: handoff.shipment.id, status: "delivered" });
    expect(delivered).toMatchObject({ success: true, recorded: 1, duplicates: 0, reached: ["delivered"], shipment: { deliveredAt: expect.any(String) } });
    expect((await driver()).pendingCash).toBe(2400);
    expect(capi.create).toHaveBeenCalledTimes(1);
    expect(capi.create.mock.calls[0][0].params).toMatchObject({ orderId: "o1" });

    const again = await call(assigner, "reportShipmentEvent", { shipmentId: handoff.shipment.id, status: "delivered" });
    expect(again).toMatchObject({ success: false, isError: true });
    expect(again.error).toContain("closed");
    expect((await driver()).pendingCash).toBe(2400);
    expect(capi.create).toHaveBeenCalledTimes(1);
  });

  it("on a driver's shipment it takes the assignment permission, even when the tool is offered for dispatch", async () => {
    await seed({ id: "o1" });
    const { handoff } = await call(assigner, "handOffOrderToDriver", { orderId: "o1", driverId: "dr1" });
    const out = await call(dispatcher, "reportShipmentEvent", { shipmentId: handoff.shipment.id, status: "delivered" });
    expect(out).toMatchObject({ success: false, isError: true });
    expect(out.error).toContain(SCOPES.ORDERS_ASSIGN);
    expect((await shipmentOf("o1"))!.deliveredAt).toBeNull();
  });

  it("on a carrier's shipment, only that the goods came back — the carrier alone says it was delivered", async () => {
    await seed({ id: "o1" });
    const { handoff } = await call(dispatcher, "handOffOrderToCarrier", { orderId: "o1", companyId: "eco" });
    const refused = await call(dispatcher, "reportShipmentEvent", { shipmentId: handoff.shipment.id, status: "delivered" });
    expect(refused).toMatchObject({ success: false });
    expect(refused.error).toContain("Only the carrier");
    expect(await call(dispatcher, "reportShipmentEvent", { shipmentId: handoff.shipment.id, status: "returned", reason: "Refused at the door" })).toMatchObject({ success: true, reached: ["returned"] });
  });
});

describe("reading an order's delivery", () => {
  it("the order's details are the route's, its shipment and stage included; the shipment carries its history", async () => {
    const id = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
    await seed({ id });
    const { handoff } = await call(assigner, "handOffOrderToDriver", { orderId: id, driverId: "dr1" });
    await call(assigner, "reportShipmentEvent", { shipmentId: handoff.shipment.id, status: "out_for_delivery" });

    const route = ((await (await app.request(`/api/orders/${id}`)).json()) as any).data;
    expect(route).toMatchObject({ stage: "out_for_delivery", needsAttention: false, shipment: { id: handoff.shipment.id } });
    expect((await call(assigner, "getOrderDetails", { orderId: id })).order).toEqual(route);

    const shipment = await call(assigner, "getShipment", { shipmentId: handoff.shipment.id });
    expect(shipment.shipment).toEqual(route.shipment);
    expect(shipment.shipment.events.map((e: any) => e.providerStatus)).toEqual(["assigned_to_driver", "out_for_delivery"]);
  });

  it("the delivery companies an agent may pick from carry no credential", async () => {
    const out = await call(grant([SCOPES.DELIVERY_READ]), "listDeliveryCompanies", { active: true });
    expect(out.companies.map((c: any) => c.id)).toContain("eco");
    expect(out.companies.find((c: any) => c.id === "unconnected")).toMatchObject({ isConnected: false });
    expect(out.companies.some((c: any) => c.id === "off")).toBe(false);
    const text = JSON.stringify(out);
    for (const secret of [server.token, "yal-token", "yal-id", "zr-key", "tenant", "noest-token", "noest-guid"]) expect(text).not.toContain(secret);
  });
});
