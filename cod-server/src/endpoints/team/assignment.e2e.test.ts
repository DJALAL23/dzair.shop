/**
 * Giving orders to the confirmation team, through the real writers on real
 * D1: the store's rule at checkout and in the dashboard, a manager's choice,
 * the orders that waited for someone to receive them, and the take-back of an
 * order a member left untouched. Each change records its Business Event in
 * the same batch; a status change keeps who decided and who confirmed.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { OpenAPIHono } from "@hono/zod-openapi";
import { drizzle } from "drizzle-orm/d1";
import { eq, sql } from "drizzle-orm";
import type { AppContext } from "@/types";
import { errorHandler } from "@/middleware/error";
import { openApiValidationHook } from "@/openapi/validation-hook";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import { eventsOf, staff, SYSTEM } from "@/test-utils/events";
import * as schema from "@/db/schema";
import { createOrder, updateOrderStatus } from "../../../../cod-shared/queries/orders";
import { assignOrders, shareOutWaiting, takeBackUntouched } from "../../../../cod-shared/team/assign";
import storeRouter from "../store/routes";
import { SCOPES } from "../../../../cod-shared/rbac/scopes";

let d1: TestD1;
let app: OpenAPIHono<AppContext>;
const T = "2026-11-14T08:00:00.000Z";
const MANAGER = staff("u-owner", "Bilal");

beforeAll(async () => {
  d1 = await createTestD1();
  app = new OpenAPIHono<AppContext>({ defaultHook: openApiValidationHook });
  app.use("*", async (c, next) => {
    c.env = { DB: d1.raw } as never;
    c.set("storeId", "store-team");
    await next();
  });
  app.onError(errorHandler);
  app.route("/store", storeRouter);
}, 120_000);

afterAll(async () => d1?.dispose());

const member = (id: string, name: string, status: "active" | "inactive" = "active") => ({ id, name, email: `${id}@shop.dz`, role: "staff" as const, status });

beforeEach(async () => {
  for (const table of ["business_events", "order_attribution", "order_products", "stock_movements", "orders", "customers", "team_pay", "team_agents", "store_team_config", "user_scopes", "users", "product_variants", "products", "shipping_rules", "shipping_profiles", "stores"]) {
    await d1.db.run(sql.raw(`DELETE FROM ${table}`));
  }
  await d1.db.insert(schema.stores).values({ id: "store-team", name: "Boutique", lang: "ar", createdAt: T, updatedAt: T });
  await d1.db.insert(schema.shippingProfiles).values({ id: "default", name: "Default", isDefault: true, createdAt: T, updatedAt: T });
  await d1.db.insert(schema.shippingRules).values({ id: "r16", profileId: "default", wilayaId: 16, homePrice: 600, stopDeskPrice: 300, homeEnabled: true, stopDeskEnabled: true, createdAt: T });
  await d1.db.insert(schema.customers).values({ id: "c1", name: "Karim", phone: "0551234567", wilaya: "Alger", createdAt: T });
  await d1.db.insert(schema.products).values({ id: "sac", name: "Sac", handle: "sac", sku: "SAC-1", price: 3000, status: "ACTIVE", visibility: true, showInStore: true, trackInventory: false, inventory: 0, createdAt: T, updatedAt: T });
  await d1.db.insert(schema.users).values([member("u-samira", "Samira"), member("u-karim", "Karim"), member("u-amina", "Amina"), member("u-left", "Yacine", "inactive"), member("u-owner", "Bilal")]);
  await d1.db.insert(schema.userScopes).values(["u-samira", "u-karim", "u-amina", "u-left"].map((userId) => ({ id: `s-${userId}`, userId, scope: SCOPES.ORDERS_READ_ASSIGNED, grantedAt: T })));
});

const team = (...rows: Array<[string, boolean, number | null]>) =>
  d1.db.insert(schema.teamAgents).values(rows.map(([userId, receiving, turn]) => ({ userId, receiving, turn, createdAt: T, updatedAt: T })));
const rule = (distribution: "manual" | "in_turn" | "evenly", takeBackMinutes: number | null = null, takeBackLimit = 2) =>
  d1.db.insert(schema.storeTeamConfig).values({ id: "cfg", storeId: "store-team", distribution, takeBackMinutes, takeBackLimit, createdAt: T, updatedAt: T });

let n = 0;
const dashboardOrder = async (author = MANAGER) => {
  const id = `o-${++n}`;
  const placedAt = new Date(Date.parse(T) + n * 1000).toISOString();
  await createOrder(
    d1.db,
    { id, orderNumber: `ORD-${n}`, customerId: "c1", customerName: "Karim", phone: "0551234567", wilayaId: 16, communeId: "c-16-001", address: "Rue 1", price: 3000, deliveryFee: 600, codAmount: 3600, createdAt: placedAt, updatedAt: placedAt },
    [{ id: `${id}-1`, orderId: id, productId: "sac", productName: "Sac", quantity: 1, pricePerUnit: 3000, lineTotal: 3000, createdAt: T }],
    author,
  );
  return id;
};
const checkout = async () => {
  const response = await app.request("/store/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ customerName: "Amel Kaci", phone: "0551234567", wilayaId: 16, communeId: "c-16-001", deliveryType: "home", address: "Rue 1", items: [{ productId: "sac", productName: "Sac", quantity: 1 }] }),
  });
  expect(response.status).toBeLessThan(300);
  return (await d1.db.select({ id: schema.orders.id }).from(schema.orders).orderBy(sql`rowid desc`).get())!.id;
};
const orderRow = async (id: string) => (await d1.db.select().from(schema.orders).where(eq(schema.orders.id, id)).get())!;
const assignee = async (id: string) => (await orderRow(id)).assigneeId;
const assignments = async (id: string) => (await eventsOf(d1.db, id)).filter((e) => e.type === "order.assigned" || e.type === "order.unassigned");

describe("a new order and the store's rule", () => {
  it("stays with nobody while orders are shared out by hand, and records no assignment", async () => {
    await team(["u-samira", true, null]);
    const id = await dashboardOrder();
    expect(await orderRow(id)).toMatchObject({ assigneeId: null, assignedAt: null });
    expect(await assignments(id)).toEqual([]);
  });

  it("goes to each receiving member in turn: a newcomer first, then whoever got one longest ago", async () => {
    await rule("in_turn");
    await team(["u-samira", true, 1], ["u-karim", true, 2], ["u-amina", true, null]);
    const given = [];
    for (let i = 0; i < 4; i++) given.push(await assignee(await dashboardOrder()));
    expect(given).toEqual(["u-amina", "u-samira", "u-karim", "u-amina"]);
  });

  const holding = async (userId: string, ...statuses: Array<"new" | "unreachable" | "confirmed">) => {
    for (const status of statuses) await d1.db.update(schema.orders).set({ assigneeId: userId, assignedAt: T, status }).where(eq(schema.orders.id, await dashboardOrder()));
  };

  it("goes to whoever has the fewest orders waiting, evenly: an unreachable customer is still waiting", async () => {
    await rule("evenly");
    await team(["u-samira", true, null], ["u-karim", true, null]);
    await holding("u-samira", "new");
    await holding("u-karim", "unreachable", "unreachable");
    expect(await assignee(await dashboardOrder())).toBe("u-samira");
  });

  it("counts only orders still waiting: a confirmed one is done", async () => {
    await rule("evenly");
    await team(["u-samira", true, null], ["u-karim", true, null]);
    await holding("u-samira", "new", "new");
    await holding("u-karim", "unreachable", "confirmed", "confirmed");
    expect(await assignee(await dashboardOrder())).toBe("u-karim");
  });

  it("skips a member who is not receiving or no longer active, and stays with nobody when nobody is", async () => {
    await rule("in_turn");
    await team(["u-samira", false, null], ["u-left", true, null]);
    expect(await assignee(await dashboardOrder())).toBeNull();
  });

  it("skips a member who cannot see orders, so no order waits with someone who will never see it; an admin sees them all", async () => {
    await rule("in_turn");
    await team(["u-amina", true, null], ["u-samira", true, 5]);
    await d1.db.delete(schema.userScopes).where(eq(schema.userScopes.userId, "u-amina"));
    expect(await assignee(await dashboardOrder())).toBe("u-samira");
    await d1.db.delete(schema.userScopes).where(eq(schema.userScopes.userId, "u-samira"));
    expect(await assignee(await dashboardOrder())).toBeNull();
    await d1.db.insert(schema.userScopes).values({ id: "s-all", userId: "u-samira", scope: SCOPES.ORDERS_READ, grantedAt: T });
    expect(await assignee(await dashboardOrder())).toBe("u-samira");
    await d1.db.update(schema.users).set({ role: "admin" }).where(eq(schema.users.id, "u-amina"));
    expect(await assignee(await dashboardOrder())).toBe("u-amina");
  });

  it("is given at checkout, with its Business Event, by the store's rule", async () => {
    await rule("in_turn");
    await team(["u-karim", true, null]);
    const id = await checkout();
    expect(await orderRow(id)).toMatchObject({ assigneeId: "u-karim", takeBacks: 0 });
    const [assigned] = await assignments(id);
    expect(assigned).toMatchObject({ type: "order.assigned", actorKind: "system", origin: "storefront", data: { assignee: { id: "u-karim", name: "Karim" }, previousAssignee: null, way: "automatic" } });
    expect(assigned!.occurredAt).toBe((await orderRow(id)).assignedAt);
  });

  it("is theirs when a team member enters it, even when they are not receiving and orders go by hand", async () => {
    await team(["u-samira", false, null]);
    const id = await dashboardOrder(staff("u-samira", "Samira"));
    expect(await assignee(id)).toBe("u-samira");
  });
});

describe("a manager gives orders out", () => {
  it("to a member, then to nobody, each with its event", async () => {
    await team(["u-karim", false, null]);
    const id = await dashboardOrder();
    expect(await assignOrders(d1.db, [id], "u-karim", MANAGER)).toEqual({ ok: true, results: [{ orderId: id, ok: true, changed: true }] });
    expect(await orderRow(id)).toMatchObject({ assigneeId: "u-karim", takeBacks: 0 });
    await assignOrders(d1.db, [id], null, MANAGER);
    expect(await assignee(id)).toBeNull();
    expect((await assignments(id)).map((e) => [e.type, e.actorId, "assignee" in e.data ? e.data.assignee?.id : null, e.data.previousAssignee?.id ?? null, "way" in e.data ? e.data.way : null])).toEqual([
      ["order.assigned", "u-owner", "u-karim", null, "manual"],
      ["order.unassigned", "u-owner", null, "u-karim", null],
    ]);
  });

  it("leaves an order already with that member as it is, and says which orders were not found", async () => {
    await team(["u-karim", false, null]);
    const id = await dashboardOrder();
    await assignOrders(d1.db, [id], "u-karim", MANAGER);
    const again = await assignOrders(d1.db, [id, "o-missing"], "u-karim", MANAGER);
    expect(again).toEqual({ ok: true, results: [{ orderId: id, ok: true, changed: false }, { orderId: "o-missing", ok: false, reason: "order_not_found" }] });
    expect(await assignments(id)).toHaveLength(1);
  });

  it("keeps who handled an order once it is confirmed or cancelled, and still gives one whose customer did not answer", async () => {
    await rule("in_turn");
    await team(["u-samira", false, null], ["u-karim", true, null]);
    const samira = staff("u-samira", "Samira");
    const [confirmed, cancelled, unreachable] = [await dashboardOrder(), await dashboardOrder(), await dashboardOrder()];
    await assignOrders(d1.db, [confirmed, cancelled, unreachable], "u-samira", MANAGER);
    await updateOrderStatus(d1.db, confirmed, "confirmed", samira);
    await updateOrderStatus(d1.db, cancelled, "cancelled", samira);
    await updateOrderStatus(d1.db, unreachable, "unreachable", samira);
    const handovers = (await assignments(confirmed)).length;

    expect(await assignOrders(d1.db, [confirmed, cancelled, unreachable], "u-karim", MANAGER)).toEqual({
      ok: true,
      results: [
        { orderId: confirmed, ok: false, reason: "decided" },
        { orderId: cancelled, ok: false, reason: "decided" },
        { orderId: unreachable, ok: true, changed: true },
      ],
    });
    for (const to of [null, "rule"] as const) expect(await assignOrders(d1.db, [confirmed], to, MANAGER)).toEqual({ ok: true, results: [{ orderId: confirmed, ok: false, reason: "decided" }] });
    expect([await assignee(confirmed), await assignee(cancelled), await assignee(unreachable)]).toEqual(["u-samira", "u-samira", "u-karim"]);
    expect(await assignments(confirmed)).toHaveLength(handovers);
  });

  it("leaves an order confirmed while it was being given with whoever confirmed it", async () => {
    await team(["u-samira", false, null], ["u-karim", false, null]);
    const id = await dashboardOrder();
    await assignOrders(d1.db, [id], "u-samira", MANAGER);
    const confirmedMeanwhile = new Proxy(d1.raw, {
      get(target, key) {
        if (key === "batch")
          return async (statements: D1PreparedStatement[]) => {
            await target.prepare("UPDATE orders SET status = 'confirmed' WHERE id = ?").bind(id).run();
            return target.batch(statements);
          };
        const value = (target as never)[key] as unknown;
        return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
      },
    });

    expect(await assignOrders(drizzle(confirmedMeanwhile as D1Database, { schema }), [id], "u-karim", MANAGER)).toEqual({ ok: true, results: [{ orderId: id, ok: false, reason: "changed" }] });
    expect(await assignee(id)).toBe("u-samira");
    expect(await assignments(id)).toHaveLength(1);
  });

  it("refuses a member who does not exist, is no longer active, is not on the team, or cannot see orders", async () => {
    await team(["u-left", false, null], ["u-karim", false, null]);
    await d1.db.delete(schema.userScopes).where(eq(schema.userScopes.userId, "u-karim"));
    const id = await dashboardOrder();
    expect(await assignOrders(d1.db, [id], "u-nobody", MANAGER)).toEqual({ ok: false, reason: "member_not_found" });
    expect(await assignOrders(d1.db, [id], "u-left", MANAGER)).toEqual({ ok: false, reason: "member_inactive" });
    expect(await assignOrders(d1.db, [id], "u-amina", MANAGER)).toEqual({ ok: false, reason: "not_member" });
    expect(await assignOrders(d1.db, [id], "u-karim", MANAGER)).toEqual({ ok: false, reason: "no_order_access" });
    expect(await assignee(id)).toBeNull();
    await d1.db.update(schema.users).set({ role: "admin" }).where(eq(schema.users.id, "u-karim"));
    expect(await assignOrders(d1.db, [id], "u-karim", MANAGER)).toMatchObject({ ok: true });
    expect(await assignee(id)).toBe("u-karim");
  });

  it("shares chosen orders out by the store's rule, to someone other than who has them", async () => {
    await rule("in_turn");
    await team(["u-samira", true, null], ["u-karim", true, null]);
    const id = await dashboardOrder();
    const before = await assignee(id);
    await assignOrders(d1.db, [id], "rule", MANAGER);
    expect(await assignee(id)).not.toBe(before);
    expect((await assignments(id)).at(-1)).toMatchObject({ actorKind: "system", data: { way: "automatic", previousAssignee: { id: before } } });
  });
});

describe("a change that loses its race", () => {
  /** Runs `change` just before the next batch, as another request would between the read and the write. */
  const meanwhile = (change: () => Promise<unknown>) => {
    const batch = d1.db.batch.bind(d1.db);
    (d1.db as { batch: unknown }).batch = async (statements: never) => {
      (d1.db as { batch: unknown }).batch = batch;
      await change();
      return batch(statements);
    };
  };

  it("leaves an order with nobody, with no event, when it was worked since it was read", async () => {
    await rule("in_turn");
    await team(["u-samira", false, null]);
    const id = await dashboardOrder();
    await d1.db.update(schema.teamAgents).set({ receiving: true });
    meanwhile(() => d1.db.update(schema.orders).set({ status: "unreachable" }).where(eq(schema.orders.id, id)));
    expect(await shareOutWaiting(d1.db, new Date(), SYSTEM)).toBe(0);
    expect(await assignee(id)).toBeNull();
    expect(await assignments(id)).toEqual([]);
  });

  it("leaves an order with its member, with no event, when they came back to the team since it was read", async () => {
    await rule("in_turn");
    await team(["u-samira", true, null]);
    const id = await dashboardOrder();
    await d1.db.update(schema.orders).set({ assigneeId: "u-amina", assignedAt: T }).where(eq(schema.orders.id, id));
    const before = (await assignments(id)).length;
    meanwhile(() => team(["u-amina", false, null]));
    expect(await shareOutWaiting(d1.db, new Date(), SYSTEM)).toBe(0);
    expect(await assignee(id)).toBe("u-amina");
    expect(await assignments(id)).toHaveLength(before);
  });

  it("leaves a manager's choice unmade, with no event, when the order changed hands since it was read", async () => {
    await team(["u-karim", false, null]);
    const id = await dashboardOrder();
    meanwhile(() => d1.db.update(schema.orders).set({ assigneeId: "u-amina", assignedAt: T }).where(eq(schema.orders.id, id)));
    expect(await assignOrders(d1.db, [id], "u-karim", MANAGER)).toEqual({ ok: true, results: [{ orderId: id, ok: false, reason: "changed" }] });
    expect(await assignee(id)).toBe("u-amina");
    expect(await assignments(id)).toEqual([]);
  });

  it("takes nothing back from a member given the order again since it was read", async () => {
    await rule("in_turn", 15, 2);
    await team(["u-samira", true, null], ["u-karim", true, null]);
    const id = await dashboardOrder();
    await d1.db.update(schema.orders).set({ assigneeId: "u-samira", assignedAt: "2026-11-14T09:00:00.000Z" }).where(eq(schema.orders.id, id));
    const before = (await assignments(id)).length;
    meanwhile(() => d1.db.update(schema.orders).set({ assignedAt: "2026-11-14T09:59:00.000Z" }).where(eq(schema.orders.id, id)));
    expect(await takeBackUntouched(d1.db, new Date("2026-11-14T10:00:00.000Z"), SYSTEM)).toBe(0);
    expect(await orderRow(id)).toMatchObject({ assigneeId: "u-samira", takeBacks: 0 });
    expect(await assignments(id)).toHaveLength(before);
  });
});

describe("orders that waited for someone to receive them", () => {
  it("are shared out, oldest first and in turn, once a member is receiving", async () => {
    await rule("in_turn");
    await team(["u-samira", false, null], ["u-karim", false, null]);
    const waiting = [await dashboardOrder(), await dashboardOrder(), await dashboardOrder(), await dashboardOrder()];
    expect(await shareOutWaiting(d1.db, new Date("2026-11-14T09:00:00.000Z"), SYSTEM)).toBe(0);
    await d1.db.update(schema.teamAgents).set({ receiving: true });
    expect(await shareOutWaiting(d1.db, new Date("2026-11-14T09:00:00.000Z"), SYSTEM)).toBe(4);
    expect(await Promise.all(waiting.map(assignee))).toEqual(["u-karim", "u-samira", "u-karim", "u-samira"]);
    expect((await assignments(waiting[0]!))[0]).toMatchObject({ actorKind: "system", origin: "schedule", data: { way: "automatic", previousAssignee: null } });
    expect(await shareOutWaiting(d1.db, new Date("2026-11-14T09:05:00.000Z"), SYSTEM)).toBe(0);
    expect(await Promise.all(waiting.map(assignee))).toEqual(["u-karim", "u-samira", "u-karim", "u-samira"]);
  });

  it("reach the waiting order behind orders already given out: a run never fills with orders it cannot move", async () => {
    await rule("in_turn");
    await team(["u-samira", true, null]);
    const given = await dashboardOrder();
    await d1.db.update(schema.teamAgents).set({ receiving: false });
    const waiting = await dashboardOrder();
    await d1.db.update(schema.teamAgents).set({ receiving: true });
    expect(await assignee(given)).toBe("u-samira");
    expect(await shareOutWaiting(d1.db, new Date(), SYSTEM, 1)).toBe(1);
    expect(await assignee(waiting)).toBe("u-samira");
  });

  it("stay with nobody while orders go by hand, and leave a decided order alone", async () => {
    await team(["u-samira", true, null]);
    const id = await dashboardOrder();
    expect(await shareOutWaiting(d1.db, new Date(), SYSTEM)).toBe(0);
    await d1.db.insert(schema.storeTeamConfig).values({ id: "cfg", storeId: "store-team", distribution: "evenly", createdAt: T, updatedAt: T });
    await updateOrderStatus(d1.db, id, "unreachable", MANAGER);
    expect(await shareOutWaiting(d1.db, new Date(), SYSTEM)).toBe(0);
    expect(await assignee(id)).toBeNull();
  });
});

describe("orders still waiting with someone who can no longer work them", () => {
  it("go back to the team by the store's rule once the member left it, the customer not reached included; what they confirmed stays theirs", async () => {
    await rule("in_turn");
    await team(["u-samira", true, null], ["u-karim", false, null]);
    const [waiting, unreachable, confirmed] = [await dashboardOrder(), await dashboardOrder(), await dashboardOrder()];
    await updateOrderStatus(d1.db, unreachable, "unreachable", staff("u-samira", "Samira"));
    await updateOrderStatus(d1.db, confirmed, "confirmed", staff("u-samira", "Samira"));
    expect(await shareOutWaiting(d1.db, new Date(), SYSTEM)).toBe(0);

    await d1.db.delete(schema.teamAgents).where(eq(schema.teamAgents.userId, "u-samira"));
    expect(await shareOutWaiting(d1.db, new Date(), SYSTEM)).toBe(0);
    expect(await assignee(waiting)).toBe("u-samira");

    await d1.db.update(schema.teamAgents).set({ receiving: true });
    expect(await shareOutWaiting(d1.db, new Date(), SYSTEM)).toBe(2);
    expect([await assignee(waiting), await assignee(unreachable), await assignee(confirmed)]).toEqual(["u-karim", "u-karim", "u-samira"]);
    expect((await assignments(waiting)).at(-1)).toMatchObject({ type: "order.assigned", actorKind: "system", data: { way: "automatic", previousAssignee: { id: "u-samira", name: "Samira" }, assignee: { id: "u-karim", name: "Karim" } } });
    expect(await shareOutWaiting(d1.db, new Date(), SYSTEM)).toBe(0);
  });

  it("go back to the team when the member's account was made inactive, though they are still on it", async () => {
    await rule("evenly");
    await team(["u-left", false, null], ["u-amina", true, null]);
    const id = await dashboardOrder();
    await d1.db.update(schema.orders).set({ assigneeId: "u-left", assignedAt: T }).where(eq(schema.orders.id, id));
    expect(await shareOutWaiting(d1.db, new Date(), SYSTEM)).toBe(1);
    expect(await assignee(id)).toBe("u-amina");
  });

  it("stay where they are while orders go by hand", async () => {
    await team(["u-karim", true, null]);
    const id = await dashboardOrder();
    await d1.db.update(schema.orders).set({ assigneeId: "u-left", assignedAt: T }).where(eq(schema.orders.id, id));
    expect(await shareOutWaiting(d1.db, new Date(), SYSTEM)).toBe(0);
    expect(await assignee(id)).toBe("u-left");
  });
});

describe("an order a member left untouched", () => {
  const at = (minutes: number) => new Date(Date.parse("2026-11-14T10:00:00.000Z") + minutes * 60_000);
  const untouched = async (id: string, by: string, minutesAgo: number, from = at(0)) =>
    d1.db.update(schema.orders).set({ assigneeId: by, assignedAt: new Date(from.getTime() - minutesAgo * 60_000).toISOString() }).where(eq(schema.orders.id, id));

  it("moves to the next member after the store's minutes, up to its limit, then waits for a manager", async () => {
    await rule("in_turn", 15, 2);
    await team(["u-samira", true, null], ["u-karim", true, null]);
    const id = await dashboardOrder();
    await untouched(id, "u-samira", 20);

    expect(await takeBackUntouched(d1.db, at(0), SYSTEM)).toBe(1);
    expect(await orderRow(id)).toMatchObject({ assigneeId: "u-karim", assignedAt: at(0).toISOString(), takeBacks: 1 });
    expect((await assignments(id)).at(-1)).toMatchObject({ actorKind: "system", origin: "schedule", data: { way: "take_back", previousAssignee: { id: "u-samira", name: "Samira" }, assignee: { id: "u-karim" } } });

    expect(await takeBackUntouched(d1.db, at(10), SYSTEM)).toBe(0);
    expect(await takeBackUntouched(d1.db, at(16), SYSTEM)).toBe(1);
    expect(await orderRow(id)).toMatchObject({ assigneeId: "u-samira", takeBacks: 2 });
    expect(await takeBackUntouched(d1.db, at(60), SYSTEM)).toBe(0);
    expect(await assignee(id)).toBe("u-samira");

    await assignOrders(d1.db, [id], "u-karim", MANAGER);
    expect(await orderRow(id)).toMatchObject({ assigneeId: "u-karim", takeBacks: 0 });
  });

  it("reaches the order due behind ones it may not move: a callback, or the limit reached", async () => {
    await rule("in_turn", 15, 1);
    await team(["u-samira", true, null], ["u-karim", true, null]);
    const called = await dashboardOrder();
    const spent = await dashboardOrder();
    const due = await dashboardOrder();
    await untouched(called, "u-samira", 50);
    await untouched(spent, "u-samira", 40);
    await untouched(due, "u-samira", 30);
    await d1.db.update(schema.orders).set({ callbackAt: "2026-11-14T15:00:00.000Z" }).where(eq(schema.orders.id, called));
    await d1.db.update(schema.orders).set({ takeBacks: 1 }).where(eq(schema.orders.id, spent));
    expect(await takeBackUntouched(d1.db, at(0), SYSTEM, 1)).toBe(1);
    expect([await assignee(called), await assignee(spent), await assignee(due)]).toEqual(["u-samira", "u-samira", "u-karim"]);
  });

  it("stays when a callback is set, when it was decided, when nobody else is receiving, or when take-back is off", async () => {
    await rule("in_turn", 15, 2);
    await team(["u-samira", true, null], ["u-karim", false, null]);
    const alone = await dashboardOrder();
    await untouched(alone, "u-samira", 30);
    expect(await takeBackUntouched(d1.db, at(0), SYSTEM)).toBe(0);

    await d1.db.update(schema.teamAgents).set({ receiving: true });
    const called = await dashboardOrder();
    const decided = await dashboardOrder();
    for (const id of [alone, called, decided]) await untouched(id, "u-samira", 30);
    await d1.db.update(schema.orders).set({ callbackAt: "2026-11-14T15:00:00.000Z" }).where(eq(schema.orders.id, called));
    await updateOrderStatus(d1.db, decided, "unreachable", staff("u-samira", "Samira"));
    expect(await takeBackUntouched(d1.db, at(0), SYSTEM)).toBe(1);
    expect([await assignee(alone), await assignee(called), await assignee(decided)]).toEqual(["u-karim", "u-samira", "u-samira"]);

    await d1.db.update(schema.storeTeamConfig).set({ takeBackMinutes: null });
    await untouched(alone, "u-karim", 30);
    expect(await takeBackUntouched(d1.db, at(0), SYSTEM)).toBe(0);
  });
});

describe("a status change keeps who handled the order", () => {
  it("keeps the first decision and the first confirmation, with the member behind each, and ends a callback", async () => {
    const id = await dashboardOrder();
    await d1.db.update(schema.orders).set({ callbackAt: "2026-11-14T15:00:00.000Z" }).where(eq(schema.orders.id, id));
    await updateOrderStatus(d1.db, id, "unreachable", staff("u-karim", "Karim"));
    const first = await orderRow(id);
    expect(first).toMatchObject({ decidedBy: "u-karim", confirmedAt: null, confirmedBy: null, callbackAt: "2026-11-14T15:00:00.000Z" });

    await updateOrderStatus(d1.db, id, "confirmed", staff("u-samira", "Samira"));
    const confirmed = await orderRow(id);
    expect(confirmed).toMatchObject({ decidedAt: first.decidedAt, decidedBy: "u-karim", confirmedBy: "u-samira", callbackAt: null });
    expect(confirmed.confirmedAt).not.toBeNull();

    await updateOrderStatus(d1.db, id, "unreachable", staff("u-karim", "Karim"));
    await updateOrderStatus(d1.db, id, "confirmed", staff("u-karim", "Karim"));
    expect(await orderRow(id)).toMatchObject({ confirmedAt: confirmed.confirmedAt, confirmedBy: "u-samira", decidedBy: "u-karim" });
  });

  it("credits no member with what the system decides, and ends a callback on cancel", async () => {
    const id = await dashboardOrder();
    await d1.db.update(schema.orders).set({ callbackAt: "2026-11-14T15:00:00.000Z" }).where(eq(schema.orders.id, id));
    await updateOrderStatus(d1.db, id, "cancelled", SYSTEM);
    expect(await orderRow(id)).toMatchObject({ decidedBy: null, confirmedAt: null, callbackAt: null });
    expect((await orderRow(id)).decidedAt).not.toBeNull();
  });
});
