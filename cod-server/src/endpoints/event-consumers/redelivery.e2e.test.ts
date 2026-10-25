/**
 * The merchant's word on Consumers and Deliveries, through the real routes
 * and the real drain on one D1: a retry or a Replay makes Deliveries due
 * again — or creates the ones a Consumer never had — without recording a
 * single Business Event again, and the drain delivers them. A stopped
 * Consumer is refused, one Delivery is never made twice, and only
 * `settings:integrations` may do any of it.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenAPIHono } from "@hono/zod-openapi";
import { asc, eq, sql } from "drizzle-orm";
import type { AppContext, Env } from "@/types";
import { errorHandler } from "@/middleware/error";
import { openApiValidationHook } from "@/openapi/validation-hook";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import { signIn } from "@/test-utils/sign-in";
import { sampleOrder } from "@/test-utils/events";
import * as schema from "@/db/schema";
import { drain } from "@/events/drain";
import type { ConsumerKind } from "@/events/consumers/kind";
import type { BusinessEvent } from "../../../../cod-shared/events/log";
import { EVENT_CATALOGUE, type EventType } from "../../../../cod-shared/events/catalogue";
import consumersRouter from "./routes";
import deliveriesRouter from "../event-deliveries/routes";

const dbModule = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/db", () => dbModule);

let d1: TestD1;
let app: OpenAPIHono<AppContext>;
let scopes: string[] = ["*"];
let role: "admin" | "staff" = "admin";
const T = "2026-10-25T10:00:00.000Z";

beforeAll(async () => {
  d1 = await createTestD1();
  app = new OpenAPIHono<AppContext>({ defaultHook: openApiValidationHook });
  app.use("*", async (c, next) => {
    c.env = { DB: d1.raw } as never;
    signIn(c, { id: "u1", email: "u1@example.com", name: "Nadia", role, status: "active", apiKey: "k", scopes } as never);
    await next();
  });
  app.onError(errorHandler);
  app.route("/api/event-consumers", consumersRouter);
  app.route("/api/event-deliveries", deliveriesRouter);
}, 120_000);

afterAll(async () => d1?.dispose());

beforeEach(async () => {
  dbModule.getDb.mockReturnValue(d1.db);
  scopes = ["*"];
  role = "admin";
  for (const table of [schema.eventDeliveryAttempts, schema.eventDeliveries, schema.eventConsumers, schema.businessEvents, schema.activityLogs]) await d1.db.delete(table);
  await d1.db.run(sql`DELETE FROM sqlite_sequence WHERE name = 'business_events'`);
});

async function call(method: string, path: string, body?: unknown) {
  const res = await app.request(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }) });
  return { status: res.status, body: (await res.json()) as any };
}

async function consumer(id: string, subscription: string[], extra: Partial<typeof schema.eventConsumers.$inferInsert> = {}) {
  await d1.db.insert(schema.eventConsumers).values({
    id, kind: "memory", name: `Consumer ${id}`, subscription: JSON.stringify(subscription), settings: '{"token":"kind-secret"}',
    signingSecret: "whsec_never_shown", createdAt: T, updatedAt: T, ...extra,
  });
}

/** Business Events with Sequences 1…n, in this order. */
async function events(...types: EventType[]) {
  for (const [i, type] of types.entries()) {
    const subject = EVENT_CATALOGUE[type].subject;
    await d1.db.insert(schema.businessEvents).values({
      id: `evt_${i + 1}`, type, version: 1, subjectType: subject, subjectId: `o${i + 1}`, orderId: `o${i + 1}`, actorKind: "system", origin: "schedule",
      occurredAt: T, recordedAt: T, fannedOutAt: T, data: JSON.stringify({ order: { ...sampleOrder, id: `o${i + 1}` }, previousStatus: "new" }),
    });
  }
}

async function delivery(id: string, consumerId: string, eventSeq: number, state: "due" | "delivered" | "skipped" | "dead", attempts: number, nextAttemptAt: string | null = null) {
  await d1.db.insert(schema.eventDeliveries).values({ id, consumerId, eventSeq, state, attempts, nextAttemptAt, lastError: state === "dead" ? "HTTP 500" : null, createdAt: T, settledAt: state === "due" ? null : T });
  for (let attempt = 1; attempt <= attempts; attempt++) {
    await d1.db.insert(schema.eventDeliveryAttempts).values({ id: `${id}-a${attempt}`, deliveryId: id, attempt, attemptedAt: `2026-10-25T10:0${attempt}:00.000Z`, durationMs: 40, outcome: state === "dead" ? "retry" : state === "skipped" ? "skipped" : "delivered" });
  }
}

const deliveriesOf = (consumerId: string) => d1.db.select().from(schema.eventDeliveries).where(eq(schema.eventDeliveries.consumerId, consumerId)).orderBy(asc(schema.eventDeliveries.eventSeq)).all();
const eventCount = async () => (await d1.db.select().from(schema.businessEvents).all()).length;

/** The memory kind delivers everything, and remembers what it received. */
function memoryKind() {
  const received: BusinessEvent[] = [];
  const impl: ConsumerKind = { kind: "memory", cost: { external: 0, services: 0 }, async deliver({ event }) { received.push(event); return { kind: "delivered", httpStatus: 200 }; } };
  return { impl, received };
}
/** A drain a minute from now: what the merchant made due now is due to it. */
const runDrain = (kind: ConsumerKind, now = new Date(Date.now() + 60_000)) =>
  drain({ DB: d1.raw, EVENTS_QUEUE: { send: async () => {} } } as unknown as Env, { kinds: { memory: kind }, now: () => now });

describe("a Replay", () => {
  beforeEach(async () => {
    await consumer("hook", ["order.*"]);
    await events("order.created", "order.confirmed", "order.cancelled", "order.ready", "order.preparing", "shipment.delivered", "order.created");
    await delivery("d1", "hook", 1, "delivered", 1);
    await delivery("d2", "hook", 2, "dead", 8);
    await delivery("d3", "hook", 3, "skipped", 1);
    await delivery("d4", "hook", 4, "due", 2, "2026-10-25T18:00:00.000Z");
    // Sequence 5 was recorded while the Consumer was stopped; 6 is not an order event; 7 is outside the range.
  });

  it("makes the range's settled Deliveries due again and creates the missing one, recording no event", async () => {
    const { status, body } = await call("POST", "/api/event-consumers/hook/replay", { fromSequence: 1, toSequence: 6 });
    expect(status).toBe(202);
    expect(body.data).toEqual({ reopened: 3, created: 1 });
    expect(await eventCount()).toBe(7);

    const rows = await deliveriesOf("hook");
    expect(rows.map((d) => [d.eventSeq, d.state, d.attempts])).toEqual([[1, "due", 0], [2, "due", 0], [3, "due", 0], [4, "due", 2], [5, "due", 0]]);
    expect(rows.find((d) => d.eventSeq === 4)!.nextAttemptAt).toBe("2026-10-25T18:00:00.000Z");
    expect(rows.find((d) => d.eventSeq === 2)).toMatchObject({ lastError: null, settledAt: null });
    expect(rows.find((d) => d.eventSeq === 5)!.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("is delivered by the drain, the old Attempts kept beside the new", async () => {
    await call("POST", "/api/event-consumers/hook/replay", { fromSequence: 1, toSequence: 6 });
    const { impl, received } = memoryKind();
    await runDrain(impl);
    expect(received.map((event) => event.sequence).sort()).toEqual([1, 2, 3, 5]);
    expect((await deliveriesOf("hook")).filter((d) => d.state === "delivered").map((d) => d.eventSeq)).toEqual([1, 2, 3, 5]);
    const { body } = await call("GET", "/api/event-deliveries/d2");
    expect(body.data.attemptLog.map((a: { attempt: number; outcome: string }) => `${a.attempt}:${a.outcome}`)).toEqual([...Array.from({ length: 8 }, (_, i) => `${i + 1}:retry`), "1:delivered"]);
    expect(await eventCount()).toBe(7);
  });

  it("makes each Delivery once, however many Replays run at once", async () => {
    const answers = await Promise.all([1, 2, 3].map(() => call("POST", "/api/event-consumers/hook/replay", { fromSequence: 5, toSequence: 7 })));
    expect(answers.map((a) => a.status)).toEqual([202, 202, 202]);
    expect(answers.reduce((sum, a) => sum + a.body.data.created, 0)).toBe(2);
    expect((await deliveriesOf("hook")).map((d) => d.eventSeq)).toEqual([1, 2, 3, 4, 5, 7]);
  });

  it("delivers only what the Consumer subscribes to now", async () => {
    await d1.db.update(schema.eventConsumers).set({ subscription: '["order.cancelled"]' }).where(eq(schema.eventConsumers.id, "hook"));
    expect((await call("POST", "/api/event-consumers/hook/replay", { fromSequence: 1, toSequence: 7 })).body.data).toEqual({ reopened: 1, created: 0 });
    expect((await deliveriesOf("hook")).filter((d) => d.state === "due").map((d) => d.eventSeq)).toEqual([3, 4]);
  });

  it("is refused for a stopped Consumer, changing nothing", async () => {
    await d1.db.update(schema.eventConsumers).set({ enabled: false, disabledReason: "failing" }).where(eq(schema.eventConsumers.id, "hook"));
    const { status, body } = await call("POST", "/api/event-consumers/hook/replay", { fromSequence: 1, toSequence: 6 });
    expect(status).toBe(409);
    expect(body.code).toBe("EVENT_CONSUMER_DISABLED");
    expect((await deliveriesOf("hook")).map((d) => d.state)).toEqual(["delivered", "dead", "skipped", "due"]);
  });

  it.each([
    ["a range that ends before it starts", { fromSequence: 5, toSequence: 4 }],
    ["more than a thousand Sequences", { fromSequence: 1, toSequence: 1001 }],
    ["no Sequence 0", { fromSequence: 0, toSequence: 3 }],
    ["a missing end", { fromSequence: 1 }],
  ])("refuses %s", async (_, range) => {
    const { status, body } = await call("POST", "/api/event-consumers/hook/replay", range);
    expect(status).toBe(400);
    expect(body.code).toBe("VALIDATION_FAILED");
  });

  it("is a 404 for a Consumer that does not exist", async () => {
    expect((await call("POST", "/api/event-consumers/ghost/replay", { fromSequence: 1, toSequence: 2 })).body.code).toBe("EVENT_CONSUMER_NOT_FOUND");
  });

  it("is written in the Activity Log with what it did", async () => {
    await call("POST", "/api/event-consumers/hook/replay", { fromSequence: 1, toSequence: 6 });
    const [log] = await d1.db.select().from(schema.activityLogs).all();
    expect(log).toMatchObject({ action: "event_consumer.replayed", entityType: "event_consumer", entityId: "hook", actorId: "u1" });
    expect(JSON.parse(log!.metadata!)).toEqual({ fromSequence: 1, toSequence: 6, reopened: 3, created: 1 });
  });
});

describe("retrying one Delivery", () => {
  beforeEach(async () => {
    await consumer("hook", ["*"]);
    await events("order.created", "order.confirmed");
    await delivery("dead", "hook", 1, "dead", 8);
    await delivery("waiting", "hook", 2, "due", 1, "2026-10-25T18:00:00.000Z");
  });

  it("makes a dead one due now, and the drain delivers it", async () => {
    const { status, body } = await call("POST", "/api/event-deliveries/dead/retry");
    expect(status).toBe(202);
    expect(body.data).toEqual({ reopened: 1, created: 0 });
    const { impl, received } = memoryKind();
    await runDrain(impl);
    expect(received.map((event) => event.id)).toEqual(["evt_1"]);
    expect((await deliveriesOf("hook"))[0]).toMatchObject({ state: "delivered", attempts: 1 });
  });

  it("refuses one already on its way", async () => {
    const { status, body } = await call("POST", "/api/event-deliveries/waiting/retry");
    expect(status).toBe(409);
    expect(body.code).toBe("EVENT_DELIVERY_ALREADY_DUE");
  });

  it("refuses one whose Consumer is stopped", async () => {
    await d1.db.update(schema.eventConsumers).set({ enabled: false, disabledReason: "merchant" });
    expect((await call("POST", "/api/event-deliveries/dead/retry")).body.code).toBe("EVENT_CONSUMER_DISABLED");
    expect((await deliveriesOf("hook"))[0]!.state).toBe("dead");
  });

  it("is a 404 for a Delivery that does not exist", async () => {
    expect((await call("POST", "/api/event-deliveries/ghost/retry")).body.code).toBe("EVENT_DELIVERY_NOT_FOUND");
  });
});

describe("the Consumers", () => {
  beforeEach(async () => {
    await consumer("hook", ["order.*"], { failingSince: "2026-10-24T00:00:00.000Z" });
    await consumer("meta", ["*"], { createdAt: "2026-10-25T11:00:00.000Z" });
    await events("order.created", "order.confirmed", "order.cancelled");
    await delivery("d1", "hook", 1, "dead", 8);
    await delivery("d2", "hook", 2, "dead", 8);
    await delivery("d3", "hook", 3, "due", 1, T);
  });

  it("are listed oldest first with their Deliveries counted, never a secret or the kind's settings", async () => {
    const { status, body } = await call("GET", "/api/event-consumers");
    expect(status).toBe(200);
    expect(body.data.map((c: { id: string }) => c.id)).toEqual(["hook", "meta"]);
    expect(body.data[0]).toMatchObject({ kind: "memory", enabled: true, subscription: ["order.*"], deliveries: { due: 1, dead: 2 }, failingSince: "2026-10-24T00:00:00.000Z", disabledReason: null });
    const text = JSON.stringify(body);
    expect(text).not.toContain("whsec_never_shown");
    expect(text).not.toContain("kind-secret");
    expect(Object.keys(body.data[0])).not.toEqual(expect.arrayContaining(["signingSecret"]));
  });

  it("are stopped by the merchant, and started again with their failing streak cleared", async () => {
    const stopped = await call("PATCH", "/api/event-consumers/hook", { enabled: false });
    expect(stopped.body.data).toMatchObject({ enabled: false, disabledReason: "merchant" });
    const started = await call("PATCH", "/api/event-consumers/hook", { enabled: true });
    expect(started.body.data).toMatchObject({ enabled: true, disabledReason: null, failingSince: null });
    expect((await d1.db.select().from(schema.activityLogs).orderBy(asc(schema.activityLogs.createdAt)).all()).map((log) => log.action)).toEqual(["event_consumer.disabled", "event_consumer.enabled"]);
  });

  it("refuses an empty change, an edit to a built-in Consumer, and a Consumer that does not exist", async () => {
    expect((await call("PATCH", "/api/event-consumers/hook", {})).status).toBe(400);
    expect((await call("PATCH", "/api/event-consumers/hook", { kind: "webhook" })).status).toBe(400);
    expect((await call("PATCH", "/api/event-consumers/hook", { name: "Renamed" })).body.code).toBe("EVENT_CONSUMER_BUILT_IN");
    expect((await call("PATCH", "/api/event-consumers/ghost", { enabled: false })).body.code).toBe("EVENT_CONSUMER_NOT_FOUND");
    expect((await call("GET", "/api/event-consumers/ghost")).body.code).toBe("EVENT_CONSUMER_NOT_FOUND");
  });
});

describe("the Deliveries", () => {
  beforeEach(async () => {
    await consumer("hook", ["*"]);
    await consumer("meta", ["*"]);
    await events("order.created", "order.confirmed", "order.cancelled", "order.ready");
    for (const seq of [1, 2, 3, 4]) await delivery(`h${seq}`, "hook", seq, seq % 2 ? "dead" : "delivered", seq % 2 ? 8 : 1);
    await delivery("m2", "meta", 2, "skipped", 1);
  });

  it("of a Consumer, newest event first, paged without a gap or a repeat", async () => {
    const first = await call("GET", "/api/event-deliveries?consumerId=hook&limit=3");
    expect(first.body.data.map((d: { id: string }) => d.id)).toEqual(["h4", "h3", "h2"]);
    const second = await call("GET", `/api/event-deliveries?consumerId=hook&limit=3&before=${first.body.nextCursor}`);
    expect(second.body.data.map((d: { id: string }) => d.id)).toEqual(["h1"]);
    expect(second.body.nextCursor).toBeNull();
    expect(first.body.data[0].event).toEqual({ id: "evt_4", sequence: 4, type: "order.ready", orderId: "o4", occurredAt: T });
  });

  it("narrowed to the dead ones", async () => {
    expect((await call("GET", "/api/event-deliveries?consumerId=hook&state=dead")).body.data.map((d: { id: string }) => d.id)).toEqual(["h3", "h1"]);
  });

  it("of one Business Event, to every Consumer", async () => {
    expect((await call("GET", "/api/event-deliveries?eventId=evt_2")).body.data.map((d: { id: string }) => d.id)).toEqual(["h2", "m2"]);
  });

  it("one, with every Attempt it took", async () => {
    const { body } = await call("GET", "/api/event-deliveries/h3");
    expect(body.data).toMatchObject({ id: "h3", state: "dead", attempts: 8, lastError: "HTTP 500" });
    expect(body.data.attemptLog.map((a: { attempt: number }) => a.attempt)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect((await call("GET", "/api/event-deliveries/ghost")).body.code).toBe("EVENT_DELIVERY_NOT_FOUND");
  });

  it.each([["neither a Consumer nor an event", ""], ["both", "consumerId=hook&eventId=evt_1&"]])("refuses %s", async (_, query) => {
    expect((await call("GET", `/api/event-deliveries?${query}limit=5`)).status).toBe(400);
  });
});

describe("who may see and steer them", () => {
  beforeEach(async () => {
    await consumer("hook", ["*"]);
    await events("order.created");
    await delivery("d1", "hook", 1, "dead", 8);
  });

  it("only those with settings:integrations", async () => {
    role = "staff";
    scopes = ["orders:read", "orders:write", "settings:read"];
    for (const [method, path, body] of [
      ["GET", "/api/event-consumers"], ["GET", "/api/event-consumers/hook"], ["PATCH", "/api/event-consumers/hook", { enabled: false }],
      ["POST", "/api/event-consumers/hook/replay", { fromSequence: 1, toSequence: 1 }],
      ["GET", "/api/event-deliveries?consumerId=hook"], ["GET", "/api/event-deliveries/d1"], ["POST", "/api/event-deliveries/d1/retry"],
    ] as const) expect((await call(method, path, body)).status, `${method} ${path}`).toBe(403);
    expect((await deliveriesOf("hook"))[0]!.state).toBe("dead");

    scopes = ["settings:integrations"];
    expect((await call("GET", "/api/event-consumers")).status).toBe(200);
    expect((await call("POST", "/api/event-deliveries/d1/retry")).status).toBe(202);
  });
});
