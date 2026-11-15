/**
 * Calling a customer back, as the store's integrations are told on real D1:
 * each time set, moved or removed by hand is one event, written with the
 * change and carrying the order as it now stands; the schedule tells once
 * when a time set has come while the order still waits — never for a time
 * moved, an order decided or archived, or a time long past.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { asc, eq, sql } from "drizzle-orm";
import type { AppContext, AuthUser } from "@/types";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import { apiAs, staff } from "@/test-utils/api";
import * as schema from "@/db/schema";
import { SCOPES } from "../../../../cod-shared/rbac/scopes";
import { toBusinessEvent, type BusinessEvent } from "../../../../cod-shared/events/log";
import type { Author } from "../../../../cod-shared/events/actor";
import { announceDueCallbacks, CALLBACK_DUE_WINDOW_MS, CALLBACKS_DUE_PER_RUN, setCallback } from "../../../../cod-shared/team/callbacks";
import { BUSINESS_EVENT_SCHEMA } from "@/events/catalogue";
import { runInboundCron } from "@/inbound/cron";
import ordersRouter from "../orders/routes";

let d1: TestD1;
const T = "2026-11-14T08:00:00.000Z";
const NOW = new Date("2026-11-15T10:00:00.000Z");
const MINUTE = 60_000;
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * MINUTE).toISOString();
const SCHEDULE: Author = { actor: { kind: "system", id: null, name: null }, origin: "schedule" };
const CALLER: AuthUser = { ...staff([SCOPES.ORDERS_READ, SCOPES.ORDERS_UPDATE]), id: "u-samira", name: "Samira" };
const caller = () => apiAs(d1, CALLER, { "/api/orders": ordersRouter as OpenAPIHono<AppContext> });

beforeAll(async () => {
  d1 = await createTestD1();
}, 120_000);
afterAll(async () => d1?.dispose());

const order = (id: string, fields: Partial<typeof schema.orders.$inferInsert> = {}) =>
  d1.db.insert(schema.orders).values({
    id, orderNumber: `N-${id}`, customerId: "c1", customerName: "Amel", phone: "0551234567", wilayaId: 16, communeId: "c-16-001", address: "Rue 1",
    price: 3000, deliveryFee: 600, codAmount: 3600, status: "unreachable", unansweredCalls: 2, assigneeId: "u-samira", assignedAt: T, createdAt: T, updatedAt: T, ...fields,
  });

beforeEach(async () => {
  for (const table of ["business_events", "activity_logs", "orders", "customers", "users"]) await d1.db.run(sql.raw(`DELETE FROM ${table}`));
  await d1.db.insert(schema.users).values({ id: "u-samira", name: "Samira", email: "samira@shop.dz", role: "staff", status: "active" });
  await d1.db.insert(schema.customers).values({ id: "c1", name: "Amel", phone: "0551234567", wilaya: "Alger", createdAt: T });
});

async function events(type?: string): Promise<BusinessEvent[]> {
  const rows = await d1.db.select().from(schema.businessEvents).orderBy(asc(schema.businessEvents.seq)).all();
  const all = rows.map(toBusinessEvent);
  for (const event of all) expect(BUSINESS_EVENT_SCHEMA.safeParse(event).error, event.type).toBeUndefined();
  return type ? all.filter((event) => event.type === type) : all;
}
const callbackOf = async (id: string) => (await d1.db.select({ at: schema.orders.callbackAt }).from(schema.orders).where(eq(schema.orders.id, id)).get())!.at;

describe("a time to call back, set by hand", () => {
  it("is told when set, with the order as it now stands and who set it, then when moved, with the time it replaced", async () => {
    await order("o1");
    expect((await caller().put("/api/orders/o1/callback", { at: "2026-11-15T15:00:00+01:00" })).status).toBe(200);
    const [set] = await events();
    expect(set).toMatchObject({
      type: "order.callback_scheduled",
      subject: { type: "order", id: "o1" },
      orderId: "o1",
      actor: { kind: "staff", id: "u-samira", name: "Samira" },
      data: { at: "2026-11-15T14:00:00.000Z", previousAt: null, order: { id: "o1", status: "unreachable", unansweredCalls: 2, callbackAt: "2026-11-15T14:00:00.000Z", assignee: { id: "u-samira", name: "Samira" } } },
    });

    await caller().put("/api/orders/o1/callback", { at: "2026-11-16T09:00:00.000Z" });
    const moved = (await events("order.callback_scheduled"))[1]!;
    expect(moved.data).toMatchObject({ at: "2026-11-16T09:00:00.000Z", previousAt: "2026-11-15T14:00:00.000Z" });
  });

  it("tells nothing when the time set is the one already set", async () => {
    await order("o1", { callbackAt: "2026-11-16T09:00:00.000Z" });
    expect((await caller().put("/api/orders/o1/callback", { at: "2026-11-16T10:00:00+01:00" })).status).toBe(200);
    expect(await events()).toEqual([]);
  });

  it("is told when removed, with the time it was set for, and removing it twice tells it once", async () => {
    await order("o1", { callbackAt: "2026-11-16T09:00:00.000Z" });
    await caller().put("/api/orders/o1/callback", { at: null });
    await caller().put("/api/orders/o1/callback", { at: null });
    const cleared = await events();
    expect(cleared.map((event) => event.type)).toEqual(["order.callback_cleared"]);
    expect(cleared[0]!.data).toMatchObject({ previousAt: "2026-11-16T09:00:00.000Z", order: { callbackAt: null } });
  });

  it("is refused, and tells nothing, on an order already decided or that does not exist", async () => {
    await order("o-done", { status: "confirmed" });
    expect((await caller().put("/api/orders/o-done/callback", { at: "2026-11-16T09:00:00.000Z" })).body).toMatchObject({ code: "ORDER_NOT_WAITING" });
    expect((await caller().put("/api/orders/o-none/callback", { at: "2026-11-16T09:00:00.000Z" })).status).toBe(404);
    expect(await events()).toEqual([]);
    expect(await callbackOf("o-done")).toBeNull();
  });

  it("replaces only the time it found: a time someone set meanwhile is the one its event says it replaced", async () => {
    await order("o1", { callbackAt: "2026-11-16T09:00:00.000Z" });
    let raced = false;
    const racing = new Proxy(d1.db, {
      get(target, key, receiver) {
        if (key === "batch" && !raced) {
          return async (statements: unknown[]) => {
            raced = true;
            await target.update(schema.orders).set({ callbackAt: "2026-11-17T09:00:00.000Z" }).where(eq(schema.orders.id, "o1"));
            return target.batch(statements as never);
          };
        }
        return Reflect.get(target, key, receiver);
      },
    });
    expect(await setCallback(racing as typeof d1.db, "o1", "2026-11-18T09:00:00.000Z", SCHEDULE)).toEqual({ ok: true });
    const told = await events();
    expect(told.map((event) => event.data)).toMatchObject([{ at: "2026-11-18T09:00:00.000Z", previousAt: "2026-11-17T09:00:00.000Z" }]);
    expect(await callbackOf("o1")).toBe("2026-11-18T09:00:00.000Z");
  });

  it("tells the removal of the time it found, when someone set another meanwhile", async () => {
    await order("o1", { callbackAt: "2026-11-16T09:00:00.000Z" });
    let raced = false;
    const racing = new Proxy(d1.db, {
      get(target, key, receiver) {
        if (key === "batch" && !raced) {
          return async (statements: unknown[]) => {
            raced = true;
            await target.update(schema.orders).set({ callbackAt: "2026-11-17T09:00:00.000Z" }).where(eq(schema.orders.id, "o1"));
            return target.batch(statements as never);
          };
        }
        return Reflect.get(target, key, receiver);
      },
    });
    expect(await setCallback(racing as typeof d1.db, "o1", null, SCHEDULE)).toEqual({ ok: true });
    expect((await events()).map((event) => [event.type, event.data])).toMatchObject([["order.callback_cleared", { previousAt: "2026-11-17T09:00:00.000Z" }]]);
    expect(await callbackOf("o1")).toBeNull();
  });
});

describe("the time to call back, when it comes", () => {
  it("is told once, by the schedule, as of the time set, with the order and who has it", async () => {
    await order("o1", { callbackAt: ago(4) });
    expect(await announceDueCallbacks(d1.db, NOW, SCHEDULE)).toEqual(["o1"]);
    expect(await announceDueCallbacks(d1.db, new Date(NOW.getTime() + 5 * MINUTE), SCHEDULE)).toEqual([]);
    const due = await events();
    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({
      type: "order.callback_due",
      occurredAt: ago(4),
      actor: { kind: "system", id: null, name: null },
      origin: "schedule",
      data: { at: ago(4), order: { id: "o1", callbackAt: ago(4), unansweredCalls: 2, assignee: { name: "Samira" } } },
    });
  });

  it("is told again for a new time set after it, once that one comes", async () => {
    await order("o1", { callbackAt: ago(30) });
    await announceDueCallbacks(d1.db, NOW, SCHEDULE);
    await d1.db.update(schema.orders).set({ callbackAt: ago(2) }).where(eq(schema.orders.id, "o1"));
    expect(await announceDueCallbacks(d1.db, NOW, SCHEDULE)).toEqual(["o1"]);
    expect((await events("order.callback_due")).map((event) => (event.data as { at: string }).at)).toEqual([ago(30), ago(2)]);
  });

  it("is not told for a time still to come, one long past, an order decided or archived", async () => {
    await order("o-later", { callbackAt: ago(-1) });
    await order("o-long-past", { callbackAt: ago(CALLBACK_DUE_WINDOW_MS / MINUTE) });
    await order("o-edge", { callbackAt: ago(CALLBACK_DUE_WINDOW_MS / MINUTE - 1) });
    await order("o-now", { callbackAt: NOW.toISOString() });
    await order("o-decided", { status: "confirmed", callbackAt: ago(5) });
    await order("o-archived", { callbackAt: ago(5), archivedAt: T });
    await order("o-new", { status: "new", unansweredCalls: 0, callbackAt: ago(5) });
    expect((await announceDueCallbacks(d1.db, NOW, SCHEDULE)).sort()).toEqual(["o-edge", "o-new", "o-now"]);
  });

  it("tells the soonest first, at most so many a run, and the rest on the next", async () => {
    const name = (i: number) => `o${String(i).padStart(3, "0")}`;
    for (let i = 0; i < CALLBACKS_DUE_PER_RUN + 2; i++) await order(name(i), { callbackAt: ago(30 + i * 0.5) });
    const first = await announceDueCallbacks(d1.db, NOW, SCHEDULE);
    expect(first).toHaveLength(CALLBACKS_DUE_PER_RUN);
    expect(first[0]).toBe(name(CALLBACKS_DUE_PER_RUN + 1));
    expect(await announceDueCallbacks(d1.db, NOW, SCHEDULE)).toEqual([name(1), name(0)]);
    expect(await events("order.callback_due")).toHaveLength(CALLBACKS_DUE_PER_RUN + 2);
  });

  it("tells nothing for an order confirmed, archived or a time moved between finding it and telling it", async () => {
    await order("o-confirmed", { callbackAt: ago(3) });
    await order("o-moved", { callbackAt: ago(3) });
    await order("o-archived", { callbackAt: ago(3) });
    const racing = new Proxy(d1.db, {
      get(target, key, receiver) {
        if (key === "batch") {
          return async (statements: unknown[]) => {
            await target.update(schema.orders).set({ status: "confirmed" }).where(eq(schema.orders.id, "o-confirmed"));
            await target.update(schema.orders).set({ callbackAt: ago(-60) }).where(eq(schema.orders.id, "o-moved"));
            await target.update(schema.orders).set({ archivedAt: T }).where(eq(schema.orders.id, "o-archived"));
            return target.batch(statements as never);
          };
        }
        return Reflect.get(target, key, receiver);
      },
    });
    await announceDueCallbacks(racing as typeof d1.db, NOW, SCHEDULE);
    expect(await events()).toEqual([]);
  });

  it("is told once when two runs find it at the same time", async () => {
    await order("o1", { callbackAt: ago(3) });
    let raced = false;
    const racing = new Proxy(d1.db, {
      get(target, key, receiver) {
        if (key === "batch" && !raced) {
          return async (statements: unknown[]) => {
            raced = true;
            await announceDueCallbacks(target, NOW, SCHEDULE);
            return target.batch(statements as never);
          };
        }
        return Reflect.get(target, key, receiver);
      },
    });
    await announceDueCallbacks(racing as typeof d1.db, NOW, SCHEDULE);
    expect(await events("order.callback_due")).toHaveLength(1);
  });

  it("is told by the five-minute schedule", async () => {
    await order("o1", { callbackAt: ago(3) });
    await runInboundCron({ DB: d1.raw, EVENTS_QUEUE: { send: async () => {} } } as never, NOW);
    expect((await events("order.callback_due")).map((event) => event.orderId)).toEqual(["o1"]);
  });
});
