/**
 * Telegram as a Consumer Kind (plan, Phase 12; ADR 0020): a Business Event
 * told to the merchant's team, as a plain-text message from the merchant's
 * own bot to the chat they connected, in the language they chose or the
 * store's primary one. The message is written from the event alone.
 *
 * What Telegram answers decides the Attempt: sent, delivered; 429 retried no
 * sooner than its `retry_after`, and 5xx, no answer or no connection
 * retried on the schedule; a chat that blocked the bot (403) dead, and the
 * Consumer stopped (`bot_blocked`); a refused token (401) or a chat that does
 * not exist (400) dead, so the App needs attention. With no bot or no chat
 * connected, the Delivery is Skipped with that reason.
 */

import type { AttemptOutcome } from "../../../../cod-shared/events/deliveries";
import { TELEGRAM_KIND } from "../../../../cod-shared/events/telegram";
import { renderTeamMessage } from "../../../../cod-shared/events/messages";
import { readTelegramBot } from "../../../../cod-shared/queries/telegram";
import { telegramClient, type TelegramResult } from "@/lib/telegram";
import type { ConsumerKind } from "./kind";

/** What one Telegram call comes to, as an Attempt. */
export function telegramAttemptOutcome(result: TelegramResult<unknown>): Exclude<AttemptOutcome, { kind: "skipped" }> {
  if (result.ok) return { kind: "delivered", httpStatus: result.httpStatus };
  if (result.kind === "retry") {
    return {
      kind: "retry",
      error: result.error,
      ...(result.httpStatus === undefined ? {} : { httpStatus: result.httpStatus }),
      ...(result.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: result.retryAfterSeconds }),
    };
  }
  return { kind: "reject", error: result.error, httpStatus: result.httpStatus, ...(result.reason === "blocked" ? { stopsConsumer: "bot_blocked" as const } : {}) };
}

export const telegram: ConsumerKind = {
  kind: TELEGRAM_KIND,
  cost: { external: 1, services: 1 },

  async deliver({ event, consumer, db, fetch }) {
    const bot = await readTelegramBot(db, consumer.id);
    if (!bot) return { kind: "skipped", reason: "No Telegram bot is saved: it was disconnected" };
    if (bot.chatId === null) return { kind: "skipped", reason: "No Telegram chat is connected yet" };
    const sent = await telegramClient(bot.botToken, fetch).sendMessage({ chatId: bot.chatId, text: renderTeamMessage(event, bot.writesIn) });
    return telegramAttemptOutcome(sent);
  },
};
