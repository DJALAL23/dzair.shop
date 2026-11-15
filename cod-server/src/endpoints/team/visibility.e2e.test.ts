/**
 * A team member who sees only their own orders, on real D1: every order and
 * shipment route that names an order — walked from the routers themselves, so
 * a route added later is held to it too — answers 404 for another member's
 * order and changes nothing; the lists, the counts, a customer's history and
 * the AI tools hold only theirs. They hold every other permission, so only
 * this rule stands between them and the order.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { eq, inArray, sql } from "drizzle-orm";
import type { AppContext, AuthUser } from "@/types";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import { apiAs, staff } from "@/test-utils/api";
import * as schema from "@/db/schema";
import { ALL_SCOPES, SCOPES } from "../../../../cod-shared/rbac/scopes";
import ordersRouter from "../orders/routes";
import shipmentsRouter from "../shipments/routes";
import customersRouter from "../customers/routes";
import analyticsRouter from "../analytics/routes";
import teamRouter from "./routes";
import { getOrderTools } from "../orders/ai-tools";
import { getShipmentTools } from "../shipments/ai-tools";
import type { McpProps } from "@/mcp/props";

let d1: TestD1;
const T = "2026-11-14T08:00:00.000Z";
const AGENT: AuthUser = { ...staff(ALL_SCOPES.filter((scope) => scope !== SCOPES.ORDERS_READ)), id: "u-agent", name: "Samira" };
const ROUTERS: Record<string, OpenAPIHono<AppContext>> = { "/api/orders": ordersRouter, "/api/shipments": shipmentsRouter, "/api/customers": customersRouter, "/api/analytics": analyticsRouter, "/api/team": teamRouter };
const agent = () => apiAs(d1, AGENT, ROUTERS);

beforeAll(async () => {
  d1 = await createTestD1();
}, 120_000);
afterAll(async () => d1?.dispose());

const order = (id: string, assigneeId: string | null, status: "new" | "ready" = "new") => ({
  id, orderNumber: `N-${id}`, customerId: "c1", customerName: "Amel", phone: "0551234567", wilayaId: 16, communeId: "c-16-001", address: "Rue 1", price: 3000, deliveryFee: 600, codAmount: 3600, status, assigneeId, assignedAt: assigneeId ? T : null, createdAt: T, updatedAt: T,
});

beforeEach(async () => {
  for (const table of ["business_events", "activity_logs", "order_products", "shipments", "orders", "drivers", "customers", "team_agents", "users"]) await d1.db.run(sql.raw(`DELETE FROM ${table}`));
  await d1.db.insert(schema.users).values([
    { id: "u-agent", name: "Samira", email: "samira@shop.dz", role: "staff", status: "active" },
    { id: "u-other", name: "Karim", email: "karim@shop.dz", role: "staff", status: "active" },
  ]);
  await d1.db.insert(schema.customers).values({ id: "c1", name: "Amel", phone: "0551234567", wilaya: "Alger", createdAt: T });
  await d1.db.insert(schema.orders).values([order("o-mine", "u-agent"), order("o-theirs", "u-other", "ready"), order("o-nobody", null)]);
  await d1.db.insert(schema.orderProducts).values({ id: "l-theirs", orderId: "o-theirs", productName: "Sac", quantity: 1, pricePerUnit: 3000, lineTotal: 3000, createdAt: T });
  await d1.db.insert(schema.drivers).values({ id: "d1", firstName: "Ali", lastName: "B", phone: "0661000000", createdAt: T, updatedAt: T } as never);
  await d1.db.insert(schema.shipments).values({ id: "s-theirs", orderId: "o-theirs", kind: "driver", driverId: "d1", handoffState: "accepted", deliveryType: "home", codAmount: 3600, revision: "r1", createdAt: T, updatedAt: T });
  await d1.db.insert(schema.teamAgents).values({ userId: "u-agent", receiving: true, createdAt: T, updatedAt: T });
});

const snapshot = async () => ({
  orders: await d1.db.select().from(schema.orders).orderBy(schema.orders.id).all(),
  lines: await d1.db.select().from(schema.orderProducts).all(),
  shipments: await d1.db.select().from(schema.shipments).all(),
  events: await d1.db.select({ seq: schema.businessEvents.seq }).from(schema.businessEvents).all(),
});

/** Every route of a router that names an order or a shipment, as Hono registered it. */
function idRoutes(base: string, router: OpenAPIHono<AppContext>) {
  return router.routes
    .filter((route) => route.method !== "ALL" && route.path.includes(":id"))
    .map((route) => ({ method: route.method, path: `${base}${route.path}` }))
    .filter((route, i, all) => all.findIndex((r) => r.method === route.method && r.path === route.path) === i);
}

const ROUTES = [...idRoutes("/api/orders", ordersRouter), ...idRoutes("/api/shipments", shipmentsRouter)];

describe("another member's order, on every route that names one", () => {
  it("walks a real set of routes", () => {
    expect(ROUTES.length).toBeGreaterThan(20);
  });

  it.each(ROUTES.map((route) => [`${route.method} ${route.path}`, route] as const))("%s answers 404 and changes nothing", async (_, route) => {
    const before = await snapshot();
    const path = route.path.replace(":id", route.path.startsWith("/api/shipments") ? "s-theirs" : "o-theirs").replace(":productLineId", "l-theirs");
    const api = agent();
    const answer = route.method === "GET" ? await api.get(path) : route.method === "DELETE" ? await api.delete(path) : await { POST: api.post, PUT: api.put, PATCH: api.patch }[route.method as "POST"](path, {});
    expect(answer.status, JSON.stringify(answer.body)).toBe(404);
    expect(await snapshot()).toEqual(before);
  });
});

describe("what a member who sees only their own orders is shown", () => {
  it("their own order, in full", async () => {
    const answer = await agent().get("/api/orders/o-mine");
    expect(answer.status).toBe(200);
    expect(answer.body.data).toMatchObject({ id: "o-mine", assigneeId: "u-agent", assigneeName: "Samira" });
  });

  it("only their orders in the list, whatever assignee they ask for", async () => {
    for (const query of ["", "?assignee=u-other", "?assignee=none"]) {
      const answer = await agent().get(`/api/orders${query}`);
      expect(answer.body.data.map((o: { id: string }) => o.id)).toEqual(["o-mine"]);
    }
  });

  it("only their orders in the counts and in a customer's history", async () => {
    const counts = await agent().get("/api/analytics/order-stages");
    expect(counts.body.data.stages).toEqual([{ stage: "new", count: 1 }]);
    expect(counts.body.data).toMatchObject({ callbacks: 0, callbacksDue: 0 });
    const history = await agent().get("/api/customers/c1/orders");
    expect(history.body.data.map((o: { id: string }) => o.id)).toEqual(["o-mine"]);
  });

  it("only their callbacks, and of those the ones whose time has come; every member's to someone who sees every order", async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const later = new Date(Date.now() + 3_600_000).toISOString();
    await d1.db.insert(schema.orders).values(order("o-mine-later", "u-agent"));
    await d1.db.insert(schema.orders).values({ ...order("o-mine-archived", "u-agent"), archivedAt: T });
    await d1.db.insert(schema.orders).values({ ...order("o-mine-ready", "u-agent", "ready"), callbackAt: past });
    await d1.db.update(schema.orders).set({ callbackAt: past }).where(inArray(schema.orders.id, ["o-mine", "o-mine-archived", "o-nobody"]));
    await d1.db.update(schema.orders).set({ callbackAt: later }).where(eq(schema.orders.id, "o-mine-later"));
    expect((await agent().get("/api/analytics/order-stages")).body.data).toMatchObject({ callbacks: 2, callbacksDue: 1 });
    const everyone = apiAs(d1, { ...staff([SCOPES.ORDERS_READ]), id: "u-owner", name: "Bilal" } as AuthUser, ROUTERS);
    expect((await everyone.get("/api/analytics/order-stages")).body.data).toMatchObject({ callbacks: 3, callbacksDue: 2 });
  });

  it("no handoff, assignment or bulk work that names another's order", async () => {
    const before = await snapshot();
    expect((await agent().post("/api/shipments/driver-bulk", { driverId: "d1", orderIds: ["o-mine", "o-theirs"] })).status).toBe(404);
    expect((await agent().post("/api/shipments/bulk", { companyId: "x", orderIds: ["o-theirs"] })).status).toBe(404);
    expect((await agent().post("/api/orders/assign", { orderIds: ["o-theirs"], to: "u-agent" })).status).toBe(404);
    expect(await snapshot()).toEqual(before);
  });

  it("every order to a member who sees every order", async () => {
    const manager = apiAs(d1, { ...staff([SCOPES.ORDERS_READ]), id: "u-manager" }, ROUTERS);
    expect((await manager.get("/api/orders/o-theirs")).status).toBe(200);
    expect((await manager.get("/api/orders")).body.data.map((o: { id: string }) => o.id).sort()).toEqual(["o-mine", "o-nobody", "o-theirs"]);
  });
});

describe("the AI tools of a member who sees only their own orders", () => {
  const props = { userId: "u-agent", name: "Samira", email: "samira@shop.dz", role: "staff", scopes: AGENT.scopes } as unknown as McpProps;
  const tools = () => ({ ...getOrderTools(d1.db, props), ...getShipmentTools(d1.db, { DB: d1.raw } as never, props) });
  const run = (name: string, args: Record<string, unknown>) => (tools() as unknown as Record<string, { execute: (a: unknown, o: unknown) => Promise<any> }>)[name]!.execute(args, {});

  it("list only their orders", async () => {
    expect((await run("listOrders", {})).orders.map((o: { id: string }) => o.id)).toEqual(["o-mine"]);
  });

  it("find no other order or shipment, for any tool that names one, and change nothing", async () => {
    const before = await snapshot();
    const names = Object.keys(tools()).filter((name) => !["listOrders", "createOrder"].includes(name));
    expect(names.length).toBeGreaterThan(5);
    for (const name of names) {
      const answer = await run(name, { orderId: "o-theirs", shipmentId: "s-theirs", status: "confirmed", productLineId: "l-theirs", returnedQuantity: 1, companyId: "x", driverId: "d1" });
      expect(answer, name).toMatchObject({ success: false });
      expect(String(answer.error), name).toMatch(/not found/i);
    }
    expect(await snapshot()).toEqual(before);
  });

  it("still work their own order", async () => {
    expect(await run("getOrderDetails", { orderId: "o-mine" })).toMatchObject({ success: true, order: { id: "o-mine" } });
    expect(await run("updateOrderStatus", { orderId: "o-mine", status: "confirmed" })).toMatchObject({ success: true });
    expect((await d1.db.select().from(schema.orders).where(eq(schema.orders.id, "o-mine")).get())).toMatchObject({ status: "confirmed", confirmedBy: "u-agent" });
  });
});
