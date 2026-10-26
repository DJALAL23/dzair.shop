/**
 * Telegram Consumers (Events context, ADR 0020): the merchant's own Telegram
 * bot telling the store's team what happened, in a chat the merchant
 * connected by pressing Start. What a Telegram Consumer keeps in its
 * settings, which events it tells by default, and the shape of a bot token
 * and of a pairing code. Shared by the server, which enforces it, and the
 * dashboard, which explains it before the merchant saves.
 */

import { EVENT_TYPES, type EventType } from "./catalogue";
import { isStoreLocale, type StoreLocale } from "../i18n/locales";

/** As stored on `event_consumers.kind`. */
export const TELEGRAM_KIND = "telegram";

/** What a new Telegram Consumer tells: a new order, and how its delivery ended. */
export const TELEGRAM_DEFAULT_EVENTS: readonly EventType[] = ["order.created", "shipment.delivered", "shipment.delivery_failed"];

/** Every Event Type a Telegram Consumer can tell. */
export const TELEGRAM_EVENT_TYPES: readonly EventType[] = EVENT_TYPES;

/** How long a pairing link can be used, once. */
export const PAIRING_CODE_TTL_MS = 15 * 60_000;

/** The `secret_token` Telegram sends back on each update, and a pairing code: Telegram's alphabet for both. */
export const TELEGRAM_SECRET_PATTERN = /^[A-Za-z0-9_-]+$/;

/** A bot token as @BotFather gives it: the bot's id, a colon, then its key. */
export function isBotTokenShape(value: string): boolean {
  return /^\d{1,20}:[A-Za-z0-9_-]{30,64}$/.test(value);
}

/** A Telegram Consumer's settings: the language it writes in, or null for the store's primary language. */
export interface TelegramSettings {
  language: StoreLocale | null;
}

export function readTelegramSettings(json: string): TelegramSettings {
  try {
    const language = (JSON.parse(json) as { language?: unknown } | null)?.language;
    return { language: isStoreLocale(language) ? language : null };
  } catch {
    return { language: null };
  }
}

export function storedTelegramSettings(settings: TelegramSettings): string {
  return JSON.stringify({ language: settings.language });
}
