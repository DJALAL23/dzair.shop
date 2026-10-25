/**
 * The delivery engine on real D1 (ADR 0017), with in-memory Consumer Kinds
 * at its one seam: fan-out, Attempts and their outcomes, the retry schedule,
 * leases, the budget, retention, and the wake.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { asc, eq, sql } from "drizzle-orm";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import { sampleOrder } from "@/test-utils/events";
import * as schema from "@/db/schema";
import type { Env } from "@/types";
import type { AttemptOutcome, DeliverableEvent } from "../../../cod-shared/events/deliveries";
import { DELIVERY_RETRIES, claimDelivery, fanOut, pruneEventLog, settleDelivery } from "../../../cod-shared/events/deliveries";
import { recordEvent } from "../../../cod-shared/events/record";
import type { BusinessEventDraft } from "../../../cod-shared/events/catalogue";
import type { ConsumerKind } from "./consumers/kind";
import { drain, drainAndContinue, wake, workIsDue } from "./drain";

let d1: TestD1;
const send = vi.fn(async () => {});
const env = () => ({ DB: d1.raw, EVENTS_QUEUE: { send }, CAPI_WORKFLOW: { create: vi.fn() } }) as unknown as Env;
const waitUntil = () => {};
const T0 = new Date("2026-10-25T10:00:00.000Z");
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

beforeAll(async () => {
  d1 = await createTestD1();
}, 120_000);

afterAll(async () => d1?.dispose());

beforeEach(async () => {
  for (const table of [schema.eventDeliveryAttempts, schema.eventDeliveries, schema.eventConsumers, schema.businessEvents]) await d1.db.delete(table);
  send.mockClear();
});

/** A kind that records what it received, really spends the D1 trips it declares, and answers what `answer` says. */
function memoryKind(kind: string, answer: (event: DeliverableEvent, attempt: number) => AttemptOutcome | Promise<AttemptOutcome> = () => ({ kind: "delivered", httpStatus: 200 }), cost = { external: 0, services: 1 }) {
  const received: Array<{ event: DeliverableEvent; attempt: number }> = [];
  const impl: ConsumerKind = {
    kind,
    cost,
    async deliver({ event, attempt, db }) {
      received.push({ event, attempt });
      for (let trip = 0; trip < cost.services; trip++) await db.run(sql`select 1`);
      return answer(event, attempt);
    },
  };
  return { impl, received };
}

async function consumer(id: string, kind: string, subscription: string[], extra: Partial<typeof schema.eventConsumers.$inferInsert> = {}) {
  await d1.db.insert(schema.eventConsumers).values({ id, kind, name: id, subscription: JSON.stringify(subscription), createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", ...extra });
}

const draft = (orderId: string, type: "order.confirmed" | "order.cancelled" = "order.confirmed"): BusinessEventDraft => ({
  type, subjectId: orderId, orderId, occurredAt: T0.toISOString(), actor: { kind: "staff", id: "u1", name: "Samira" }, origin: "dashboard",
  data: { order: { ...sampleOrder, id: orderId }, previousStatus: "new" },
});
const record = (orderId: string, type?: "order.confirmed" | "order.cancelled") => d1.db.batch([recordEvent(d1.db, draft(orderId, type))]);

const deliveries = () => d1.db.select().from(schema.eventDeliveries).orderBy(asc(schema.eventDeliveries.createdAt)).all();
const attemptsOf = (deliveryId: string) => d1.db.select().from(schema.eventDeliveryAttempts).where(eq(schema.eventDeliveryAttempts.deliveryId, deliveryId)).orderBy(asc(schema.eventDeliveryAttempts.attempt)).all();
const run = (kinds: Record<string, ConsumerKind>, now = T0) => drain(env(), { waitUntil, kinds, now: () => now });

describe("fan-out", () => {
  it("gives each event one Delivery per enabled Consumer subscribed to it, that existed when it was recorded", async () => {
    await consumer("all", "memory", ["*"]);
    await consumer("orders", "memory", ["order.*"]);
    await consumer("cancels", "memory", ["order.cancelled"]);
    await consumer("off", "memory", ["*"], { enabled: false });
    await consumer("later", "memory", ["*"], { createdAt: "2099-01-01T00:00:00.000Z" });
    await consumer("broken", "memory", ["nonsense"]);
    await record("o1");

    const { impl } = memoryKind("memory");
    const report = await run({ memory: impl });
    expect(report.fannedOut).toBe(1);
    expect((await deliveries()).map((d) => d.consumerId).sort()).toEqual(["all", "orders"]);
    const [event] = await d1.db.select().from(schema.businessEvents).all();
    expect(event!.fannedOutAt).not.toBeNull();
  });

  it("fans an event out once, however many drains run", async () => {
    await consumer("all", "memory", ["*"]);
    await record("o1");
    const { impl } = memoryKind("memory");
    await Promise.all([run({ memory: impl }), run({ memory: impl }), run({ memory: impl })]);
    expect(await deliveries()).toHaveLength(1);
  });
});

describe("an Attempt", () => {
  it("hands the kind the whole event, once, and records it delivered", async () => {
    await consumer("c1", "memory", ["*"]);
    await record("o1");
    const { impl, received } = memoryKind("memory");
    const report = await run({ memory: impl });

    expect(report.attempts.delivered).toBe(1);
    expect(received).toHaveLength(1);
    const [{ event, attempt }] = received;
    const [row] = await d1.db.select().from(schema.businessEvents).all();
    expect(attempt).toBe(1);
    expect(event).toMatchObject({
      id: row!.id, sequence: row!.seq, type: "order.confirmed", version: 1, subject: { type: "order", id: "o1" }, orderId: "o1",
      occurredAt: T0.toISOString(), actor: { kind: "staff", id: "u1", name: "Samira" }, origin: "dashboard",
      data: { previousStatus: "new", order: { id: "o1" } },
    });
    const [delivery] = await deliveries();
    expect(delivery).toMatchObject({ state: "delivered", attempts: 1, nextAttemptAt: null, lastError: null });
    expect(delivery!.settledAt).toBe(T0.toISOString());
    expect(await attemptsOf(delivery!.id)).toMatchObject([{ attempt: 1, outcome: "delivered", httpStatus: 200, error: null }]);
  });

  it("is made once when two drains reach the same Delivery", async () => {
    await consumer("c1", "memory", ["*"]);
    await record("o1");
    const { impl, received } = memoryKind("memory", async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { kind: "delivered" };
    });
    await run({ memory: impl });
    await d1.db.update(schema.eventDeliveries).set({ state: "due", nextAttemptAt: T0.toISOString(), attempts: 0, settledAt: null });
    received.length = 0;
    await Promise.all([run({ memory: impl }), run({ memory: impl })]);
    expect(received).toHaveLength(1);
  });

  it("is retried on the schedule, then the Delivery dies; the Consumer is marked failing", async () => {
    await consumer("c1", "memory", ["*"]);
    await record("o1");
    const { impl, received } = memoryKind("memory", () => ({ kind: "retry", error: "HTTP 503", httpStatus: 503, response: "x".repeat(5000) }));

    let now = T0;
    for (let attempt = 1; attempt <= DELIVERY_RETRIES.maxAttempts; attempt++) {
      await run({ memory: impl }, now);
      const [delivery] = await deliveries();
      expect(delivery!.attempts).toBe(attempt);
      if (attempt < DELIVERY_RETRIES.maxAttempts) {
        expect(delivery).toMatchObject({ state: "due", lastError: "HTTP 503" });
        expect(delivery!.nextAttemptAt).toBe(DELIVERY_RETRIES.nextAttemptAfter(attempt, now));
        await run({ memory: impl }, new Date(Date.parse(delivery!.nextAttemptAt!) - 1000));
        expect((await deliveries())[0]!.attempts).toBe(attempt);
        now = new Date(delivery!.nextAttemptAt!);
      } else {
        expect(delivery).toMatchObject({ state: "dead", nextAttemptAt: null });
      }
    }
    expect(received).toHaveLength(DELIVERY_RETRIES.maxAttempts);
    const attempts = await attemptsOf((await deliveries())[0]!.id);
    expect(attempts.map((a) => a.outcome)).toEqual(Array(DELIVERY_RETRIES.maxAttempts).fill("retry"));
    expect(attempts[0]!.responseExcerpt).toHaveLength(1000);
    const [c1] = await d1.db.select().from(schema.eventConsumers).all();
    expect(c1!.failingSince).toBe(T0.toISOString());
  });

  it("waits as long as the Consumer asks, when that is longer than the schedule", async () => {
    await consumer("c1", "memory", ["*"]);
    await record("o1");
    const { impl } = memoryKind("memory", () => ({ kind: "retry", error: "HTTP 429", httpStatus: 429, retryAfterSeconds: 3600 }));
    await run({ memory: impl });
    expect((await deliveries())[0]!.nextAttemptAt).toBe(at(60).toISOString());
  });

  it("dies at once when refused for good, and is retried when the kind throws", async () => {
    await consumer("refuses", "refusing", ["*"]);
    await consumer("throws", "throwing", ["*"]);
    await record("o1");
    const refusing = memoryKind("refusing", () => ({ kind: "reject", error: "HTTP 410", httpStatus: 410 }));
    const throwing: ConsumerKind = { kind: "throwing", cost: { external: 1, services: 0 }, deliver: async () => { throw new Error("socket hang up"); } };
    await run({ refusing: refusing.impl, throwing });
    const byConsumer = Object.fromEntries((await deliveries()).map((d) => [d.consumerId, d]));
    expect(byConsumer.refuses).toMatchObject({ state: "dead", lastError: "HTTP 410" });
    expect(byConsumer.throws).toMatchObject({ state: "due", lastError: "socket hang up", attempts: 1 });
  });

  it("records a skip the kind decides on", async () => {
    await consumer("c1", "memory", ["*"]);
    await record("o1");
    const { impl } = memoryKind("memory", () => ({ kind: "skipped", reason: "Not this stage" }));
    await run({ memory: impl });
    const [delivery] = await deliveries();
    expect(delivery).toMatchObject({ state: "skipped" });
    expect(await attemptsOf(delivery!.id)).toMatchObject([{ outcome: "skipped", error: "Not this stage" }]);
  });

  it("is never made to a disabled Consumer, nor by a kind this version does not have", async () => {
    await consumer("c1", "memory", ["*"]);
    await consumer("gone", "telegraph", ["*"]);
    await record("o1");
    const { impl, received } = memoryKind("memory");
    await fanOut(d1.db, T0, 100);
    await d1.db.update(schema.eventConsumers).set({ enabled: false }).where(eq(schema.eventConsumers.id, "c1"));
    await run({ memory: impl });
    const byConsumer = Object.fromEntries((await deliveries()).map((d) => [d.consumerId, d]));
    expect(received).toHaveLength(0);
    expect(byConsumer.c1).toMatchObject({ state: "skipped" });
    expect(byConsumer.gone).toMatchObject({ state: "dead", lastError: 'No consumer kind "telegraph" on this platform version' });
  });

  it("stops a Consumer that has failed for three days, and a success clears the failing mark", async () => {
    await consumer("down", "memory", ["*"], { failingSince: at(-3 * 24 * 60 - 1).toISOString() });
    await consumer("back", "memory", ["*"], { failingSince: at(-60).toISOString() });
    await record("o1");
    const { impl } = memoryKind("memory", (event) => event && ({ kind: "retry", error: "down" }));
    const recovered = memoryKind("ok");
    await d1.db.update(schema.eventConsumers).set({ kind: "ok" }).where(eq(schema.eventConsumers.id, "back"));
    await run({ memory: impl, ok: recovered.impl });
    const byId = Object.fromEntries((await d1.db.select().from(schema.eventConsumers).all()).map((c) => [c.id, c]));
    expect(byId.down).toMatchObject({ enabled: false, disabledReason: "Every delivery failed for 3 days" });
    expect(byId.back).toMatchObject({ enabled: true, failingSince: null });
  });

  it("settles nothing for a drain whose lease was taken over", async () => {
    await consumer("c1", "memory", ["*"]);
    await record("o1");
    await fanOut(d1.db, T0, 100);
    const [delivery] = await deliveries();
    const first = await claimDelivery(d1.db, delivery!.id, T0);
    expect(await claimDelivery(d1.db, delivery!.id, at(1))).toBeNull();
    const second = await claimDelivery(d1.db, delivery!.id, at(6));
    expect(second!.attempt).toBe(first!.attempt + 1);
    expect(await settleDelivery(d1.db, first!, { kind: "delivered" }, { startedAt: T0, finishedAt: at(7) })).toBeNull();
    expect(await settleDelivery(d1.db, second!, { kind: "delivered" }, { startedAt: at(6), finishedAt: at(7) })).toBe("delivered");
    expect((await attemptsOf(delivery!.id)).map((a) => a.attempt)).toEqual([2]);
    expect(first!.attempt).toBe(1);
  });
});

describe("the budget", () => {
  it("stops before the invocation's limit, says more is left, and the next drain continues", async () => {
    await consumer("c1", "heavy", ["*"]);
    for (const id of ["o1", "o2", "o3", "o4", "o5"]) await record(id);
    const { impl, received } = memoryKind("heavy", undefined, { external: 0, services: 10 });
    const budget = { external: 45, services: 40 };

    const first = await drainAndContinue(env(), { waitUntil, kinds: { heavy: impl }, budget, now: () => T0 });
    expect(first.more).toBe(true);
    expect(received.length).toBeGreaterThan(0);
    expect(received.length).toBeLessThan(5);
    expect(send).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 5 && (await workIsDue(d1.db, T0)); i++) await drain(env(), { waitUntil, kinds: { heavy: impl }, budget, now: () => T0 });
    expect(received).toHaveLength(5);
    expect((await deliveries()).every((d) => d.state === "delivered")).toBe(true);
  });

  it("never wakes again after a drain that could do nothing", async () => {
    await consumer("c1", "heavy", ["*"]);
    await record("o1");
    const { impl } = memoryKind("heavy", undefined, { external: 0, services: 1000 });
    const report = await drainAndContinue(env(), { waitUntil, kinds: { heavy: impl }, now: () => T0 });
    expect(report).toMatchObject({ fannedOut: 1, more: true });
    send.mockClear();
    const stuck = await drainAndContinue(env(), { waitUntil, kinds: { heavy: impl }, now: () => T0 });
    expect(stuck).toMatchObject({ fannedOut: 0, more: true });
    expect(send).not.toHaveBeenCalled();
  });
});

describe("the wake", () => {
  it("sends one message when work is due, and none when there is nothing", async () => {
    await wake(env());
    expect(send).not.toHaveBeenCalled();
    await record("o1");
    await wake(env());
    expect(send).toHaveBeenCalledWith({ kind: "drain" });
  });

  it("knows when a retry has come due", async () => {
    await consumer("c1", "memory", ["*"]);
    await record("o1");
    const { impl } = memoryKind("memory", () => ({ kind: "retry", error: "later" }));
    await run({ memory: impl });
    expect(await workIsDue(d1.db, at(4))).toBe(false);
    expect(await workIsDue(d1.db, at(5))).toBe(true);
  });
});

describe("retention", () => {
  it("removes settled Deliveries after 30 days and events after 90 once nothing of theirs is due", async () => {
    await consumer("c1", "memory", ["*"]);
    await record("old");
    await record("kept");
    await record("recent");
    const { impl } = memoryKind("memory", (event) => (event.orderId === "kept" ? { kind: "retry", error: "down" } : { kind: "delivered" }));
    await run({ memory: impl });
    await d1.db.update(schema.businessEvents).set({ recordedAt: "2026-07-01T00:00:00.000Z" }).where(eq(schema.businessEvents.orderId, "old"));
    await d1.db.update(schema.businessEvents).set({ recordedAt: "2026-07-01T00:00:00.000Z" }).where(eq(schema.businessEvents.orderId, "kept"));
    await d1.db.update(schema.eventDeliveries).set({ settledAt: "2026-09-01T00:00:00.000Z" }).where(eq(schema.eventDeliveries.state, "delivered"));

    expect(await pruneEventLog(d1.db, T0)).toEqual({ deliveries: 2, events: 1 });
    expect((await d1.db.select({ orderId: schema.businessEvents.orderId }).from(schema.businessEvents).all()).map((e) => e.orderId).sort()).toEqual(["kept", "recent"]);
  });
});
