/**
 * The Telegram App's bot reporting to the store (ADR 0020): Telegram posts
 * each update for the merchant's bot to `/webhooks/telegram/<consumerId>`,
 * carrying the secret the store gave it in `X-Telegram-Bot-Api-Secret-Token`.
 * The secret is checked, in constant time, before the body is read; an update
 * without it is 401 and changes nothing.
 *
 *   /start <code> in a private chat  pairs that chat, when the code is this
 *                                    bot's open one, unexpired and unused;
 *                                    the bot answers in the reply
 *   the chat blocks the bot          stops the Consumer (`bot_blocked`)
 *   the chat unblocks it             starts again a Consumer a block stopped
 *
 * Anything else is answered 200 and ignored, so Telegram does not retry it.
 */

import type { Context } from "hono";
import type { AppContext } from "@/types";
import { getDb } from "@/db";
import { AppError } from "@/lib/errors/classes";
import { ERROR_CATEGORIES, ERROR_CODES } from "../../../../cod-shared/errors/codes";
import { MESSAGE_LANGUAGES } from "../../../../cod-shared/events/messages";
import { chatMembershipChanged, pairChat, readTelegramBot } from "../../../../cod-shared/queries/telegram";

export const TELEGRAM_SECRET_HEADER = "X-Telegram-Bot-Api-Secret-Token";
const START = /^\/start(?:@\w+)?\s+([A-Za-z0-9_-]{1,64})\s*$/;

interface Chat {
  id?: unknown;
  type?: unknown;
  first_name?: unknown;
  last_name?: unknown;
  username?: unknown;
}

interface Update {
  message?: { chat?: Chat; text?: unknown } | null;
  my_chat_member?: { chat?: Chat; new_chat_member?: { status?: unknown } | null } | null;
}

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

/** Whether `given` is `expected`, compared over their digests so the time taken says nothing about either. */
export async function secretMatches(given: string, expected: string): Promise<boolean> {
  const [a, b] = await Promise.all([digest(given), digest(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

function chatName(chat: Chat): string | null {
  const name = [chat.first_name, chat.last_name].filter((part): part is string => typeof part === "string" && part.length > 0).join(" ");
  if (name) return name.slice(0, 200);
  return typeof chat.username === "string" ? `@${chat.username}`.slice(0, 200) : null;
}

const privateChatId = (chat: Chat | undefined): number | null => (chat && chat.type === "private" && typeof chat.id === "number" ? chat.id : null);

function refused(message: string, status: 400 | 401) {
  return new AppError(message, ERROR_CODES.INVALID_WEBHOOK_PAYLOAD, ERROR_CATEGORIES.VALIDATION, status, { provider: "telegram" });
}

/** POST /webhooks/telegram/{consumerId} */
export async function handleTelegramUpdate(c: Context<AppContext>) {
  const consumerId = c.req.param("consumerId") ?? "";
  const db = getDb(c.env.DB);
  const bot = await readTelegramBot(db, consumerId);
  const given = c.req.header(TELEGRAM_SECRET_HEADER) ?? "";
  if (!bot || !(await secretMatches(given, bot.webhookSecret))) throw refused("The update does not carry this bot's secret", 401);

  let update: Update;
  try {
    update = JSON.parse(await c.req.text()) as Update;
    if (typeof update !== "object" || update === null) throw new Error("not an update");
  } catch {
    throw refused("The update is not JSON", 400);
  }
  const now = new Date();
  const words = MESSAGE_LANGUAGES[bot.writesIn];

  const membership = update.my_chat_member;
  const memberChat = privateChatId(membership?.chat);
  if (membership && memberChat !== null) {
    const status = membership.new_chat_member?.status;
    if (status === "kicked" || status === "member") await chatMembershipChanged(db, consumerId, memberChat, status === "kicked", now);
    return c.json({ received: true }, 200);
  }

  const message = update.message;
  const chatId = privateChatId(message?.chat);
  const start = typeof message?.text === "string" ? START.exec(message.text) : null;
  if (!message || chatId === null || !start) return c.json({ received: true }, 200);

  const paired = await pairChat(db, consumerId, start[1]!, { id: chatId, name: chatName(message.chat!) }, now);
  return c.json({ method: "sendMessage", chat_id: chatId, text: paired ? words.connected : words.pairingRefused }, 200);
}
