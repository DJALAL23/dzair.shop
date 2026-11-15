/**
 * Calls without an answer, on real D1, as a confirmation team works them:
 * each "No answer" is one more call on the order (Call 1, Call 2, Call 3),
 * kept once it is confirmed or cancelled; a second press on what someone
 * else already recorded counts nothing; nothing cancels the order on its
 * own; and a callback is never touched by a call. The list opens each call,
 * the counts give each one, and the team's results say how many calls came
 * before an order nobody answered was cancelled.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { OpenAPIHono } from "@hono/zod-openapi";
import { eq, sql } from "drizzle-orm";
import type { AppContext } from "@/types";
import { errorHandler } from "@/middleware/error";
import { openApiValidationHook } from "@/openapi/validation-hook";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import { signIn } from "@/test-utils/sign-in";
import { staff, SYSTEM } from "@/test-utils/events";
import { interleaved } from "@/test-utils/interleaved";
import * as schema from "@/db/schema";
import { getAllOrders, updateOrderStatus } from "../../../../cod-shared/queries/orders";
import { getOrderStageStats } from "../../../../cod-shared/queries/analytics";
import { teamResults } from "../../../../cod-shared/team/queries";
import ordersRouter from "./routes";
import analyticsRouter from "../analytics/routes";

let d1: TestD1;
let app: OpenAPIHono<AppContext>;
const T0 = "2026-11-14T08:00:00.000Z";
const SAMIRA = staff("u-samira", "Samira");
const KARIM = staff("u-karim", "Karim");

beforeAll(async () => {
  d1 = await createTestD1();
  app = new OpenAPIHono<AppContext>({ defaultHook: openApiValidationHook });
  app.use("*", async (c, next) => {
    c.env = { DB: d1.raw } as AppContext["Bindings"];
    signIn(c, { id: "u-samira", name: "Samira", role: "admin", status: "active", scopes: ["*"] } as never);
    await next();
  });
  app.onError(errorHandler);
  app.route("/api/orders", ordersRouter);
  app.route("/api/analytics", analyticsRouter);
}, 120_000);

afterAll(async () => d1?.dispose());

beforeEach(async () => {
  for (const table of ["business_events", "activity_logs", "stock_movements", "order_products", "shipments", "orders", "customers", "users"]) {
    await d1.db.run(sql.raw(`DELETE FROM ${table}`));
  }
  await d1.db.insert(schema.customers).values({ id: "c1", name: "Amel", phone: "0551234567", wilaya: "Alger", createdAt: T0 });
  await d1.db.insert(schema.users).values([
    { id: "u-samira", name: "Samira", email: "samira@shop.dz", role: "staff", status: "active" },
    { id: "u-karim", name: "Karim", email: "karim@shop.dz", role: "staff", status: "active" },
  ]);
});

async function seedOrder(id: string, extra: Partial<typeof schema.orders.$inferInsert> = {}) {
  await d1.db.insert(schema.orders).values({
    id, orderNumber: `ORD-${id}`, customerId: "c1", customerName: "Amel", phone: "0551234567", wilayaId: 16, address: "Rue 1",
    price: 3000, deliveryFee: 600, status: "new", createdAt: T0, updatedAt: T0, ...extra,
  });
}

const row = async (id: string) => (await d1.db.select().from(schema.orders).where(eq(schema.orders.id, id)).get())!;
/** The order's processing events after it was placed, with the status each one left behind. */
const moves = async (id: string) =>
  (await d1.db.select({ type: schema.businessEvents.type, data: schema.businessEvents.data }).from(schema.businessEvents).where(eq(schema.businessEvents.orderId, id)).orderBy(schema.businessEvents.seq).all())
    .filter((event) => event.type !== "order.created")
    .map((event) => [event.type, (JSON.parse(event.data) as { previousStatus: string }).previousStatus]);

describe("a call without an answer", () => {
  it("is one more on the order each time: Call 1, Call 2, Call 3, and the order waits — nothing cancels it on its own", async () => {
    await seedOrder("o1");
    for (const seen of [0, 1, 2]) expect(await updateOrderStatus(d1.db, "o1", "unreachable", SAMIRA, { unansweredCalls: seen })).toEqual({ ok: true });
    const order = await row("o1");
    expect([order.status, order.unansweredCalls]).toEqual(["unreachable", 3]);
    expect(await moves("o1")).toEqual([
      ["order.unreachable", "new"],
      ["order.unreachable", "unreachable"],
      ["order.unreachable", "unreachable"],
    ]);
    expect(await updateOrderStatus(d1.db, "o1", "unreachable", SAMIRA, { unansweredCalls: 3 })).toEqual({ ok: true });
    expect([(await row("o1")).status, (await row("o1")).unansweredCalls]).toEqual(["unreachable", 4]);
  });

  it("stays counted once the order is confirmed or cancelled", async () => {
    await seedOrder("kept");
    await seedOrder("dropped");
    for (const seen of [0, 1]) await updateOrderStatus(d1.db, "kept", "unreachable", SAMIRA, { unansweredCalls: seen });
    for (const seen of [0, 1, 2]) await updateOrderStatus(d1.db, "dropped", "unreachable", SAMIRA, { unansweredCalls: seen });
    expect(await updateOrderStatus(d1.db, "kept", "confirmed", SAMIRA, { unansweredCalls: 2 })).toEqual({ ok: true });
    expect(await updateOrderStatus(d1.db, "dropped", "cancelled", SAMIRA, { unansweredCalls: 3 })).toEqual({ ok: true });
    expect([(await row("kept")).status, (await row("kept")).unansweredCalls]).toEqual(["confirmed", 2]);
    expect([(await row("dropped")).status, (await row("dropped")).unansweredCalls]).toEqual(["cancelled", 3]);
  });

  it("goes on from the order's count when a confirmed customer stops answering", async () => {
    await seedOrder("o1", { status: "confirmed", confirmedAt: T0, unansweredCalls: 1 });
    await updateOrderStatus(d1.db, "o1", "unreachable", SAMIRA, { unansweredCalls: 1 });
    expect((await row("o1")).unansweredCalls).toBe(2);
  });

  it("is counted only on the order whose call it was", async () => {
    await seedOrder("o1");
    await seedOrder("o2", { status: "unreachable", unansweredCalls: 2 });
    await updateOrderStatus(d1.db, "o1", "unreachable", SAMIRA, { unansweredCalls: 0 });
    expect((await row("o2")).unansweredCalls).toBe(2);
  });

  it("counts nothing on a move anywhere else", async () => {
    await seedOrder("o1", { status: "unreachable", unansweredCalls: 1 });
    await updateOrderStatus(d1.db, "o1", "confirmed", SAMIRA, { unansweredCalls: 1 });
    await updateOrderStatus(d1.db, "o1", "preparing", SAMIRA, { unansweredCalls: 1 });
    await updateOrderStatus(d1.db, "o1", "ready", SAMIRA);
    expect((await row("o1")).unansweredCalls).toBe(1);
  });

  it("is counted every time when the caller does not say what they saw: the API and the AI tools", async () => {
    await seedOrder("o1");
    await updateOrderStatus(d1.db, "o1", "unreachable", SYSTEM);
    await updateOrderStatus(d1.db, "o1", "unreachable", SYSTEM);
    expect((await row("o1")).unansweredCalls).toBe(2);
  });
});

describe("a call recorded on what someone saw", () => {
  it("is refused once the order moved on since, and writes nothing", async () => {
    await seedOrder("o1", { status: "unreachable", unansweredCalls: 2 });
    const before = await row("o1");
    for (const status of ["unreachable", "confirmed", "cancelled"] as const) {
      expect(await updateOrderStatus(d1.db, "o1", status, SAMIRA, { unansweredCalls: 1 })).toEqual({ ok: false, reason: "changed" });
    }
    expect(await row("o1")).toEqual(before);
    expect(await moves("o1")).toEqual([]);
    expect(await d1.db.select().from(schema.stockMovements).all()).toEqual([]);
  });

  it("counts one call when two people press No answer on the same order at once", async () => {
    await seedOrder("o1", { status: "unreachable", unansweredCalls: 1 });
    const karimFirst = interleaved(d1.db, () => updateOrderStatus(d1.db, "o1", "unreachable", KARIM, { unansweredCalls: 1 }));
    expect(await updateOrderStatus(karimFirst, "o1", "unreachable", SAMIRA, { unansweredCalls: 1 })).toEqual({ ok: false, reason: "changed" });
    expect((await row("o1")).unansweredCalls).toBe(2);
    const events = await d1.db.select({ actor: schema.businessEvents.actorId }).from(schema.businessEvents).where(eq(schema.businessEvents.orderId, "o1")).all();
    expect(events).toEqual([{ actor: "u-karim" }]);
  });
});

describe("a callback", () => {
  it("stays as set through calls without an answer, and ends with the decision", async () => {
    const callbackAt = "2026-11-14T17:00:00.000Z";
    await seedOrder("o1", { callbackAt });
    await updateOrderStatus(d1.db, "o1", "unreachable", SAMIRA, { unansweredCalls: 0 });
    await updateOrderStatus(d1.db, "o1", "unreachable", SAMIRA, { unansweredCalls: 1 });
    expect((await row("o1")).callbackAt).toBe(callbackAt);
    await updateOrderStatus(d1.db, "o1", "confirmed", SAMIRA, { unansweredCalls: 2 });
    expect((await row("o1")).callbackAt).toBeNull();
  });
});

describe("the orders on no answer, by call", () => {
  beforeEach(async () => {
    await seedOrder("new");
    await seedOrder("call1", { status: "unreachable", unansweredCalls: 1, assigneeId: "u-samira" });
    await seedOrder("call2", { status: "unreachable", unansweredCalls: 2, assigneeId: "u-karim" });
    await seedOrder("call3", { status: "unreachable", unansweredCalls: 3, assigneeId: "u-samira" });
    await seedOrder("call5", { status: "unreachable", unansweredCalls: 5, assigneeId: "u-samira" });
    await seedOrder("confirmed-after-2", { status: "confirmed", unansweredCalls: 2, confirmedAt: T0 });
    await seedOrder("cancelled-after-3", { status: "cancelled", unansweredCalls: 3 });
  });

  const ids = async (calls: 1 | 2 | 3) => (await getAllOrders(d1.db, { calls })).map((order) => order.id).sort();

  it("lists each call apart, the third with every later one, and only orders still waiting on no answer", async () => {
    expect(await ids(1)).toEqual(["call1"]);
    expect(await ids(2)).toEqual(["call2"]);
    expect(await ids(3)).toEqual(["call3", "call5"]);
  });

  it("counts each call apart, for everyone or for one member", async () => {
    expect((await getOrderStageStats(d1.db)).noAnswer).toEqual({ call1: 1, call2: 1, call3OrMore: 2 });
    expect((await getOrderStageStats(d1.db, { archived: "exclude" })).noAnswer).toEqual({ call1: 1, call2: 1, call3OrMore: 2 });
    expect((await getOrderStageStats(d1.db, { assigneeId: "u-samira" })).noAnswer).toEqual({ call1: 1, call2: 0, call3OrMore: 2 });
    expect((await getOrderStageStats(d1.db, { assigneeId: "u-karim" })).noAnswer).toEqual({ call1: 0, call2: 1, call3OrMore: 0 });
  });

  it("are opened through the API, which refuses a call it does not list", async () => {
    const list = async (query: string) => app.request(`/api/orders?${query}`);
    const second = await list("calls=2");
    expect(second.status).toBe(200);
    expect(((await second.json()) as { data: Array<{ id: string; unansweredCalls: number }> }).data.map((order) => [order.id, order.unansweredCalls])).toEqual([["call2", 2]]);
    expect((await list("calls=4")).status).toBe(400);
    expect((await list("calls=0")).status).toBe(400);
    const stages = await app.request("/api/analytics/order-stages?archived=exclude");
    expect(((await stages.json()) as { data: { noAnswer: unknown } }).data.noAnswer).toEqual({ call1: 1, call2: 1, call3OrMore: 2 });
  });
});

describe("through the API", () => {
  const press = (id: string, body: Record<string, unknown>) =>
    app.request(`/api/orders/${id}/status`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  it("records each call from the count the dashboard showed, and refuses a second press on the same one", async () => {
    await seedOrder("o1");
    expect((await press("o1", { status: "unreachable", unansweredCalls: 0 })).status).toBe(200);
    const again = await press("o1", { status: "unreachable", unansweredCalls: 0 });
    expect(again.status).toBe(409);
    expect(((await again.json()) as { code: string }).code).toBe("ORDER_CHANGED");
    expect((await press("o1", { status: "unreachable", unansweredCalls: 1 })).status).toBe(200);
    expect((await row("o1")).unansweredCalls).toBe(2);
    const read = (await (await app.request("/api/orders/o1")).json()) as { data: { status: string; unansweredCalls: number } };
    expect([read.data.status, read.data.unansweredCalls]).toEqual(["unreachable", 2]);
  });

  it("still takes a move without the count, and refuses a count that is not a whole number of calls", async () => {
    await seedOrder("o1");
    expect((await press("o1", { status: "unreachable" })).status).toBe(200);
    for (const unansweredCalls of [-1, 1.5, "1"]) expect((await press("o1", { status: "unreachable", unansweredCalls })).status).toBe(400);
    expect((await row("o1")).unansweredCalls).toBe(1);
  });
});

describe("the team's results", () => {
  it("say, for each member, the orders cancelled after no answer and the calls they had first", async () => {
    const mine = { assigneeId: "u-samira", assignedAt: T0 };
    await seedOrder("after-3", { ...mine, status: "cancelled", unansweredCalls: 3 });
    await seedOrder("after-1", { ...mine, status: "cancelled", unansweredCalls: 1 });
    await seedOrder("refused-on-the-phone", { ...mine, status: "cancelled", unansweredCalls: 0 });
    await seedOrder("confirmed-after-2", { ...mine, status: "confirmed", confirmedAt: T0, unansweredCalls: 2 });
    await seedOrder("confirmed-then-cancelled", { ...mine, status: "cancelled", confirmedAt: T0, unansweredCalls: 4 });
    await seedOrder("still-waiting", { ...mine, status: "unreachable", unansweredCalls: 2 });
    await seedOrder("karims", { assigneeId: "u-karim", assignedAt: T0, status: "cancelled", unansweredCalls: 2 });
    const results = await teamResults(d1.db, "2026-11-14", "2026-11-14");
    const of = (userId: string) => results.find((member) => member.userId === userId)!;
    expect([of("u-samira").cancelled, of("u-samira").cancelledAfterNoAnswer, of("u-samira").noAnswerCallsBeforeCancel]).toEqual([3, 2, 4]);
    expect([of("u-karim").cancelled, of("u-karim").cancelledAfterNoAnswer, of("u-karim").noAnswerCallsBeforeCancel]).toEqual([1, 1, 2]);
  });
});
