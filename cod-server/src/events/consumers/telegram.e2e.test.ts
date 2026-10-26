/**
 * A Telegram Consumer through the real drain and the real Consumer Kinds on
 * one D1, with Telegram's Bot API answered at the network edge: what the chat
 * receives, in which language, and what each of Telegram's answers does to
 * the Delivery, the Consumer and the Telegram App's status.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { asc } from "drizzle-orm";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import { sampleOrder } from "@/test-utils/events";
import * as schema from "@/db/schema";
import type { Env } from "@/types";
import { drain } from "@/events/drain";
import { recordEvent } from "../../../../cod-shared/events/record";
import { DELIVERY_RETRIES } from "../../../../cod-shared/events/deliveries";
import { appStatuses } from "../../../../cod-shared/queries/apps";
import { telegram } from "./telegram";

const TOKEN = "987654321:AAunit-test-token-not-a-real-bot-Q9xZ";
const T0 = new Date("2026-10-25T10:00:00.000Z");
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);
const OLD = "2026-01-01T00:00:00.000Z";

let d1: TestD1;
let answer: () => Response | Promise<Response>;
const sent: Array<{ url: string; body: { chat_id: number; text: string } & Record<string, unknown> }> = [];

const refuse = (status: number, description: string, parameters?: Record<string, unknown>) => () => Response.json({ ok: false, error_code: status, description, ...(parameters ? { parameters } : {}) }, { status });

beforeAll(async () => {
  d1 = await createTestD1();
}, 120_000);
afterAll(async () => d1?.dispose());

beforeEach(async () => {
  for (const table of [schema.storeTelegramConfig, schema.eventDeliveryAttempts, schema.eventDeliveries, schema.eventConsumers, schema.businessEvents, schema.stores]) await d1.db.delete(table);
  await d1.db.insert(schema.stores).values({ id: "s1", name: "Store", lang: "ar", createdAt: OLD, updatedAt: OLD });
  sent.length = 0;
  answer = () => Response.json({ ok: true, result: { message_id: 10 } });
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    sent.push({ url, body: JSON.parse(String(init.body)) });
    return answer();
  });
  await d1.db.insert(schema.eventConsumers).values({
    id: "tg", kind: "telegram", name: "Telegram", subscription: '["order.created","shipment.delivered","shipment.delivery_failed"]', settings: '{"language":null}', createdAt: OLD, updatedAt: OLD,
  });
  await d1.db.insert(schema.storeTelegramConfig).values({
    consumerId: "tg", botToken: TOKEN, botId: 987654321, botUsername: "acme_orders_bot", webhookSecret: "secret", chatId: 4242, chatName: "Amina", connectedAt: OLD, createdAt: OLD, updatedAt: OLD,
  });
});
afterEach(() => vi.unstubAllGlobals());

const record = (orderId: string, type: "order.created" | "order.confirmed" = "order.created") =>
  d1.db.batch([
    type === "order.created"
      ? recordEvent(d1.db, { type, subjectId: orderId, orderId, occurredAt: T0.toISOString(), actor: { kind: "shopper", id: null, name: null }, origin: "storefront", data: { order: { ...sampleOrder, id: orderId } } })
      : recordEvent(d1.db, { type, subjectId: orderId, orderId, occurredAt: T0.toISOString(), actor: { kind: "staff", id: "u1", name: "Samira" }, origin: "dashboard", data: { order: { ...sampleOrder, id: orderId }, previousStatus: "new" } }),
  ]);
const run = (now: Date) => drain({ DB: d1.raw, EVENTS_QUEUE: { send: async () => {} } } as unknown as Env, { now: () => now });
const deliveries = () => d1.db.select().from(schema.eventDeliveries).orderBy(asc(schema.eventDeliveries.eventSeq)).all();
const attempts = () => d1.db.select().from(schema.eventDeliveryAttempts).orderBy(asc(schema.eventDeliveryAttempts.attemptedAt)).all();
const consumer = async () => (await d1.db.select().from(schema.eventConsumers).get())!;
const status = async () => (await appStatuses(d1.db, "s1")).telegram;

describe("a Telegram Consumer", () => {
  it("costs one call to Telegram and one D1 trip beside the Delivery's own", () => {
    expect(telegram.cost).toEqual({ external: 1, services: 1 });
  });

  it("sends the event to the connected chat as plain text, in the store's language, and the Delivery is delivered", async () => {
    await record("o1");
    expect((await run(T0)).attempts.delivered).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`);
    expect(sent[0]!.body).toMatchObject({ chat_id: 4242, link_preview_options: { is_disabled: true } });
    expect(sent[0]!.body).not.toHaveProperty("parse_mode");
    expect(sent[0]!.body.text).toMatch(/^🛒 طلب جديد رقم /);
    expect(await deliveries()).toMatchObject([{ state: "delivered", attempts: 1, lastError: null }]);
    expect(await attempts()).toMatchObject([{ outcome: "delivered", httpStatus: 200, error: null }]);
    expect(await status()).toBe("on");
  });

  it("writes in the language the merchant chose", async () => {
    await d1.db.update(schema.eventConsumers).set({ settings: '{"language":"en"}' });
    await record("o1");
    await run(T0);
    expect(sent[0]!.body.text).toMatch(/^🛒 New order #/);
  });

  it("tells only the events it subscribes to", async () => {
    await record("o1", "order.confirmed");
    await run(T0);
    expect(sent).toEqual([]);
    expect(await deliveries()).toEqual([]);
  });

  it("answered 429: due again no sooner than Telegram's retry_after, and never sooner than the schedule", async () => {
    await record("o1");
    answer = refuse(429, "Too Many Requests: retry after 7200", { retry_after: 7200 });
    await run(T0);
    expect(await deliveries()).toMatchObject([{ state: "due", attempts: 1, lastError: "Telegram answered 429: Too Many Requests: retry after 7200", nextAttemptAt: at(120).toISOString() }]);
    expect(await attempts()).toMatchObject([{ outcome: "retry", httpStatus: 429 }]);

    await d1.db.delete(schema.eventDeliveryAttempts);
    await d1.db.delete(schema.eventDeliveries);
    await record("o2");
    answer = refuse(429, "Too Many Requests: retry after 3", { retry_after: 3 });
    await run(T0);
    expect((await deliveries()).at(-1)).toMatchObject({ state: "due", nextAttemptAt: DELIVERY_RETRIES.nextAttemptAfter(1, T0) });
    expect((await consumer()).enabled).toBe(true);
  });

  it("answered 403: the Delivery is dead, the Consumer stops as bot_blocked, and what waited is skipped", async () => {
    await record("o1");
    await record("o2");
    let calls = 0;
    answer = () => (++calls === 1 ? refuse(403, "Forbidden: bot was blocked by the user")() : Response.json({ ok: true, result: { message_id: 1 } }));
    await run(T0);
    expect(calls).toBe(1);
    expect((await deliveries()).map((d) => d.state)).toEqual(["dead", "skipped"]);
    expect(await consumer()).toMatchObject({ enabled: false, disabledReason: "bot_blocked" });
    expect((await attempts()).map((a) => [a.outcome, a.httpStatus, a.error])).toEqual([
      ["reject", 403, "Telegram answered 403: Forbidden: bot was blocked by the user"],
      ["skipped", null, "The consumer is disabled"],
    ]);
    expect(await status()).toBe("needs_attention");
  });

  it("answered 400 chat not found: the Delivery is dead and the App needs attention", async () => {
    await record("o1");
    answer = refuse(400, "Bad Request: chat not found");
    await run(T0);
    expect(await deliveries()).toMatchObject([{ state: "dead", lastError: "Telegram answered 400: Bad Request: chat not found" }]);
    expect(await consumer()).toMatchObject({ enabled: true, failingSince: T0.toISOString() });
    expect(await status()).toBe("needs_attention");
  });

  it("answered 401: the Delivery is dead and the App needs attention", async () => {
    await record("o1");
    answer = refuse(401, "Unauthorized");
    await run(T0);
    expect(await deliveries()).toMatchObject([{ state: "dead", lastError: "Telegram answered 401: Unauthorized" }]);
    expect(await consumer()).toMatchObject({ failingSince: T0.toISOString() });
    expect(await status()).toBe("needs_attention");
  });

  it("answered 5xx, or no answer in time: due again on the schedule, then delivered", async () => {
    await record("o1");
    answer = refuse(502, "Bad Gateway");
    await run(T0);
    expect(await deliveries()).toMatchObject([{ state: "due", lastError: "Telegram answered 502: Bad Gateway", nextAttemptAt: DELIVERY_RETRIES.nextAttemptAfter(1, T0) }]);

    answer = () => {
      throw Object.assign(new Error("aborted"), { name: "TimeoutError" });
    };
    await run(at(5));
    expect(await deliveries()).toMatchObject([{ state: "due", attempts: 2, lastError: "Telegram did not answer within 10 s" }]);

    answer = () => Response.json({ ok: true, result: { message_id: 3 } });
    await run(at(40));
    expect(await deliveries()).toMatchObject([{ state: "delivered", attempts: 3 }]);
    expect((await consumer()).failingSince).toBeNull();
  });

  it("with no chat connected: Skipped, with that reason", async () => {
    await d1.db.update(schema.storeTelegramConfig).set({ chatId: null, connectedAt: null });
    await record("o1");
    await run(T0);
    expect(sent).toEqual([]);
    expect(await deliveries()).toMatchObject([{ state: "skipped" }]);
    expect(await attempts()).toMatchObject([{ outcome: "skipped", error: "No Telegram chat is connected yet" }]);
  });

  it("with its bot forgotten: Skipped, with that reason", async () => {
    await record("o1");
    await d1.db.delete(schema.storeTelegramConfig);
    await run(T0);
    expect(sent).toEqual([]);
    expect(await attempts()).toMatchObject([{ outcome: "skipped", error: "No Telegram bot is saved: it was disconnected" }]);
  });

  it("puts the token in no Attempt", async () => {
    await record("o1");
    answer = () => {
      throw new TypeError(`connect failed https://api.telegram.org/bot${TOKEN}/sendMessage`);
    };
    await run(T0);
    const recorded = JSON.stringify([await deliveries(), await attempts()]);
    expect(recorded).toContain("Telegram could not be reached");
    expect(recorded).not.toContain(TOKEN.split(":")[1]);
  });
});
