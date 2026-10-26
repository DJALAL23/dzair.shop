/**
 * The Telegram App through the merchant's API and the bot's updates, on real
 * D1 with Telegram's Bot API answered at the network edge: saving a bot keeps
 * nothing unless Telegram took both steps; a chat connects only with this
 * bot's open code, once, before it expires; the bot's updates need its
 * secret; who may see and steer it; and the token never leaves the server.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenAPIHono } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import { ADMIN, apiAs, staff, type Api } from "@/test-utils/api";
import * as schema from "@/db/schema";
import type { AppContext } from "@/types";
import { errorHandler } from "@/middleware/error";
import { openApiValidationHook } from "@/openapi/validation-hook";
import webhooksRouter from "../webhooks/routes";
import { TELEGRAM_SECRET_HEADER } from "../webhooks/telegram";
import { ERROR_CODES } from "../../../../cod-shared/errors/codes";
import { pairingCodeHash } from "../../../../cod-shared/queries/telegram";
import appsRouter from "./routes";

const TOKEN = "987654321:AAunit-test-token-not-a-real-bot-Q9xZ";
const OTHER_TOKEN = "555555555:AAanother-test-token-not-real-bot-77";
const PUBLIC = { WORKER_SELF_URL: "https://api.acme.dz/" };
const T = "2026-10-26T08:00:00.000Z";

let d1: TestD1;
let admin: Api;
const as = (scopes: string[], env: Record<string, unknown> = PUBLIC) => apiAs(d1, staff(scopes), { "/api/apps": appsRouter }, env);

interface Call {
  method: string;
  url: string;
  body: Record<string, unknown>;
}
let calls: Call[];
let answers: Record<string, () => Response>;
const ok = (result: unknown) => () => Response.json({ ok: true, result });
const refuse = (status: number, description: string, parameters?: Record<string, unknown>) => () => Response.json({ ok: false, error_code: status, description, ...(parameters ? { parameters } : {}) }, { status });
const BOT = (id = 987654321, username = "acme_orders_bot") => ok({ id, is_bot: true, first_name: "Acme", username });

beforeAll(async () => {
  d1 = await createTestD1();
  admin = apiAs(d1, ADMIN, { "/api/apps": appsRouter }, PUBLIC);
}, 120_000);
afterAll(async () => d1?.dispose());

beforeEach(async () => {
  for (const table of [schema.storeTelegramConfig, schema.eventDeliveryAttempts, schema.eventDeliveries, schema.eventConsumers, schema.businessEvents, schema.stores]) await d1.db.delete(table);
  await d1.db.insert(schema.stores).values({ id: "s1", name: "Store", lang: "fr", createdAt: T, updatedAt: T });
  calls = [];
  answers = { getMe: BOT(), setWebhook: ok(true), deleteWebhook: ok(true), sendMessage: ok({ message_id: 1 }) };
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = url.split("/").at(-1)!;
    calls.push({ method, url, body: JSON.parse(String(init?.body ?? "{}")) });
    return answers[method]!();
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const configRow = () => d1.db.select().from(schema.storeTelegramConfig).get();
const consumerRow = () => d1.db.select().from(schema.eventConsumers).get();

/** Post an update as Telegram would, with this secret (or none). */
async function update(consumerId: string, body: unknown, secret: string | null) {
  const app = new OpenAPIHono<AppContext>({ defaultHook: openApiValidationHook });
  app.use("*", async (c, next) => {
    c.env = { DB: d1.raw } as never;
    await next();
  });
  app.onError(errorHandler);
  app.route("/webhooks", webhooksRouter);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (secret !== null) headers[TELEGRAM_SECRET_HEADER] = secret;
  const res = await app.request(`/webhooks/telegram/${consumerId}`, { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const start = (code: string, chatId = 4242, firstName = "Amina") => ({ update_id: 1, message: { message_id: 7, chat: { id: chatId, type: "private", first_name: firstName }, text: `/start ${code}` } });

async function saveBot(token = TOKEN) {
  const answer = await admin.put("/api/apps/telegram/bot", { token });
  expect(answer.status, JSON.stringify(answer.body)).toBe(200);
  return answer.body.data;
}

/** A saved bot and an open pairing link: its code and the secret the bot's updates carry. */
async function pairingOpen() {
  const app = await saveBot();
  const { body } = await admin.post("/api/apps/telegram/pairing");
  const code = new URL(body.data.url).searchParams.get("start")!;
  const secret = (await configRow())!.webhookSecret;
  return { consumerId: app.consumerId as string, code, secret };
}

async function connected() {
  const open = await pairingOpen();
  expect((await update(open.consumerId, start(open.code), open.secret)).status).toBe(200);
  return open;
}

describe("saving a bot", () => {
  it("checks the token, sends the bot's updates here with a secret, then keeps it — stopped until a chat is connected", async () => {
    const data = await saveBot();
    expect(calls.map((call) => call.method)).toEqual(["getMe", "setWebhook"]);
    const config = (await configRow())!;
    expect(calls[1]!.body).toEqual({ url: `https://api.acme.dz/webhooks/telegram/${config.consumerId}`, secret_token: config.webhookSecret, allowed_updates: ["message", "my_chat_member"], drop_pending_updates: true });
    expect(config.webhookSecret).toMatch(/^[A-Za-z0-9_-]{40,256}$/);
    expect(config).toMatchObject({ botToken: TOKEN, botId: 987654321, botUsername: "acme_orders_bot", chatId: null });
    expect(await consumerRow()).toMatchObject({ kind: "telegram", enabled: false, disabledReason: "not_connected", subscription: '["order.created","shipment.delivered","shipment.delivery_failed"]' });
    expect(data).toMatchObject({ enabled: false, disabledReason: "not_connected", bot: { username: "acme_orders_bot", tokenMasked: "••••Q9xZ" }, chat: null, language: null, writesIn: "fr" });
  });

  it("keeps nothing when Telegram refuses the token", async () => {
    answers.getMe = refuse(401, "Unauthorized");
    const { status, body } = await admin.put("/api/apps/telegram/bot", { token: TOKEN });
    expect(status).toBe(400);
    expect(body.code).toBe(ERROR_CODES.TELEGRAM_TOKEN_REFUSED);
    expect(calls.map((call) => call.method)).toEqual(["getMe"]);
    expect(await configRow()).toBeUndefined();
    expect(await consumerRow()).toBeUndefined();
  });

  it("keeps nothing when Telegram is unreachable", async () => {
    answers.getMe = refuse(502, "Bad Gateway");
    const { status, body } = await admin.put("/api/apps/telegram/bot", { token: TOKEN });
    expect(status).toBe(502);
    expect(body.code).toBe(ERROR_CODES.EXTERNAL_API_FAILURE);
    expect(await consumerRow()).toBeUndefined();
  });

  it("keeps nothing, and leaves a saved bot as it was, when Telegram refuses the webhook", async () => {
    answers.setWebhook = refuse(400, "Bad Request: bad webhook: Failed to resolve host");
    const { status, body } = await admin.put("/api/apps/telegram/bot", { token: TOKEN });
    expect(status).toBe(400);
    expect(body.code).toBe(ERROR_CODES.TELEGRAM_REFUSED);
    expect(body.error).toContain("Failed to resolve host");
    expect(await configRow()).toBeUndefined();
    expect(await consumerRow()).toBeUndefined();

    answers.setWebhook = ok(true);
    await connected();
    const before = await configRow();
    answers.getMe = BOT(555555555, "other_bot");
    answers.setWebhook = refuse(500, "Internal Server Error");
    expect((await admin.put("/api/apps/telegram/bot", { token: OTHER_TOKEN })).status).toBe(502);
    expect(await configRow()).toEqual(before);
    expect(await consumerRow()).toMatchObject({ enabled: true, disabledReason: null });
  });

  it("calls Telegram for nothing that is not shaped like a token, or when this server has no https URL", async () => {
    expect((await admin.put("/api/apps/telegram/bot", { token: "not-a-token" })).body.code).toBe(ERROR_CODES.TELEGRAM_TOKEN_REFUSED);
    const local = await as(["telegram:manage"], { WORKER_SELF_URL: "http://localhost:8787/" }).put("/api/apps/telegram/bot", { token: TOKEN });
    expect(local.status).toBe(409);
    expect(local.body.code).toBe(ERROR_CODES.TELEGRAM_NEEDS_PUBLIC_URL);
    expect(calls).toEqual([]);
  });

  it("keeps the chat for the same bot, and needs a chat again for another bot", async () => {
    await connected();
    await saveBot();
    expect(await configRow()).toMatchObject({ chatId: 4242, chatName: "Amina" });
    expect(await consumerRow()).toMatchObject({ enabled: true, disabledReason: null });

    answers.getMe = BOT(555555555, "other_bot");
    const data = await saveBot(OTHER_TOKEN);
    expect(data).toMatchObject({ enabled: false, disabledReason: "not_connected", chat: null, bot: { username: "other_bot" } });
    expect(await d1.db.select().from(schema.eventConsumers).all()).toHaveLength(1);
  });
});

describe("connecting a chat", () => {
  it("pairs the chat that presses Start with the open code, starts the Consumer, and the bot says so", async () => {
    const { consumerId, code, secret } = await pairingOpen();
    const { status, body } = await update(consumerId, start(code), secret);
    expect(status).toBe(200);
    expect(body).toEqual({ method: "sendMessage", chat_id: 4242, text: "✅ Connecté. Cette discussion recevra désormais les notifications de votre boutique." });
    expect(await configRow()).toMatchObject({ chatId: 4242, chatName: "Amina", pairingCodeHash: null, pairingExpiresAt: null });
    expect(await consumerRow()).toMatchObject({ enabled: true, disabledReason: null });
    expect((await admin.get("/api/apps/telegram")).body.data).toMatchObject({ enabled: true, chat: { name: "Amina" }, pairingExpiresAt: null });
  });

  it("keeps only the code's hash", async () => {
    const { code } = await pairingOpen();
    const config = (await configRow())!;
    expect(config.pairingCodeHash).toBe(await pairingCodeHash(code));
    expect(JSON.stringify(config)).not.toContain(code);
  });

  it("refuses a code used once already", async () => {
    const { consumerId, code, secret } = await connected();
    const again = await update(consumerId, start(code, 9999, "Intruder"), secret);
    expect(again.body).toMatchObject({ method: "sendMessage", chat_id: 9999, text: expect.stringContaining("ne peut plus") });
    expect(await configRow()).toMatchObject({ chatId: 4242, chatName: "Amina" });
  });

  it("refuses an expired code", async () => {
    const { consumerId, code, secret } = await pairingOpen();
    await d1.db.update(schema.storeTelegramConfig).set({ pairingExpiresAt: new Date(Date.now() - 1000).toISOString() });
    await update(consumerId, start(code), secret);
    expect(await configRow()).toMatchObject({ chatId: null });
    expect(await consumerRow()).toMatchObject({ enabled: false, disabledReason: "not_connected" });
  });

  it("refuses a code that is another Consumer's", async () => {
    const { consumerId, secret } = await pairingOpen();
    await d1.db.insert(schema.eventConsumers).values({ id: "other", kind: "telegram", name: "Telegram", enabled: false, disabledReason: "not_connected", subscription: '["order.created"]', createdAt: "2026-12-01T00:00:00.000Z", updatedAt: T });
    await d1.db.insert(schema.storeTelegramConfig).values({
      consumerId: "other", botToken: OTHER_TOKEN, botId: 5, botUsername: "other_bot", webhookSecret: "other-secret",
      pairingCodeHash: await pairingCodeHash("THE-OTHER-CODE"), pairingExpiresAt: "2099-01-01T00:00:00.000Z", createdAt: T, updatedAt: T,
    });
    await update(consumerId, start("THE-OTHER-CODE"), secret);
    expect(await d1.db.select().from(schema.storeTelegramConfig).where(eq(schema.storeTelegramConfig.consumerId, consumerId)).get()).toMatchObject({ chatId: null });
    expect(await d1.db.select().from(schema.storeTelegramConfig).where(eq(schema.storeTelegramConfig.consumerId, "other")).get()).toMatchObject({ chatId: null });
  });

  it("lets exactly one of two chats racing for one code connect", async () => {
    const { consumerId, code, secret } = await pairingOpen();
    const answers = await Promise.all([update(consumerId, start(code, 1001, "First"), secret), update(consumerId, start(code, 1002, "Second"), secret)]);
    const connectedTexts = answers.filter((answer) => answer.body.text.startsWith("✅"));
    expect(connectedTexts).toHaveLength(1);
    expect((await configRow())!.chatId).toBe(connectedTexts[0]!.body.chat_id);
  });

  it("replaces an open link with the next one", async () => {
    const { consumerId, code, secret } = await pairingOpen();
    await admin.post("/api/apps/telegram/pairing");
    await update(consumerId, start(code), secret);
    expect(await configRow()).toMatchObject({ chatId: null });
  });

  it("needs a saved bot for a link", async () => {
    const { status, body } = await admin.post("/api/apps/telegram/pairing");
    expect(status).toBe(409);
    expect(body.code).toBe(ERROR_CODES.TELEGRAM_NOT_SET_UP);
  });

  it("links to the bot with the code as its start payload", async () => {
    await saveBot();
    const { body } = await admin.post("/api/apps/telegram/pairing");
    expect(body.data.url).toMatch(/^https:\/\/t\.me\/acme_orders_bot\?start=[A-Za-z0-9_-]{32}$/);
    expect(Date.parse(body.data.expiresAt) - Date.now()).toBeGreaterThan(14 * 60_000);
  });
});

describe("the bot's updates", () => {
  it("are refused without the bot's secret, before anything changes", async () => {
    const { consumerId, code } = await pairingOpen();
    for (const secret of [null, "", "wrong-secret"]) {
      const answer = await update(consumerId, start(code), secret);
      expect(answer.status).toBe(401);
      expect(answer.body.code).toBe(ERROR_CODES.INVALID_WEBHOOK_PAYLOAD);
    }
    expect(await configRow()).toMatchObject({ chatId: null });
    expect((await update("no-such-consumer", start(code), "x")).status).toBe(401);
  });

  it("refuse a body that is not JSON, and ignore what is not a /start or a block", async () => {
    const { consumerId, secret } = await pairingOpen();
    expect((await update(consumerId, "{nope", secret)).status).toBe(400);
    expect((await update(consumerId, { update_id: 2, message: { chat: { id: 1, type: "private" }, text: "hello" } }, secret)).body).toEqual({ received: true });
    expect((await update(consumerId, { update_id: 3, message: { chat: { id: -100, type: "group" }, text: "/start abc" } }, secret)).body).toEqual({ received: true });
  });

  it("stop the Consumer when the chat blocks the bot, and start it again when it unblocks", async () => {
    const { consumerId, secret } = await connected();
    const member = (chatId: number, status: string) => ({ update_id: 9, my_chat_member: { chat: { id: chatId, type: "private" }, new_chat_member: { status } } });
    await update(consumerId, member(1234, "kicked"), secret);
    expect(await consumerRow()).toMatchObject({ enabled: true });

    await update(consumerId, member(4242, "kicked"), secret);
    expect(await consumerRow()).toMatchObject({ enabled: false, disabledReason: "bot_blocked" });
    expect((await admin.get("/api/apps")).body.data.find((app: { key: string }) => app.key === "telegram").status).toBe("needs_attention");

    await update(consumerId, member(4242, "member"), secret);
    expect(await consumerRow()).toMatchObject({ enabled: true, disabledReason: null });
  });

  it("an unblock never starts a Consumer the merchant stopped", async () => {
    const { consumerId, secret } = await connected();
    await admin.patch("/api/apps/telegram", { enabled: false });
    await update(consumerId, { update_id: 9, my_chat_member: { chat: { id: 4242, type: "private" }, new_chat_member: { status: "member" } } }, secret);
    expect(await consumerRow()).toMatchObject({ enabled: false, disabledReason: "merchant" });
  });
});

describe("the merchant's choices", () => {
  it("change the events and the language", async () => {
    await connected();
    const { body } = await admin.patch("/api/apps/telegram", { events: ["shipment.returned", "order.created"], language: "ar" });
    expect(body.data).toMatchObject({ events: ["order.created", "shipment.returned"], language: "ar", writesIn: "ar" });
    expect((await admin.patch("/api/apps/telegram", { language: null })).body.data).toMatchObject({ language: null, writesIn: "fr" });
  });

  it("refuse no events, or one Telegram cannot tell", async () => {
    await connected();
    expect((await admin.patch("/api/apps/telegram", { events: [] })).status).toBe(400);
    expect((await admin.patch("/api/apps/telegram", { events: ["order.exploded"] })).status).toBe(400);
  });

  it("turn it off and on; on needs a connected chat", async () => {
    await saveBot();
    const refused = await admin.patch("/api/apps/telegram", { enabled: true });
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe(ERROR_CODES.TELEGRAM_NOT_CONNECTED);
    await connected();
    expect((await admin.patch("/api/apps/telegram", { enabled: false })).body.data).toMatchObject({ enabled: false, disabledReason: "merchant" });
    expect((await admin.get("/api/apps")).body.data.find((app: { key: string }) => app.key === "telegram").status).toBe("off");
    expect((await admin.patch("/api/apps/telegram", { enabled: true })).body.data).toMatchObject({ enabled: true, disabledReason: null });
    expect((await admin.get("/api/apps")).body.data.find((app: { key: string }) => app.key === "telegram").status).toBe("on");
  });

  it("need a saved bot", async () => {
    expect((await admin.patch("/api/apps/telegram", { language: "en" })).body.code).toBe(ERROR_CODES.TELEGRAM_NOT_SET_UP);
  });
});

describe("a test message", () => {
  it("is sent to the connected chat in its language, and its outcome answered", async () => {
    await connected();
    calls = [];
    const { body } = await admin.post("/api/apps/telegram/test");
    expect(body.data).toEqual({ delivered: true, httpStatus: 200, reason: null, error: null });
    expect(calls).toEqual([{ method: "sendMessage", url: expect.stringContaining("/sendMessage"), body: { chat_id: 4242, text: "🔔 Message de test : votre boutique peut joindre cette discussion.", link_preview_options: { is_disabled: true } } }]);

    answers.sendMessage = refuse(403, "Forbidden: bot was blocked by the user");
    expect((await admin.post("/api/apps/telegram/test")).body.data).toEqual({ delivered: false, httpStatus: 403, reason: "blocked", error: "Telegram answered 403: Forbidden: bot was blocked by the user" });
  });

  it("needs a bot and a chat", async () => {
    expect((await admin.post("/api/apps/telegram/test")).body.code).toBe(ERROR_CODES.TELEGRAM_NOT_SET_UP);
    await saveBot();
    expect((await admin.post("/api/apps/telegram/test")).body.code).toBe(ERROR_CODES.TELEGRAM_NOT_CONNECTED);
  });
});

describe("disconnecting", () => {
  it("stops the bot's updates and forgets the bot, keeping the Consumer and its history", async () => {
    const { consumerId } = await connected();
    await d1.db.insert(schema.businessEvents).values({
      seq: 1, id: "e1", type: "order.created", version: 1, subjectType: "order", subjectId: "o1", orderId: "o1", actorKind: "system", origin: "schedule", occurredAt: T, recordedAt: T, data: "{}", fannedOutAt: T,
    });
    await d1.db.insert(schema.eventDeliveries).values({ id: "d1", eventSeq: 1, consumerId, state: "delivered", attempts: 1, createdAt: T, settledAt: T });
    calls = [];
    const { status, body } = await admin.delete("/api/apps/telegram");
    expect(status).toBe(200);
    expect(body.data).toEqual({ updatesStopped: true, error: null });
    expect(calls.map((call) => call.method)).toEqual(["deleteWebhook"]);
    expect(await configRow()).toBeUndefined();
    expect(await consumerRow()).toMatchObject({ id: consumerId, enabled: false, disabledReason: "merchant" });
    expect(await d1.db.select().from(schema.eventDeliveries).all()).toHaveLength(1);
    expect((await admin.get("/api/apps")).body.data.find((app: { key: string }) => app.key === "telegram").status).toBe("not_set_up");
  });

  it("forgets the bot even when Telegram cannot be told, and says so", async () => {
    await connected();
    answers.deleteWebhook = refuse(401, "Unauthorized");
    const { body } = await admin.delete("/api/apps/telegram");
    expect(body.data).toEqual({ updatesStopped: false, error: "Telegram answered 401: Unauthorized" });
    expect(await configRow()).toBeUndefined();
  });

  it("does nothing, and calls Telegram for nothing, before a bot was saved", async () => {
    expect((await admin.delete("/api/apps/telegram")).body).toEqual({ success: true, data: { updatesStopped: true, error: null } });
    expect(calls).toEqual([]);
    expect(await consumerRow()).toBeUndefined();
  });

  it("refuses the old bot's updates afterwards", async () => {
    const { consumerId, secret } = await connected();
    await admin.delete("/api/apps/telegram");
    expect((await update(consumerId, start("x"), secret)).status).toBe(401);
  });
});

describe("who may see and steer the Telegram App", () => {
  it("takes telegram:read to see it — never the token — and telegram:manage to change it", async () => {
    await connected();
    const reader = as(["telegram:read"]);
    const seen = await reader.get("/api/apps/telegram");
    expect(seen.status).toBe(200);
    expect(seen.body.data.bot.tokenMasked).toBe("••••Q9xZ");
    calls = [];
    expect((await reader.put("/api/apps/telegram/bot", { token: TOKEN })).status).toBe(403);
    expect((await reader.post("/api/apps/telegram/pairing")).status).toBe(403);
    expect((await reader.post("/api/apps/telegram/test")).status).toBe(403);
    expect((await reader.patch("/api/apps/telegram", { language: "en" })).status).toBe(403);
    expect((await reader.delete("/api/apps/telegram")).status).toBe(403);
    expect(calls).toEqual([]);
  });

  it("answers 403 to someone without it, and calls Telegram for nothing", async () => {
    await connected();
    calls = [];
    const stranger = as(["sendili:manage", "integrations:manage"]);
    expect((await stranger.get("/api/apps/telegram")).status).toBe(403);
    expect((await stranger.put("/api/apps/telegram/bot", { token: TOKEN })).status).toBe(403);
    expect((await stranger.post("/api/apps/telegram/pairing")).status).toBe(403);
    expect((await stranger.post("/api/apps/telegram/test")).status).toBe(403);
    expect((await stranger.patch("/api/apps/telegram", { enabled: false })).status).toBe(403);
    expect((await stranger.delete("/api/apps/telegram")).status).toBe(403);
    expect(calls).toEqual([]);
    expect(await consumerRow()).toMatchObject({ enabled: true });
  });
});

describe("the bot token", () => {
  it("is in no answer and no log line, whatever happens", async () => {
    const logged: unknown[] = [];
    for (const level of ["log", "info", "warn", "error", "debug"] as const) vi.spyOn(console, level).mockImplementation((...args) => void logged.push(args));
    const seen: unknown[] = [];
    seen.push((await admin.put("/api/apps/telegram/bot", { token: TOKEN })).body);
    const { code, secret, consumerId } = { ...(await (async () => {
      const { body } = await admin.post("/api/apps/telegram/pairing");
      return { code: new URL(body.data.url).searchParams.get("start")!, secret: (await configRow())!.webhookSecret, consumerId: (await consumerRow())!.id };
    })()) };
    seen.push((await update(consumerId, start(code), secret)).body);
    seen.push((await admin.get("/api/apps/telegram")).body, (await admin.get("/api/apps")).body);
    answers.sendMessage = () => {
      throw new TypeError(`connect failed https://api.telegram.org/bot${TOKEN}/sendMessage`);
    };
    seen.push((await admin.post("/api/apps/telegram/test")).body);
    answers.getMe = refuse(401, "Unauthorized");
    seen.push((await admin.put("/api/apps/telegram/bot", { token: TOKEN })).body);
    answers.getMe = () => {
      throw new TypeError(`fetch failed https://api.telegram.org/bot${TOKEN}/getMe`);
    };
    seen.push((await admin.put("/api/apps/telegram/bot", { token: TOKEN })).body);
    seen.push((await admin.delete("/api/apps/telegram")).body);
    const secretPart = TOKEN.split(":")[1]!;
    expect(JSON.stringify(seen)).not.toContain(secretPart);
    expect(JSON.stringify(logged)).not.toContain(secretPart);
    expect(JSON.stringify(seen)).not.toContain(secret);
  });
});
