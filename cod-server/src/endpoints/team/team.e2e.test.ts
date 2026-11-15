/**
 * The confirmation team's API on real D1: members and who is receiving, the
 * store's rule, a customer's callback, each member's results, and pay with
 * the month's payroll — each rate at the day it applied, store days in
 * Algeria, and what has no rate named, never counted as zero. Pay needs the
 * finance permission.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { eq, sql } from "drizzle-orm";
import type { AppContext, AuthUser } from "@/types";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import { apiAs, staff } from "@/test-utils/api";
import * as schema from "@/db/schema";
import { SCOPES } from "../../../../cod-shared/rbac/scopes";
import ordersRouter from "../orders/routes";
import teamRouter from "./routes";

let d1: TestD1;
const T = "2026-11-14T08:00:00.000Z";
const ROUTERS: Record<string, OpenAPIHono<AppContext>> = { "/api/orders": ordersRouter, "/api/team": teamRouter };
const MANAGER: AuthUser = { ...staff([SCOPES.TEAM_READ, SCOPES.TEAM_MANAGE, SCOPES.FINANCE_READ, SCOPES.FINANCE_MANAGE, SCOPES.ORDERS_READ, SCOPES.ORDERS_UPDATE]), id: "u-owner", name: "Bilal" };
const manager = () => apiAs(d1, MANAGER, ROUTERS);
const as = (id: string, scopes: string[]) => apiAs(d1, { ...staff(scopes), id, name: id } as AuthUser, ROUTERS);

beforeAll(async () => {
  d1 = await createTestD1();
}, 120_000);
afterAll(async () => d1?.dispose());

let n = 0;
const order = (fields: Partial<typeof schema.orders.$inferInsert> = {}) => {
  const id = fields.id ?? `o-${++n}`;
  return { id, orderNumber: `N-${id}`, customerId: "c1", customerName: "Amel", phone: "0551234567", wilayaId: 16, communeId: "c-16-001", address: "Rue 1", price: 3000, deliveryFee: 600, codAmount: 3600, status: "new" as const, createdAt: T, updatedAt: T, ...fields };
};
const insertOrders = async (rows: ReturnType<typeof order>[]) => {
  for (const row of rows) await d1.db.insert(schema.orders).values(row);
};

beforeEach(async () => {
  for (const table of ["business_events", "activity_logs", "shipments", "orders", "drivers", "customers", "team_pay", "team_agents", "team_memberships", "store_team_config", "user_scopes", "users", "stores"]) await d1.db.run(sql.raw(`DELETE FROM ${table}`));
  await d1.db.insert(schema.stores).values({ id: "store-team", name: "Boutique", lang: "ar", createdAt: T, updatedAt: T });
  await d1.db.insert(schema.users).values([
    { id: "u-samira", name: "Samira", email: "samira@shop.dz", role: "staff", status: "active" },
    { id: "u-karim", name: "Karim", email: "karim@shop.dz", role: "staff", status: "active" },
    { id: "u-amina", name: "Amina", email: "amina@shop.dz", role: "staff", status: "active" },
    { id: "u-owner", name: "Bilal", email: "bilal@shop.dz", role: "admin", status: "active" },
  ]);
  await d1.db.insert(schema.userScopes).values([
    { id: "s1", userId: "u-samira", scope: SCOPES.ORDERS_READ_ASSIGNED, grantedAt: T },
    { id: "s2", userId: "u-karim", scope: SCOPES.ORDERS_READ, grantedAt: T },
  ]);
  await d1.db.insert(schema.customers).values({ id: "c1", name: "Amel", phone: "0551234567", wilaya: "Alger", createdAt: T });
  await d1.db.insert(schema.drivers).values({ id: "d1", firstName: "Ali", lastName: "B", phone: "0661000000", createdAt: T, updatedAt: T } as never);
});

const assigneeOf = async (id: string) => (await d1.db.select({ a: schema.orders.assigneeId }).from(schema.orders).where(eq(schema.orders.id, id)).get())!.a;

describe("the team's members", () => {
  it("are added, listed with which orders their permissions reach, and refused twice or unknown", async () => {
    expect((await manager().post("/api/team/members", { userId: "u-samira" })).status).toBe(201);
    expect((await manager().post("/api/team/members", { userId: "u-karim", receiving: false })).status).toBe(201);
    expect((await manager().post("/api/team/members", { userId: "u-amina", receiving: false })).status).toBe(201);
    expect((await manager().post("/api/team/members", { userId: "u-samira" })).body).toMatchObject({ code: "ALREADY_TEAM_MEMBER" });
    expect((await manager().post("/api/team/members", { userId: "u-nobody" })).status).toBe(404);
    const { body } = await manager().get("/api/team/members");
    expect(body.data.members.map((m: { name: string; receiving: boolean; reach: string }) => [m.name, m.receiving, m.reach])).toEqual([
      ["Amina", false, "none"],
      ["Karim", false, "all"],
      ["Samira", true, "own"],
    ]);
  });

  it("start receiving and get the orders that waited for someone; when taken off the team, their waiting orders go to the others", async () => {
    await d1.db.insert(schema.storeTeamConfig).values({ id: "cfg", storeId: "store-team", distribution: "in_turn", createdAt: T, updatedAt: T });
    await manager().post("/api/team/members", { userId: "u-samira", receiving: false });
    await manager().post("/api/team/members", { userId: "u-karim", receiving: false });
    await insertOrders([order({ id: "o-waiting" }), order({ id: "o-decided", status: "unreachable" })]);
    expect((await manager().patch("/api/team/members/u-samira", { receiving: true })).body.data).toMatchObject({ receiving: true, waiting: 1 });
    expect([await assigneeOf("o-waiting"), await assigneeOf("o-decided")]).toEqual(["u-samira", null]);

    expect((await manager().delete("/api/team/members/u-samira")).status).toBe(200);
    expect(await assigneeOf("o-waiting")).toBe("u-samira");
    expect((await manager().get("/api/team/members")).body.data).toMatchObject({ unassigned: 0, withFormerMembers: 1 });
    await manager().patch("/api/team/members/u-karim", { receiving: true });
    expect(await assigneeOf("o-waiting")).toBe("u-karim");
    expect((await manager().get("/api/team/members")).body.data).toMatchObject({ withFormerMembers: 0 });
    expect((await manager().patch("/api/team/members/u-samira", { receiving: true })).body).toMatchObject({ code: "NOT_TEAM_MEMBER" });
  });

  it("taken off the team while others receive, have their waiting orders given out at once", async () => {
    await d1.db.insert(schema.storeTeamConfig).values({ id: "cfg", storeId: "store-team", distribution: "in_turn", createdAt: T, updatedAt: T });
    await manager().post("/api/team/members", { userId: "u-samira" });
    await insertOrders([order({ id: "o-waiting", assigneeId: "u-samira", assignedAt: T })]);
    await manager().post("/api/team/members", { userId: "u-karim" });
    await manager().delete("/api/team/members/u-samira");
    expect(await assigneeOf("o-waiting")).toBe("u-karim");
  });

  it("count only the orders still waiting with them, an archived one left out", async () => {
    await manager().post("/api/team/members", { userId: "u-samira", receiving: false });
    await insertOrders([
      order({ id: "w-1", assigneeId: "u-samira", assignedAt: T, callbackAt: T }),
      order({ id: "w-archived", assigneeId: "u-samira", assignedAt: T, callbackAt: T, archivedAt: T }),
      order({ id: "w-done", assigneeId: "u-samira", assignedAt: T, status: "ready" }),
    ]);
    expect((await manager().get("/api/team/members")).body.data.members[0]).toMatchObject({ userId: "u-samira", waiting: 1, callbacks: 1 });
  });

  it("are given orders only while on the team, and only once they can see orders", async () => {
    await insertOrders([order({ id: "o-1" })]);
    expect((await manager().post("/api/orders/assign", { orderIds: ["o-1"], to: "u-amina" })).body).toMatchObject({ code: "NOT_TEAM_MEMBER" });
    await manager().post("/api/team/members", { userId: "u-amina", receiving: false });
    const refused = await manager().post("/api/orders/assign", { orderIds: ["o-1"], to: "u-amina" });
    expect(refused.status).toBe(422);
    expect(refused.body).toMatchObject({ code: "NO_ORDER_ACCESS" });
    expect((await d1.db.select({ assigneeId: schema.orders.assigneeId }).from(schema.orders).get())!.assigneeId).toBeNull();
    await d1.db.insert(schema.userScopes).values({ id: "s-own", userId: "u-amina", scope: SCOPES.ORDERS_READ_ASSIGNED, grantedAt: T });
    expect((await manager().post("/api/orders/assign", { orderIds: ["o-1"], to: "u-amina" })).body.data).toEqual([{ orderId: "o-1", ok: true, changed: true }]);
  });

  it("are picked from the store's active people not on the team, each with which orders they can work", async () => {
    await d1.db.insert(schema.users).values({ id: "u-gone", name: "Yacine", email: "yacine@shop.dz", role: "staff", status: "inactive" });
    await d1.db.insert(schema.userScopes).values({ id: "s3", userId: "u-amina", scope: SCOPES.ALL, grantedAt: T });
    await manager().post("/api/team/members", { userId: "u-karim", receiving: false });
    const { body } = await manager().get("/api/team/candidates");
    expect(body.data).toEqual([
      { userId: "u-amina", name: "Amina", email: "amina@shop.dz", role: "staff", reach: "all" },
      { userId: "u-owner", name: "Bilal", email: "bilal@shop.dz", role: "admin", reach: "all" },
      { userId: "u-samira", name: "Samira", email: "samira@shop.dz", role: "staff", reach: "own" },
    ]);
    expect((await as("u-karim", [SCOPES.TEAM_READ]).get("/api/team/candidates")).status).toBe(403);
  });

  it("start and stop their own shift; someone not on the team cannot", async () => {
    await manager().post("/api/team/members", { userId: "u-samira", receiving: false });
    const samira = as("u-samira", [SCOPES.ORDERS_READ_ASSIGNED]);
    expect((await samira.get("/api/team/me")).body.data).toEqual({ member: true, receiving: false });
    expect((await samira.put("/api/team/me/receiving", { receiving: true })).body.data).toEqual({ member: true, receiving: true });
    expect((await as("u-amina", []).put("/api/team/me/receiving", { receiving: true })).body).toMatchObject({ code: "NOT_TEAM_MEMBER" });
  });

  it("are managed only with the team permission", async () => {
    const reader = as("u-karim", [SCOPES.TEAM_READ]);
    expect((await reader.get("/api/team/members")).status).toBe(200);
    expect((await reader.post("/api/team/members", { userId: "u-amina" })).status).toBe(403);
    expect((await reader.put("/api/team/settings", { distribution: "evenly", takeBackMinutes: null, takeBackLimit: 2 })).status).toBe(403);
    expect((await reader.post("/api/orders/assign", { orderIds: ["o-x"], to: null })).status).toBe(403);
  });
});

describe("the store's rule", () => {
  it("is by hand until changed, and turning a rule on shares out the orders that waited", async () => {
    expect((await manager().get("/api/team/settings")).body.data).toEqual({ distribution: "manual", takeBackMinutes: null, takeBackLimit: 2 });
    await manager().post("/api/team/members", { userId: "u-samira" });
    await d1.db.insert(schema.orders).values(order({ id: "o-waiting" }));
    expect(await assigneeOf("o-waiting")).toBeNull();
    const changed = await manager().put("/api/team/settings", { distribution: "evenly", takeBackMinutes: 15, takeBackLimit: 3 });
    expect(changed.body.data).toEqual({ distribution: "evenly", takeBackMinutes: 15, takeBackLimit: 3 });
    expect(await assigneeOf("o-waiting")).toBe("u-samira");
    expect((await manager().put("/api/team/settings", { distribution: "evenly", takeBackMinutes: 2, takeBackLimit: 3 })).status).toBe(400);
  });
});

describe("the team's queues in the orders list", () => {
  it("list exactly the orders the overview counts: with nobody, waiting for a manager, with someone who left", async () => {
    await d1.db.insert(schema.storeTeamConfig).values({ id: "cfg", storeId: "store-team", distribution: "manual", takeBackMinutes: 15, takeBackLimit: 2, createdAt: T, updatedAt: T });
    await manager().post("/api/team/members", { userId: "u-karim", receiving: false });
    await insertOrders([
      order({ id: "q-nobody" }),
      order({ id: "q-nobody-unreachable", status: "unreachable" }),
      order({ id: "q-stuck", assigneeId: "u-karim", assignedAt: T, takeBacks: 2 }),
      order({ id: "q-moving", assigneeId: "u-karim", assignedAt: T, takeBacks: 1 }),
      order({ id: "q-left", assigneeId: "u-samira", assignedAt: T, status: "unreachable" }),
      order({ id: "q-left-done", assigneeId: "u-samira", assignedAt: T, status: "ready" }),
      order({ id: "q-archived", archivedAt: T }),
    ]);
    const list = async (team: string) => (await manager().get(`/api/orders?team=${team}`)).body.data.map((o: { id: string }) => o.id);
    expect(await list("unassigned")).toEqual(["q-nobody"]);
    expect(await list("needs_manager")).toEqual(["q-stuck"]);
    expect(await list("former")).toEqual(["q-left"]);
    expect((await manager().get("/api/team/members")).body.data).toMatchObject({ unassigned: 1, needsManager: 1, withFormerMembers: 1 });
    expect((await manager().get("/api/orders?team=unassigned&archived=include")).body.data.map((o: { id: string }) => o.id)).toEqual(["q-nobody"]);
    expect((await manager().get("/api/orders?team=everyone")).status).toBe(400);

    await d1.db.update(schema.storeTeamConfig).set({ takeBackMinutes: null });
    expect(await list("needs_manager")).toEqual([]);
    expect((await manager().get("/api/team/members")).body.data).toMatchObject({ needsManager: 0 });
  });
});

describe("sharing out now", () => {
  it("gives out the orders nobody is working by the store's rule, and only for a manager", async () => {
    await manager().post("/api/team/members", { userId: "u-karim", receiving: true });
    await insertOrders([order({ id: "s-nobody" }), order({ id: "s-left", assigneeId: "u-amina", assignedAt: T })]);
    expect((await manager().post("/api/team/share-out", {})).body.data).toEqual({ shared: 0 });
    expect(await assigneeOf("s-nobody")).toBeNull();

    await d1.db.insert(schema.storeTeamConfig).values({ id: "cfg", storeId: "store-team", distribution: "in_turn", createdAt: T, updatedAt: T });
    expect((await as("u-karim", [SCOPES.TEAM_READ]).post("/api/team/share-out", {})).status).toBe(403);
    expect((await manager().post("/api/team/share-out", {})).body.data).toEqual({ shared: 2 });
    expect([await assigneeOf("s-nobody"), await assigneeOf("s-left")]).toEqual(["u-karim", "u-karim"]);
  });
});

describe("a customer's callback", () => {
  it("is set and cleared on an order still waiting, and refused once it was confirmed", async () => {
    await insertOrders([order({ id: "o-new" }), order({ id: "o-done", status: "confirmed" })]);
    expect((await manager().put("/api/orders/o-new/callback", { at: "2026-11-14T15:00:00+01:00" })).body.data).toEqual({ callbackAt: "2026-11-14T14:00:00.000Z" });
    expect((await manager().get("/api/orders?callback=set")).body.data.map((o: { id: string }) => o.id)).toEqual(["o-new"]);
    expect((await manager().put("/api/orders/o-new/callback", { at: null })).body.data).toEqual({ callbackAt: null });
    expect((await manager().put("/api/orders/o-done/callback", { at: "2026-11-14T15:00:00+01:00" })).body).toMatchObject({ code: "ORDER_NOT_WAITING" });
  });

  it("lists the customers to call back soonest first, page after page", async () => {
    const at = (hour: number) => `2026-11-15T${String(hour).padStart(2, "0")}:00:00.000Z`;
    await insertOrders([
      order({ id: "cb-a", callbackAt: at(14), createdAt: "2026-11-14T07:00:00.000Z" }),
      order({ id: "cb-b", callbackAt: at(9), createdAt: "2026-11-14T06:00:00.000Z" }),
      order({ id: "cb-c", callbackAt: at(9), createdAt: "2026-11-14T09:00:00.000Z" }),
      order({ id: "cb-d", callbackAt: at(11), createdAt: "2026-11-14T05:00:00.000Z", status: "unreachable" }),
      order({ id: "cb-e", callbackAt: at(16), createdAt: "2026-11-14T08:00:00.000Z" }),
      order({ id: "cb-done", callbackAt: at(8), status: "ready" }),
    ]);
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: { body: { data: Array<{ id: string }>; nextCursor: string | null } } = await manager().get(`/api/orders?callback=set&limit=2${cursor ? `&cursor=${cursor}` : ""}`);
      seen.push(...page.body.data.map((o) => o.id));
      cursor = page.body.nextCursor;
    } while (cursor);
    expect(seen).toEqual(["cb-b", "cb-c", "cb-d", "cb-a", "cb-e"]);
  });
});

describe("each member's results", () => {
  it("count the orders placed in the period that are with them now, and leave orders still waiting out of the rate", async () => {
    const at = "2026-11-10T09:00:00.000Z";
    await insertOrders([
      order({ id: "r-conf", assigneeId: "u-samira", assignedAt: at, createdAt: at, status: "ready", decidedAt: "2026-11-10T09:10:00.000Z", decidedBy: "u-samira", confirmedAt: "2026-11-10T09:10:00.000Z", confirmedBy: "u-samira" }),
      order({ id: "r-deliv", assigneeId: "u-samira", assignedAt: at, createdAt: at, status: "ready", decidedAt: "2026-11-10T09:30:00.000Z", decidedBy: "u-samira", confirmedAt: "2026-11-10T09:30:00.000Z", confirmedBy: "u-samira" }),
      order({ id: "r-back", assigneeId: "u-samira", assignedAt: at, createdAt: at, status: "ready", confirmedAt: "2026-11-10T10:00:00.000Z", confirmedBy: "u-karim", decidedAt: "2026-11-10T10:00:00.000Z", decidedBy: "u-karim" }),
      order({ id: "r-cancel", assigneeId: "u-samira", assignedAt: at, createdAt: at, status: "cancelled", decidedAt: "2026-11-10T09:20:00.000Z", decidedBy: "u-samira", unansweredCalls: 3 }),
      order({ id: "r-wait", assigneeId: "u-samira", assignedAt: at, createdAt: at }),
      order({ id: "r-before", assigneeId: "u-samira", assignedAt: at, createdAt: "2026-10-31T22:59:00.000Z", status: "cancelled" }),
      order({ id: "r-first-minute", assigneeId: "u-karim", assignedAt: at, createdAt: "2026-10-31T23:00:00.000Z" }),
    ]);
    await d1.db.insert(schema.shipments).values([
      { id: "s-deliv", orderId: "r-deliv", kind: "driver", driverId: "d1", handoffState: "accepted", deliveryType: "home", codAmount: 3600, revision: "r", deliveredAt: "2026-11-12T10:00:00.000Z", createdAt: T, updatedAt: T },
      { id: "s-back", orderId: "r-back", kind: "driver", driverId: "d1", handoffState: "accepted", deliveryType: "home", codAmount: 3600, revision: "r", returnedAt: "2026-11-13T10:00:00.000Z", createdAt: T, updatedAt: T },
    ]);
    const { body } = await manager().get("/api/team/results?from=2026-11-01&to=2026-11-30");
    const byMember = Object.fromEntries(body.data.map((row: { userId: string }) => [row.userId, row]));
    expect(byMember["u-samira"]).toEqual({
      userId: "u-samira", name: "Samira", assigned: 5, waiting: 1, confirmed: 3, cancelled: 1, delivered: 1, returned: 1,
      confirmationRate: 75, deliveryRate: 50, minutesToDecide: 20, cancelledAfterNoAnswer: 1, noAnswerCallsBeforeCancel: 3,
    });
    expect(byMember["u-karim"]).toMatchObject({ assigned: 1, waiting: 1, confirmationRate: null, deliveryRate: null, minutesToDecide: null });
    expect((await manager().get("/api/team/results?from=2026-11-30&to=2026-11-01")).status).toBe(400);
  });
});

describe("pay and the month's payroll", () => {
  const pay = (userId: string, kind: string, amount: number, validFrom: string) => manager().post(`/api/team/members/${userId}/pay`, { kind, amount, validFrom });
  const confirmed = (id: string, by: string, at: string) => order({ id, status: "ready", confirmedAt: at, confirmedBy: by, decidedAt: at, decidedBy: by, assigneeId: by, assignedAt: at });

  const joined = (userId: string, at: string) => d1.db.update(schema.teamMemberships).set({ joinedAt: at }).where(eq(schema.teamMemberships.userId, userId));
  const left = (userId: string, at: string) => d1.db.update(schema.teamMemberships).set({ leftAt: at }).where(eq(schema.teamMemberships.userId, userId));
  const lineOf = (lines: Array<{ userId: string }>, userId: string) => lines.find((line) => line.userId === userId);
  const payrollOf = async (month: string) => (await manager().get(`/api/team/payroll?month=${month}`)).body.data;

  beforeEach(async () => {
    await d1.db.run(sql.raw("DELETE FROM team_memberships"));
    for (const userId of ["u-samira", "u-karim", "u-amina"]) {
      await manager().post("/api/team/members", { userId, receiving: false });
      await joined(userId, "2026-10-01T08:00:00.000Z");
    }
  });

  it("pays each member their salary in force at the month's end and each commission at the rate of its day", async () => {
    await pay("u-samira", "salary", 40000, "2026-10-01");
    await pay("u-samira", "salary", 45000, "2026-11-20");
    await pay("u-samira", "salary", 50000, "2026-12-01");
    await pay("u-samira", "per_confirmed", 100, "2026-11-01");
    await pay("u-samira", "per_confirmed", 150, "2026-11-15");
    await pay("u-samira", "per_delivered", 200, "2026-11-01");
    await pay("u-karim", "per_confirmed", 120, "2026-11-20");
    await insertOrders([
      confirmed("p-1", "u-samira", "2026-10-31T23:30:00.000Z"),
      confirmed("p-2", "u-samira", "2026-11-20T10:00:00.000Z"),
      confirmed("p-dec", "u-samira", "2026-11-30T23:30:00.000Z"),
      confirmed("p-oct", "u-samira", "2026-10-15T10:00:00.000Z"),
      confirmed("k-early", "u-karim", "2026-11-10T10:00:00.000Z"),
      confirmed("k-late", "u-karim", "2026-11-25T10:00:00.000Z"),
      confirmed("a-1", "u-amina", "2026-11-05T10:00:00.000Z"),
    ]);
    await d1.db.insert(schema.shipments).values({ id: "s-oct", orderId: "p-oct", kind: "driver", driverId: "d1", handoffState: "accepted", deliveryType: "home", codAmount: 3600, revision: "r", deliveredAt: "2026-11-02T10:00:00.000Z", createdAt: T, updatedAt: T });

    const { body } = await manager().get("/api/team/payroll?month=2026-11");
    const member = { onTeam: true, joinedOn: null, leftOn: null };
    expect(body.data).toEqual([
      { userId: "u-amina", name: "Amina", ...member, paySet: false, salary: null, confirmed: { orders: 1, amount: 0, unpriced: 0 }, delivered: { orders: 0, amount: 0, unpriced: 0 }, total: 0, incomplete: true },
      { userId: "u-karim", name: "Karim", ...member, paySet: true, salary: null, confirmed: { orders: 2, amount: 120, unpriced: 1 }, delivered: { orders: 0, amount: 0, unpriced: 0 }, total: 120, incomplete: true },
      { userId: "u-samira", name: "Samira", ...member, paySet: true, salary: 45000, confirmed: { orders: 2, amount: 250, unpriced: 0 }, delivered: { orders: 1, amount: 200, unpriced: 0 }, total: 45450, incomplete: false },
    ]);
  });

  it("never changes a past month when someone leaves the team", async () => {
    await pay("u-amina", "salary", 30000, "2026-10-01");
    await pay("u-amina", "per_confirmed", 100, "2026-10-01");
    await insertOrders([confirmed("o-oct", "u-amina", "2026-10-20T10:00:00.000Z")]);
    const before = await payrollOf("2026-10");
    expect(lineOf(before, "u-amina")).toMatchObject({ onTeam: true, salary: 30000, total: 30100 });
    expect((await manager().delete("/api/team/members/u-amina")).status).toBe(200);
    expect(await payrollOf("2026-10")).toEqual(before);
  });

  it("pays a member who joined or left in the month their whole salary, and says the day", async () => {
    await pay("u-karim", "salary", 20000, "2026-11-01");
    await pay("u-amina", "salary", 30000, "2026-10-01");
    await joined("u-karim", "2026-11-11T23:30:00.000Z");
    await left("u-amina", "2026-11-20T10:00:00.000Z");
    const lines = await payrollOf("2026-11");
    expect(lineOf(lines, "u-karim")).toMatchObject({ onTeam: true, joinedOn: "2026-11-12", leftOn: null, salary: 20000, total: 20000 });
    expect(lineOf(lines, "u-amina")).toMatchObject({ onTeam: true, joinedOn: null, leftOn: "2026-11-20", salary: 30000 });
    expect(lineOf(await payrollOf("2026-10"), "u-karim")).toBeUndefined();
    expect(lineOf(await payrollOf("2026-12"), "u-amina")).toBeUndefined();
    expect(lineOf(await payrollOf("2026-12"), "u-karim")).toMatchObject({ joinedOn: null, salary: 20000 });
  });

  it("counts someone who left and came back in the month as on the team, from their first day", async () => {
    await pay("u-amina", "salary", 30000, "2026-10-01");
    await left("u-amina", "2026-11-05T10:00:00.000Z");
    await d1.db.insert(schema.teamMemberships).values({ id: "m-back", userId: "u-amina", joinedAt: "2026-11-18T10:00:00.000Z" });
    expect(lineOf(await payrollOf("2026-11"), "u-amina")).toMatchObject({ onTeam: true, joinedOn: null, leftOn: null, salary: 30000 });
  });

  it("pays a former member's commission on work credited in the month, but no salary; leaves out who was never on the team or paid", async () => {
    await pay("u-amina", "salary", 30000, "2026-10-01");
    await pay("u-amina", "per_delivered", 200, "2026-10-01");
    await left("u-amina", "2026-10-25T10:00:00.000Z");
    await insertOrders([confirmed("o-before", "u-amina", "2026-10-20T10:00:00.000Z"), confirmed("o-owner", "u-owner", "2026-11-03T10:00:00.000Z")]);
    await d1.db.insert(schema.shipments).values({ id: "s-before", orderId: "o-before", kind: "driver", driverId: "d1", handoffState: "accepted", deliveryType: "home", codAmount: 3600, revision: "r", deliveredAt: "2026-11-04T10:00:00.000Z", createdAt: T, updatedAt: T });
    const lines = await payrollOf("2026-11");
    expect(lineOf(lines, "u-amina")).toMatchObject({ onTeam: false, salary: null, delivered: { orders: 1, amount: 200, unpriced: 0 }, total: 200, incomplete: false });
    expect(lineOf(lines, "u-owner")).toBeUndefined();
  });

  it("starts a salary on the first of its month, and replaces a rate of the same kind from the same day", async () => {
    expect((await pay("u-samira", "salary", 40000, "2026-11-20")).body.data).toMatchObject({ kind: "salary", amount: 40000, validFrom: "2026-11-01" });
    await pay("u-samira", "per_confirmed", 100, "2026-11-05");
    await pay("u-samira", "per_confirmed", 130, "2026-11-05");
    const rates = (await manager().get("/api/team/members/u-samira/pay")).body.data;
    expect(rates.map((r: { kind: string; amount: number; validFrom: string }) => [r.kind, r.amount, r.validFrom])).toEqual([
      ["per_confirmed", 130, "2026-11-05"],
      ["salary", 40000, "2026-11-01"],
    ]);
    expect((await manager().delete(`/api/team/pay/${rates[0].id}`)).status).toBe(200);
    expect((await manager().delete(`/api/team/pay/${rates[0].id}`)).status).toBe(404);
  });

  it("is corrected for someone who left the team, and the removal of a rate says what it was", async () => {
    await manager().delete("/api/team/members/u-amina");
    const rate = (await pay("u-amina", "salary", 30000, "2026-10-01")).body.data;
    expect(rate).toMatchObject({ kind: "salary", amount: 30000, validFrom: "2026-10-01" });
    expect((await manager().delete(`/api/team/pay/${rate.id}`)).status).toBe(200);
    const [log] = await d1.db.select().from(schema.activityLogs).where(eq(schema.activityLogs.action, "team.pay_removed")).all();
    expect(JSON.parse(log!.metadata!)).toMatchObject({ payRateId: rate.id, kind: "salary", amount: 30000, validFrom: "2026-10-01" });
  });

  it("is seen and set only with the finance permission, for people who are or were on the team", async () => {
    const teamOnly = as("u-karim", [SCOPES.TEAM_READ, SCOPES.TEAM_MANAGE]);
    expect((await teamOnly.get("/api/team/payroll?month=2026-11")).status).toBe(403);
    expect((await teamOnly.get("/api/team/members/u-samira/pay")).status).toBe(403);
    expect((await teamOnly.post("/api/team/members/u-samira/pay", { kind: "salary", amount: 1, validFrom: "2026-11-01" })).status).toBe(403);
    expect((await pay("u-owner", "salary", 1, "2026-11-01")).body).toMatchObject({ code: "NOT_TEAM_MEMBER" });
    expect((await pay("u-samira", "salary", -5, "2026-11-01")).status).toBe(400);
  });
});
