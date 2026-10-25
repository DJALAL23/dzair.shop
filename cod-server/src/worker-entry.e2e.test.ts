/**
 * The Worker's own entry points and the events queue (ADR 0017), on real D1:
 * a request that may have written wakes the drain; one that only reads does
 * not; the queue's message drains. Through the real `index.ts` export.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import { sampleOrder } from "@/test-utils/events";
import * as schema from "@/db/schema";
import { recordEvent } from "../../cod-shared/events/record";
import worker from "./index";

let d1: TestD1;
const send = vi.fn(async () => {});
const pending: Array<Promise<unknown>> = [];
const env = () =>
  ({
    DB: d1.raw,
    EVENTS_QUEUE: { send },
    WORKER_SELF_URL: "https://api.store.test/",
    OAUTH_KV: { get: async () => null, put: async () => {}, delete: async () => {}, list: async () => ({ keys: [], list_complete: true }) },
    ENVIRONMENT: "test",
    ALLOWED_ORIGINS: "*",
  }) as never;
const ctx = () => ({ waitUntil: (p: Promise<unknown>) => void pending.push(p), passThroughOnException() {} }) as never;
const settled = async () => {
  while (pending.length) await Promise.all(pending.splice(0));
};

beforeAll(async () => {
  d1 = await createTestD1();
}, 120_000);

afterAll(async () => d1?.dispose());

beforeEach(async () => {
  for (const table of [schema.eventDeliveries, schema.eventConsumers, schema.businessEvents]) await d1.db.delete(table);
  send.mockClear();
});

async function pendingWork() {
  await d1.db.batch([
    recordEvent(d1.db, {
      type: "order.created", subjectId: "o1", orderId: "o1", occurredAt: new Date().toISOString(),
      actor: { kind: "system", id: null, name: null }, origin: "schedule", data: { order: { ...sampleOrder, id: "o1" } },
    }),
  ]);
}

describe("the Worker", () => {
  it("wakes the drain after a request that may have written, when work is due", async () => {
    await pendingWork();
    await worker.fetch(new Request("https://api.store.test/webhooks/yalidine", { method: "POST", body: "{}" }), env(), ctx());
    await settled();
    expect(send).toHaveBeenCalledWith({ kind: "drain" });
  });

  it("never wakes it for a request that only reads", async () => {
    await pendingWork();
    for (const method of ["GET", "HEAD", "OPTIONS"]) await worker.fetch(new Request("https://api.store.test/health", { method }), env(), ctx());
    await settled();
    expect(send).not.toHaveBeenCalled();
  });

  it("does not wake it when nothing is due", async () => {
    await worker.fetch(new Request("https://api.store.test/health", { method: "POST" }), env(), ctx());
    await settled();
    expect(send).not.toHaveBeenCalled();
  });

  it("drains when the queue's message arrives", async () => {
    await pendingWork();
    await worker.queue({ messages: [{ body: { kind: "drain" } }], ackAll() {}, retryAll() {} } as never, env());
    const [event] = await d1.db.select().from(schema.businessEvents).all();
    expect(event!.fannedOutAt).not.toBeNull();
  });
});
