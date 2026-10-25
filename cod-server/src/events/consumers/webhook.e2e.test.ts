/**
 * A webhook Consumer through the real drain and the real Consumer Kinds on
 * one D1: what the merchant's endpoint receives is the published Business
 * Event, signed; each Attempt is recorded with what the endpoint answered;
 * a 410 stops the Consumer and what was waiting for it is skipped; a
 * Retry-After pushes the next Attempt back.
 */
import { createHmac } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { asc, eq } from "drizzle-orm";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import { sampleOrder } from "@/test-utils/events";
import * as schema from "@/db/schema";
import type { Env } from "@/types";
import { BUSINESS_EVENT_SCHEMA } from "@/events/catalogue";
import { drain } from "@/events/drain";
import { recordEvent } from "../../../../cod-shared/events/record";
import { readBusinessEvent } from "../../../../cod-shared/events/log";
import { DELIVERY_RETRIES } from "../../../../cod-shared/events/deliveries";
import { WEBHOOK_KIND } from "./webhook";

const SECRET = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
const T0 = new Date("2026-10-25T10:00:00.000Z");
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

let d1: TestD1;
let answer: () => Response;
const received: Array<{ url: string; headers: Headers; body: string }> = [];

beforeAll(async () => {
  d1 = await createTestD1();
}, 120_000);
afterAll(async () => d1?.dispose());

beforeEach(async () => {
  for (const table of [schema.eventDeliveryAttempts, schema.eventDeliveries, schema.eventConsumers, schema.businessEvents]) await d1.db.delete(table);
  received.length = 0;
  answer = () => new Response("ok");
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    received.push({ url, headers: new Headers(init.headers), body: String(init.body) });
    return answer();
  });
  await d1.db.insert(schema.eventConsumers).values({
    id: "hook", kind: WEBHOOK_KIND, name: "Order system", subscription: '["order.*"]', settings: JSON.stringify({ url: "https://erp.example.dz/hooks" }),
    signingSecret: SECRET, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
  });
});
afterEach(() => vi.unstubAllGlobals());

const record = (orderId: string) =>
  d1.db.batch([
    recordEvent(d1.db, {
      type: "order.confirmed", subjectId: orderId, orderId, occurredAt: T0.toISOString(), actor: { kind: "staff", id: "u1", name: "Samira" }, origin: "dashboard",
      data: { order: { ...sampleOrder, id: orderId }, previousStatus: "new" },
    }),
  ]);
const run = (now: Date) => drain({ DB: d1.raw, EVENTS_QUEUE: { send: async () => {} } } as unknown as Env, { now: () => now });
const deliveries = () => d1.db.select().from(schema.eventDeliveries).orderBy(asc(schema.eventDeliveries.eventSeq)).all();
const consumerRow = async () => (await d1.db.select().from(schema.eventConsumers).where(eq(schema.eventConsumers.id, "hook")).get())!;

describe("a webhook Consumer", () => {
  it("receives the published Business Event, signed, and the Attempt keeps what it answered", async () => {
    await record("o1");
    answer = () => new Response('{"received":true}', { status: 202 });
    const report = await run(T0);

    expect(report.attempts.delivered).toBe(1);
    const [request] = received;
    expect(request!.url).toBe("https://erp.example.dz/hooks");
    const published = await readBusinessEvent(d1.db, request!.headers.get("webhook-id")!);
    expect(JSON.parse(request!.body)).toEqual(published);
    expect(BUSINESS_EVENT_SCHEMA.parse(JSON.parse(request!.body))).toEqual(published);
    const timestamp = request!.headers.get("webhook-timestamp");
    expect(timestamp).toBe(String(T0.getTime() / 1000));
    const expected = createHmac("sha256", Buffer.from(SECRET.slice(6), "base64")).update(`${published!.id}.${timestamp}.${request!.body}`).digest("base64");
    expect(request!.headers.get("webhook-signature")).toBe(`v1,${expected}`);

    const [delivery] = await deliveries();
    expect(delivery).toMatchObject({ state: "delivered", attempts: 1, lastError: null });
    const [attempt] = await d1.db.select().from(schema.eventDeliveryAttempts).all();
    expect(attempt).toMatchObject({ outcome: "delivered", httpStatus: 202, responseExcerpt: '{"received":true}', error: null });
  });

  it("answered 410: the Delivery is dead, the Consumer stops as gone, and what waited for it is skipped", async () => {
    await record("o1");
    await record("o2");
    let calls = 0;
    answer = () => (++calls === 1 ? new Response("endpoint removed", { status: 410 }) : new Response("ok"));
    await run(T0);

    expect(calls).toBe(1);
    expect((await deliveries()).map((d) => d.state)).toEqual(["dead", "skipped"]);
    expect(await consumerRow()).toMatchObject({ enabled: false, disabledReason: "gone", failingSince: T0.toISOString() });
    const attempts = await d1.db.select().from(schema.eventDeliveryAttempts).orderBy(asc(schema.eventDeliveryAttempts.attemptedAt)).all();
    expect(attempts.map((a) => [a.outcome, a.httpStatus])).toEqual([["reject", 410], ["skipped", null]]);

    await record("o3");
    await run(at(1));
    expect(await deliveries()).toHaveLength(2);
  });

  it("answered 429 with Retry-After: due again no sooner than it asked", async () => {
    await record("o1");
    answer = () => new Response(null, { status: 429, headers: { "retry-after": "7200" } });
    await run(T0);
    const [delivery] = await deliveries();
    expect(delivery).toMatchObject({ state: "due", attempts: 1, lastError: "HTTP 429", nextAttemptAt: at(120).toISOString() });
    expect((await consumerRow()).enabled).toBe(true);
  });

  it("answered 500: due again on the schedule, and delivered when the endpoint recovers", async () => {
    await record("o1");
    answer = () => new Response("down", { status: 500 });
    await run(T0);
    const [first] = await deliveries();
    expect(first).toMatchObject({ state: "due", lastError: "HTTP 500", nextAttemptAt: DELIVERY_RETRIES.nextAttemptAfter(1, T0) });

    answer = () => new Response("ok");
    await run(at(5));
    expect(await deliveries()).toMatchObject([{ state: "delivered", attempts: 2 }]);
    expect((await consumerRow()).failingSince).toBeNull();
    expect(new Set(received.map((r) => r.headers.get("webhook-id"))).size).toBe(1);
  });

  it("whose URL became private is never called: the Delivery is dead", async () => {
    await d1.db.update(schema.eventConsumers).set({ settings: JSON.stringify({ url: "https://10.0.0.5/hooks" }) });
    await record("o1");
    await run(T0);
    expect(received).toEqual([]);
    expect(await deliveries()).toMatchObject([{ state: "dead", lastError: "The endpoint's URL is refused (private_host): use a public https URL" }]);
    expect((await consumerRow()).enabled).toBe(true);
  });
});
