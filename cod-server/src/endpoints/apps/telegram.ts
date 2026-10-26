/**
 * The Telegram App (ADR 0020): the merchant's own bot tells their team what
 * happens in the store. They paste the token @BotFather gave them; the store
 * checks it with Telegram and has the bot's updates sent to it; they open a
 * pairing link and press Start, which connects their chat. The token never
 * leaves the server.
 */

import { OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { AppContext } from "@/types";
import { getDb } from "@/db";
import { defineRoute } from "@/lib/route-builder";
import { AppError, ExternalApiError } from "@/lib/errors/classes";
import { telegramClient, type TelegramFailure } from "@/lib/telegram";
import { ERROR_CATEGORIES, ERROR_CODES, type ErrorCode } from "../../../../cod-shared/errors/codes";
import { SCOPES } from "../../../../cod-shared/rbac/scopes";
import { CONSUMER_DISABLED_REASONS } from "../../../../cod-shared/events/deliveries-model";
import { STORE_LOCALES } from "../../../../cod-shared/i18n/locales";
import { MESSAGE_LANGUAGES } from "../../../../cod-shared/events/messages";
import { TELEGRAM_EVENT_TYPES, isBotTokenShape } from "../../../../cod-shared/events/telegram";
import { forgetTelegramBot, openPairing, readTelegram, readTelegramBot, saveTelegramBot, telegramConsumerId, updateTelegram } from "../../../../cod-shared/queries/telegram";
import { bodyOf, jsonContent } from "./shared";

export const telegramBotSchema = z.object({
  token: z.string().trim().min(1).max(200).openapi({ description: "The bot token @BotFather gave. Checked with Telegram before anything is kept; never sent back." }),
});

export const telegramChangeSchema = z
  .object({
    events: z
      .array(z.enum(TELEGRAM_EVENT_TYPES as [string, ...string[]]))
      .min(1)
      .optional()
      .openapi({ description: "The Event Types the bot tells, one or more", example: ["order.created", "shipment.delivered"] }),
    language: z.enum(STORE_LOCALES).nullable().optional().openapi({ description: "The language messages are written in; null for the store's primary language" }),
    enabled: z.boolean().optional().openapi({ description: "On or off. Turning it on needs a connected chat." }),
  })
  .openapi("TelegramChange");

const TelegramSchema = z
  .object({
    consumerId: z.string().openapi({ description: "The Telegram Consumer the bot sends through: its deliveries are under /api/event-deliveries" }),
    enabled: z.boolean(),
    disabledReason: z.enum(CONSUMER_DISABLED_REASONS).nullable().openapi({ description: "Why it is off: `not_connected` (no chat yet), `bot_blocked` (the chat blocked the bot), `merchant`, `failing`; null while on" }),
    failingSince: z.string().nullable().openapi({ description: "Since when every message has failed; null once one is delivered" }),
    bot: z
      .object({
        id: z.number().int(),
        username: z.string().openapi({ example: "acme_orders_bot" }),
        tokenMasked: z.string().openapi({ description: "The bot token, masked: it is never sent back", example: "••••x9Qa", "x-credential": "masked" }),
      })
      .nullable()
      .openapi({ description: "The saved bot; null once it was disconnected" }),
    chat: z.object({ name: z.string().nullable().openapi({ example: "Amina Benali" }), connectedAt: z.string() }).nullable().openapi({ description: "The connected chat; null until someone presses Start on a pairing link" }),
    pairingExpiresAt: z.string().nullable().openapi({ description: "Until when the latest pairing link works; null when none is open" }),
    events: z.array(z.string()).openapi({ example: ["order.created", "shipment.delivered", "shipment.delivery_failed"] }),
    language: z.enum(STORE_LOCALES).nullable(),
    writesIn: z.enum(STORE_LOCALES).openapi({ description: "The language messages are written in now" }),
  })
  .openapi("TelegramApp");

const answer = <T extends z.ZodType>(data: T) => jsonContent(z.object({ success: z.boolean(), data }));

function telegramRefused(code: ErrorCode, message: string, status: 400 | 409) {
  return new AppError(message, code, ERROR_CATEGORIES.BUSINESS_LOGIC, status);
}

/** Telegram's refusal, in an error the merchant can act on; a passing failure is Telegram being unreachable. */
function failed(step: string, result: TelegramFailure): AppError {
  if (result.kind === "retry") return new ExternalApiError("telegram", `${step}: ${result.error}`);
  if (result.reason === "unauthorized") return telegramRefused(ERROR_CODES.TELEGRAM_TOKEN_REFUSED, `Telegram refused the token: ${result.error}`, 400);
  return telegramRefused(ERROR_CODES.TELEGRAM_REFUSED, `${step}: ${result.error}`, 400);
}

/** Where Telegram sends the bot's updates: this server's public origin, which Telegram needs to be https. */
function updatesUrl(c: Context<AppContext>, consumerId: string): string {
  let origin: URL | null = null;
  try {
    origin = new URL(c.env.WORKER_SELF_URL ?? "");
  } catch {
    origin = null;
  }
  if (origin?.protocol !== "https:") {
    throw telegramRefused(ERROR_CODES.TELEGRAM_NEEDS_PUBLIC_URL, "Telegram sends a bot's updates only to https: set this server's public URL (WORKER_SELF_URL)", 409);
  }
  return `${origin.origin}/webhooks/telegram/${consumerId}`;
}

function newWebhookSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function view(c: Context<AppContext>) {
  return readTelegram(getDb(c.env.DB), new Date());
}

async function getTelegram(c: Context<AppContext>) {
  return c.json({ success: true, data: await view(c) }, 200);
}

/** Check the token with Telegram, point the bot's updates here, and only then keep it: a refusal at either step keeps nothing. */
async function saveBot(c: Context<AppContext>) {
  const { token } = bodyOf<typeof telegramBotSchema>(c);
  if (!isBotTokenShape(token)) throw telegramRefused(ERROR_CODES.TELEGRAM_TOKEN_REFUSED, "This is not a bot token: @BotFather gives one like 123456789:AA…", 400);
  const db = getDb(c.env.DB);
  const consumerId = (await telegramConsumerId(db)) ?? crypto.randomUUID();
  const url = updatesUrl(c, consumerId);

  const telegram = telegramClient(token, fetch);
  const me = await telegram.getMe();
  if (!me.ok) throw failed("Checking the token", me);
  const webhookSecret = newWebhookSecret();
  const pointed = await telegram.setWebhook({ url, secretToken: webhookSecret });
  if (!pointed.ok) throw failed("Sending the bot's updates to the store", pointed);

  await saveTelegramBot(db, { consumerId, token, bot: { id: me.result.id, username: me.result.username }, webhookSecret }, new Date());
  return c.json({ success: true, data: await view(c) }, 200);
}

/** A link that connects the chat whose owner presses Start on it, once, for a few minutes. */
async function pairingLink(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const consumerId = await telegramConsumerId(db);
  const bot = consumerId ? await readTelegramBot(db, consumerId) : null;
  if (!bot) throw telegramRefused(ERROR_CODES.TELEGRAM_NOT_SET_UP, "Save a bot token first", 409);
  const opened = await openPairing(db, bot.consumerId, new Date());
  if (!opened) throw telegramRefused(ERROR_CODES.TELEGRAM_NOT_SET_UP, "Save a bot token first", 409);
  return c.json({ success: true, data: { url: `https://t.me/${bot.botUsername}?start=${opened.code}`, expiresAt: opened.expiresAt } }, 200);
}

/** Send a test message now, from this request: its outcome is the answer, and it is recorded nowhere. */
async function sendTest(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const consumerId = await telegramConsumerId(db);
  const bot = consumerId ? await readTelegramBot(db, consumerId) : null;
  if (!bot) throw telegramRefused(ERROR_CODES.TELEGRAM_NOT_SET_UP, "Save a bot token first", 409);
  if (bot.chatId === null) throw telegramRefused(ERROR_CODES.TELEGRAM_NOT_CONNECTED, "Connect a chat first: open the pairing link and press Start", 409);
  const sent = await telegramClient(bot.botToken, fetch).sendMessage({ chatId: bot.chatId, text: MESSAGE_LANGUAGES[bot.writesIn].test });
  return c.json(
    {
      success: true,
      data: sent.ok
        ? { delivered: true, httpStatus: sent.httpStatus, reason: null, error: null }
        : { delivered: false, httpStatus: sent.httpStatus ?? null, reason: sent.reason, error: sent.error },
    },
    200,
  );
}

async function changeTelegram(c: Context<AppContext>) {
  const change = bodyOf<typeof telegramChangeSchema>(c);
  const result = await updateTelegram(getDb(c.env.DB), { ...change, events: change.events as never }, new Date());
  if (!result.ok && result.reason === "not_set_up") throw telegramRefused(ERROR_CODES.TELEGRAM_NOT_SET_UP, "Save a bot token first", 409);
  if (!result.ok) throw telegramRefused(ERROR_CODES.TELEGRAM_NOT_CONNECTED, "Connect a chat before turning Telegram on", 409);
  return c.json({ success: true, data: await view(c) }, 200);
}

/**
 * Stop the bot's updates and forget it: its token, its secret and its chat.
 * The Consumer and its delivery history stay. The bot is forgotten even when
 * Telegram cannot be told — a revoked token can no longer stop anything —
 * and the answer says so.
 */
async function disconnect(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const consumerId = await telegramConsumerId(db);
  const bot = consumerId ? await readTelegramBot(db, consumerId) : null;
  const stopped = bot ? await telegramClient(bot.botToken, fetch).deleteWebhook() : null;
  await forgetTelegramBot(db, new Date());
  return c.json({ success: true, data: { updatesStopped: stopped?.ok ?? true, error: stopped && !stopped.ok ? stopped.error : null } }, 200);
}

const NOT_SET_UP = { description: "No bot saved yet (TELEGRAM_NOT_SET_UP)" };

const getRoute = defineRoute({
  method: "get",
  path: "/telegram",
  auth: { scope: SCOPES.TELEGRAM_READ },
  tags: ["Apps"],
  summary: "Get the Telegram App",
  description: "The store's bot, its connected chat, which events it tells and in which language, or `null` before a bot was ever saved. The token is never returned — only a masked hint.",
  operationId: "getTelegramApp",
  responses: { 200: { description: "The Telegram App (null when never set up)", content: answer(TelegramSchema.nullable()) } },
  handler: getTelegram,
});

const saveBotRoute = defineRoute({
  method: "put",
  path: "/telegram/bot",
  auth: { scope: SCOPES.TELEGRAM_MANAGE },
  tags: ["Apps"],
  summary: "Save the Telegram bot",
  description:
    "Checks the token with Telegram (`getMe`), has Telegram send the bot's updates to this server (`setWebhook`, with a secret), and only then keeps it. Nothing is kept when either step fails. The same bot keeps its connected chat; another bot needs a chat connected again.",
  operationId: "saveTelegramBot",
  body: telegramBotSchema,
  responses: {
    200: { description: "The Telegram App", content: answer(TelegramSchema) },
    400: { description: "Telegram refused the token (TELEGRAM_TOKEN_REFUSED) or the webhook (TELEGRAM_REFUSED)" },
    409: { description: "This server has no https public URL for Telegram to call (TELEGRAM_NEEDS_PUBLIC_URL)" },
    502: { description: "Telegram unreachable (EXTERNAL_API_FAILURE)" },
  },
  handler: saveBot,
});

const pairingRoute = defineRoute({
  method: "post",
  path: "/telegram/pairing",
  auth: { scope: SCOPES.TELEGRAM_MANAGE },
  tags: ["Apps"],
  summary: "Open a Telegram pairing link",
  description: "A `t.me` link to the bot carrying a one-time code: pressing Start on it connects that private chat. It works once, for 15 minutes, and replaces any link opened before.",
  operationId: "openTelegramPairing",
  responses: {
    200: {
      description: "The link and until when it works",
      content: answer(z.object({ url: z.string().url().openapi({ example: "https://t.me/acme_orders_bot?start=Zx81…" }), expiresAt: z.string() })),
    },
    409: NOT_SET_UP,
  },
  handler: pairingLink,
});

const testRoute = defineRoute({
  method: "post",
  path: "/telegram/test",
  auth: { scope: SCOPES.TELEGRAM_MANAGE },
  tags: ["Apps"],
  summary: "Send a Telegram test message",
  description: "Sends a test message to the connected chat now and answers what Telegram said. It is recorded nowhere. A refusal is a 200 with `delivered: false` — the test itself worked.",
  operationId: "testTelegramApp",
  responses: {
    200: {
      description: "What Telegram answered",
      content: answer(
        z.object({
          delivered: z.boolean(),
          httpStatus: z.number().int().nullable(),
          reason: z.enum(["unauthorized", "blocked", "chat_not_found", "bad_request", "rate_limited", "unavailable", "unreachable"]).nullable(),
          error: z.string().nullable(),
        }),
      ),
    },
    409: { description: "No bot saved (TELEGRAM_NOT_SET_UP) or no chat connected (TELEGRAM_NOT_CONNECTED)" },
  },
  handler: sendTest,
});

const changeRoute = defineRoute({
  method: "patch",
  path: "/telegram",
  auth: { scope: SCOPES.TELEGRAM_MANAGE },
  tags: ["Apps"],
  summary: "Change the Telegram App",
  description: "Which events the bot tells, in which language, and on or off. A change of events applies to what is recorded from then on.",
  operationId: "changeTelegramApp",
  body: telegramChangeSchema,
  responses: {
    200: { description: "The Telegram App", content: answer(TelegramSchema) },
    400: { description: "No events, or one that is not an Event Type (VALIDATION_FAILED)" },
    409: { description: "No bot saved (TELEGRAM_NOT_SET_UP), or turned on with no chat connected (TELEGRAM_NOT_CONNECTED)" },
  },
  handler: changeTelegram,
});

const removeRoute = defineRoute({
  method: "delete",
  path: "/telegram",
  auth: { scope: SCOPES.TELEGRAM_MANAGE },
  tags: ["Apps"],
  summary: "Remove the telegram App",
  description:
    "Asks Telegram to stop sending the bot's updates (`deleteWebhook`), then forgets the bot: its token, its secret and its chat. Its Consumer stays, stopped, with its delivery history. The bot is forgotten even when Telegram cannot be told; `updatesStopped: false` says so.",
  operationId: "removeTelegramApp",
  responses: {
    200: {
      description: "Removed",
      content: answer(z.object({ updatesStopped: z.boolean(), error: z.string().nullable() })),
    },
  },
  handler: disconnect,
});

const router = new OpenAPIHono<AppContext>();
router.openapi(getRoute.route, getRoute.handler);
router.openapi(saveBotRoute.route, saveBotRoute.handler);
router.openapi(pairingRoute.route, pairingRoute.handler);
router.openapi(testRoute.route, testRoute.handler);
router.openapi(changeRoute.route, changeRoute.handler);
router.openapi(removeRoute.route, removeRoute.handler);

export default router;
