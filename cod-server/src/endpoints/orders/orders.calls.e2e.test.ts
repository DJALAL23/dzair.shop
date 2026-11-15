/**
 * Calls without an answer, on real D1, as a confirmation team works them:
 * each "No answer" is one more call on the order (Call 1, Call 2, Call 3),
 * kept once it is confirmed or cancelled; nothing cancels the order on its
 * own; and a callback is never touched by a call. A move is made on the
 * order as its author saw it: a second press on a call someone else already
 * recorded counts nothing, and a press on an order someone else confirmed
 * or cancelled meanwhile is refused, never applied to what it became. The
 * list opens each call, the counts give each one, and the team's results say
 * how many calls came before an order nobody answered was cancelled.
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
import type { OrderStatus } from "../../../../cod-shared/orders/lifecycle";
import ordersRouter from "./routes";
import analyticsRouter from "../analytics/routes";

let d1: TestD1;
let app: OpenAPIHono<AppContext>;
const T0 = "2026-11-14T08:00:00.000Z";
const SAMIRA = staff("u-samira", "Samira");
const KARIM = staff("u-karim", "Karim");
/** The order as its author saw it. */
const saw = (status: OrderStatus, unansweredCalls: number) => ({ status, unansweredCalls });

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
  for (const table of ["business_events", "activity_logs", "stock_movements", "order_products", "shipments", "orders", "customers", "products", "users"]) {
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
    expect(await updateOrderStatus(d1.db, "o1", "unreachable", SAMIRA, saw("new", 0))).toEqual({ ok: true });
    for (const calls of [1, 2]) expect(await updateOrderStatus(d1.db, "o1", "unreachable", SAMIRA, saw("unreachable", calls))).toEqual({ ok: true });
    const order = await row("o1");
    expect([order.status, order.unansweredCalls]).toEqual(["unreachable", 3]);
    expect(await moves("o1")).toEqual([
      ["order.unreachable", "new"],
      ["order.unreachable", "unreachable"],
      ["order.unreachable", "unreachable"],
    ]);
    expect(await updateOrderStatus(d1.db, "o1", "unreachable", SAMIRA, saw("unreachable", 3))).toEqual({ ok: true });
    expect([(await row("o1")).status, (await row("o1")).unansweredCalls]).toEqual(["unreachable", 4]);
  });

  it("stays counted once the order is confirmed or cancelled", async () => {
    await seedOrder("kept", { status: "unreachable", unansweredCalls: 2 });
    await seedOrder("dropped", { status: "unreachable", unansweredCalls: 3 });
    expect(await updateOrderStatus(d1.db, "kept", "confirmed", SAMIRA, saw("unreachable", 2))).toEqual({ ok: true });
    expect(await updateOrderStatus(d1.db, "dropped", "cancelled", SAMIRA, saw("unreachable", 3))).toEqual({ ok: true });
    expect([(await row("kept")).status, (await row("kept")).unansweredCalls]).toEqual(["confirmed", 2]);
    expect([(await row("dropped")).status, (await row("dropped")).unansweredCalls]).toEqual(["cancelled", 3]);
  });

  it("goes on from the order's count when a confirmed customer stops answering", async () => {
    await seedOrder("o1", { status: "confirmed", confirmedAt: T0, unansweredCalls: 1 });
    expect(await updateOrderStatus(d1.db, "o1", "unreachable", SAMIRA, saw("confirmed", 1))).toEqual({ ok: true });
    expect((await row("o1")).unansweredCalls).toBe(2);
  });

  it("is counted only on the order whose call it was", async () => {
    await seedOrder("o1");
    await seedOrder("o2", { status: "unreachable", unansweredCalls: 2 });
    await updateOrderStatus(d1.db, "o1", "unreachable", SAMIRA, saw("new", 0));
    expect((await row("o2")).unansweredCalls).toBe(2);
  });

  it("counts nothing on a move anywhere else", async () => {
    await seedOrder("o1", { status: "unreachable", unansweredCalls: 1 });
    expect(await updateOrderStatus(d1.db, "o1", "confirmed", SAMIRA, saw("unreachable", 1))).toEqual({ ok: true });
    expect(await updateOrderStatus(d1.db, "o1", "preparing", SAMIRA, saw("confirmed", 1))).toEqual({ ok: true });
    expect(await updateOrderStatus(d1.db, "o1", "ready", SAMIRA)).toEqual({ ok: true });
    expect([(await row("o1")).status, (await row("o1")).unansweredCalls]).toEqual(["ready", 1]);
  });

  it("is counted every time when the caller does not say what they saw: the API and the AI tools", async () => {
    await seedOrder("o1");
    await updateOrderStatus(d1.db, "o1", "unreachable", SYSTEM);
    await updateOrderStatus(d1.db, "o1", "unreachable", SYSTEM);
    expect((await row("o1")).unansweredCalls).toBe(2);
  });
});

describe("a move made on the order as its author saw it", () => {
  it("is refused once someone else recorded that call, and writes nothing", async () => {
    await seedOrder("o1", { status: "unreachable", unansweredCalls: 2 });
    const before = await row("o1");
    for (const status of ["unreachable", "confirmed", "cancelled"] as const) {
      expect(await updateOrderStatus(d1.db, "o1", status, SAMIRA, saw("unreachable", 1))).toEqual({ ok: false, reason: "changed" });
    }
    expect(await row("o1")).toEqual(before);
    expect(await moves("o1")).toEqual([]);
  });

  it("is refused once someone else confirmed the order, and writes nothing: a late No answer never sends it back", async () => {
    await seedOrder("o1", { status: "confirmed", confirmedAt: T0, confirmedBy: "u-karim", unansweredCalls: 1 });
    const before = await row("o1");
    for (const status of ["unreachable", "cancelled"] as const) {
      expect(await updateOrderStatus(d1.db, "o1", status, SAMIRA, saw("unreachable", 1))).toEqual({ ok: false, reason: "changed" });
    }
    expect(await row("o1")).toEqual(before);
    expect(await moves("o1")).toEqual([]);
  });

  it("is refused once someone else cancelled the order, and puts no stock back twice", async () => {
    await d1.db.insert(schema.products).values({ id: "robe", name: "Robe", handle: "robe", price: 3000, trackInventory: true, inventory: 5, status: "ACTIVE", visibility: true, showInStore: true, createdAt: T0, updatedAt: T0 });
    await seedOrder("o1", { status: "unreachable", unansweredCalls: 3 });
    await d1.db.insert(schema.orderProducts).values({ id: "o1-l", orderId: "o1", productId: "robe", productName: "Robe", quantity: 2, pricePerUnit: 3000, lineTotal: 6000, createdAt: T0 });
    expect(await updateOrderStatus(d1.db, "o1", "cancelled", KARIM, saw("unreachable", 3))).toEqual({ ok: true });
    expect(await updateOrderStatus(d1.db, "o1", "cancelled", SAMIRA, saw("unreachable", 3))).toEqual({ ok: false, reason: "changed" });
    expect((await d1.db.select({ n: schema.products.inventory }).from(schema.products).where(eq(schema.products.id, "robe")).get())!.n).toBe(7);
    expect(await moves("o1")).toEqual([["order.cancelled", "unreachable"]]);
  });

  it("counts one call when two people press No answer on the same order at once", async () => {
    await seedOrder("o1", { status: "unreachable", unansweredCalls: 1 });
    const karimFirst = interleaved(d1.db, () => updateOrderStatus(d1.db, "o1", "unreachable", KARIM, saw("unreachable", 1)));
    expect(await updateOrderStatus(karimFirst, "o1", "unreachable", SAMIRA, saw("unreachable", 1))).toEqual({ ok: false, reason: "changed" });
    expect((await row("o1")).unansweredCalls).toBe(2);
    const events = await d1.db.select({ actor: schema.businessEvents.actorId }).from(schema.businessEvents).where(eq(schema.businessEvents.orderId, "o1")).all();
    expect(events).toEqual([{ actor: "u-karim" }]);
  });

  it("loses to a confirmation that lands between its read and its write", async () => {
    await seedOrder("o1", { status: "unreachable", unansweredCalls: 1 });
    const karimConfirms = interleaved(d1.db, () => updateOrderStatus(d1.db, "o1", "confirmed", KARIM, saw("unreachable", 1)));
    expect(await updateOrderStatus(karimConfirms, "o1", "unreachable", SAMIRA, saw("unreachable", 1))).toEqual({ ok: false, reason: "changed" });
    expect([(await row("o1")).status, (await row("o1")).unansweredCalls]).toEqual(["confirmed", 1]);
  });
});

describe("a callback", () => {
  it("stays as set through calls without an answer, and ends with the decision", async () => {
    const callbackAt = "2026-11-14T17:00:00.000Z";
    await seedOrder("o1", { callbackAt });
    await updateOrderStatus(d1.db, "o1", "unreachable", SAMIRA, saw("new", 0));
    await updateOrderStatus(d1.db, "o1", "unreachable", SAMIRA, saw("unreachable", 1));
    expect((await row("o1")).callbackAt).toBe(callbackAt);
    expect(await updateOrderStatus(d1.db, "o1", "confirmed", SAMIRA, saw("unreachable", 2))).toEqual({ ok: true });
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
  const code = async (response: Response) => ((await response.json()) as { code: string }).code;

  it("records each call on the order as the dashboard showed it, and refuses a second press on the same one", async () => {
    await seedOrder("o1");
    expect((await press("o1", { status: "unreachable", seen: saw("new", 0) })).status).toBe(200);
    const again = await press("o1", { status: "unreachable", seen: saw("new", 0) });
    expect([again.status, await code(again)]).toEqual([409, "ORDER_CHANGED"]);
    expect((await press("o1", { status: "unreachable", seen: saw("unreachable", 1) })).status).toBe(200);
    expect((await row("o1")).unansweredCalls).toBe(2);
    const read = (await (await app.request("/api/orders/o1")).json()) as { data: { status: string; unansweredCalls: number } };
    expect([read.data.status, read.data.unansweredCalls]).toEqual(["unreachable", 2]);
  });

  it("says a press on an order someone else decided meanwhile is stale, never a move the order does not allow", async () => {
    await seedOrder("confirmed", { status: "confirmed", confirmedAt: T0, unansweredCalls: 1 });
    await seedOrder("cancelled", { status: "cancelled", unansweredCalls: 3 });
    const late = await press("confirmed", { status: "unreachable", seen: saw("unreachable", 1) });
    expect([late.status, await code(late)]).toEqual([409, "ORDER_CHANGED"]);
    const afterCancel = await press("cancelled", { status: "unreachable", seen: saw("unreachable", 3) });
    expect([afterCancel.status, await code(afterCancel)]).toEqual([409, "ORDER_CHANGED"]);
    expect([(await row("confirmed")).status, (await row("cancelled")).status]).toEqual(["confirmed", "cancelled"]);
    expect(await moves("confirmed")).toEqual([]);
    expect((await press("confirmed", { status: "preparing", seen: saw("confirmed", 1) })).status).toBe(200);
  });

  it("still takes a move without what was seen, and refuses what was seen when it is not an order's", async () => {
    await seedOrder("o1");
    expect((await press("o1", { status: "unreachable" })).status).toBe(200);
    for (const seen of [{ status: "unreachable" }, { unansweredCalls: 1 }, saw("maybe" as OrderStatus, 1), saw("unreachable", -1), saw("unreachable", 1.5), { status: "unreachable", unansweredCalls: "1" }, "unreachable"]) {
      expect((await press("o1", { status: "unreachable", seen })).status, JSON.stringify(seen)).toBe(400);
    }
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
