/**
 * The Event Log and the Deliveries as an AI agent reads them, on real D1:
 * each tool's answer matches the output schema it advertises, a bad argument
 * is a failure the agent can act on, and no answer carries a secret.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import { sampleOrder } from "@/test-utils/events";
import * as schema from "@/db/schema";
import { EVENT_CATALOGUE, type EventType } from "../../../../cod-shared/events/catalogue";
import { EVENT_TOOL_OUTPUT_SCHEMAS, getEventTools } from "./ai-tools";

let d1: TestD1;
const T = "2026-10-25T10:00:00.000Z";

beforeAll(async () => {
  d1 = await createTestD1();
}, 120_000);

afterAll(async () => d1?.dispose());

beforeEach(async () => {
  for (const table of [schema.eventDeliveryAttempts, schema.eventDeliveries, schema.eventConsumers, schema.businessEvents]) await d1.db.delete(table);
  await d1.db.run(sql`DELETE FROM sqlite_sequence WHERE name = 'business_events'`);
  const types: EventType[] = ["order.created", "order.confirmed", "shipment.handed_off", "order.created"];
  for (const [i, type] of types.entries()) {
    const orderId = i === 3 ? "o2" : "o1";
    await d1.db.insert(schema.businessEvents).values({
      id: `evt_${i + 1}`, type, version: 1, subjectType: EVENT_CATALOGUE[type].subject, subjectId: orderId, orderId, actorKind: "agent", actorId: "u1", actorName: "Nadia",
      origin: "agent", occurredAt: T, recordedAt: T, data: JSON.stringify({ order: { ...sampleOrder, id: orderId }, previousStatus: "new" }),
    });
  }
  await d1.db.insert(schema.eventConsumers).values({ id: "hook", kind: "memory", name: "Hook", subscription: '["*"]', settings: '{"token":"kind-secret"}', signingSecret: "whsec_hidden", createdAt: T, updatedAt: T });
  for (const seq of [1, 2]) {
    await d1.db.insert(schema.eventDeliveries).values({ id: `d${seq}`, consumerId: "hook", eventSeq: seq, state: seq === 1 ? "dead" : "delivered", attempts: seq === 1 ? 8 : 1, lastError: seq === 1 ? "HTTP 500" : null, createdAt: T, settledAt: T });
  }
});

async function run(name: "listBusinessEvents" | "listEventConsumers" | "listEventDeliveries", args: Record<string, unknown> = {}) {
  const tools = getEventTools(d1.db);
  const result = await (tools[name].execute as (args: unknown, options: unknown) => Promise<any>)(args, { toolCallId: "t", messages: [] });
  expect(EVENT_TOOL_OUTPUT_SCHEMAS[name]!.safeParse(result).error).toBeUndefined();
  return result;
}

describe("listBusinessEvents", () => {
  it("reads the log newest first, or forward from a Sequence", async () => {
    expect((await run("listBusinessEvents")).events.map((e: { id: string }) => e.id)).toEqual(["evt_4", "evt_3", "evt_2", "evt_1"]);
    const forward = await run("listBusinessEvents", { after: 0, limit: 2 });
    expect(forward.events.map((e: { id: string }) => e.id)).toEqual(["evt_1", "evt_2"]);
    expect(forward.nextCursor).toBe(2);
  });

  it("narrows to an order and to types", async () => {
    expect((await run("listBusinessEvents", { orderId: "o1", type: "order.*" })).events.map((e: { id: string }) => e.id)).toEqual(["evt_2", "evt_1"]);
    expect((await run("listBusinessEvents", { type: "shipment.handed_off" })).events[0]).toMatchObject({ id: "evt_3", actor: { kind: "agent", name: "Nadia" }, origin: "agent" });
  });

  it("answers a bad argument with a failure the agent can act on", async () => {
    expect(await run("listBusinessEvents", { type: "order.everything" })).toMatchObject({ success: false, error: expect.stringContaining("type") });
    expect(await run("listBusinessEvents", { after: 1, before: 3 })).toEqual({ success: false, error: "Give after or before, not both" });
    expect(await run("listBusinessEvents", { limit: 500 })).toMatchObject({ success: false });
  });
});

describe("listEventConsumers and listEventDeliveries", () => {
  it("show who receives the events and what failed, never a secret", async () => {
    const consumers = await run("listEventConsumers");
    expect(consumers.consumers).toEqual([expect.objectContaining({ id: "hook", enabled: true, deliveries: { due: 0, dead: 1 } })]);
    const dead = await run("listEventDeliveries", { consumerId: "hook", state: "dead" });
    expect(dead.deliveries.map((d: { id: string; lastError: string }) => [d.id, d.lastError])).toEqual([["d1", "HTTP 500"]]);
    const text = JSON.stringify([consumers, dead]);
    expect(text).not.toContain("whsec_hidden");
    expect(text).not.toContain("kind-secret");
  });

  it("asks for the Consumer", async () => {
    expect(await run("listEventDeliveries", {})).toMatchObject({ success: false, error: expect.stringContaining("consumerId") });
  });
});
