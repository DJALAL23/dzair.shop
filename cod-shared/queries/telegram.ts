/**
 * The Telegram App in the store's D1 (ADR 0020): the store's one Telegram
 * Consumer and the bot beside it. Saving a bot, making a pairing link,
 * pairing the chat that pressed Start, the chat blocking or unblocking the
 * bot, the merchant's choices, and forgetting the bot. Every change that two
 * requests could race is decided in one guarded statement.
 *
 * The bot token and the webhook secret leave this module only through
 * `readTelegramBot`, for the server calling Telegram — never in a view.
 */

import { and, asc, eq, gt, isNotNull, sql } from "drizzle-orm";
import type { AppDb } from "../db/client";
import { eventConsumers, storeTelegramConfig, stores } from "../db/schema";
import { insertSelectRow } from "../db/insert-select";
import { DEFAULT_STORE_LOCALE, isStoreLocale, type StoreLocale } from "../i18n/locales";
import type { EventType } from "../events/catalogue";
import type { ConsumerDisabledReason } from "../events/deliveries-model";
import { readSubscription } from "../events/subscription";
import { PAIRING_CODE_TTL_MS, TELEGRAM_DEFAULT_EVENTS, TELEGRAM_EVENT_TYPES, TELEGRAM_KIND, readTelegramSettings, storedTelegramSettings } from "../events/telegram";

type BatchStatement = Parameters<AppDb["batch"]>[0][number];

/** The Telegram App as the merchant sees it: never the token, never the webhook secret. */
export interface TelegramView {
  consumerId: string;
  enabled: boolean;
  disabledReason: ConsumerDisabledReason | null;
  failingSince: string | null;
  /** Null once the bot was forgotten (disconnected); the Consumer and its history stay. */
  bot: { id: number; username: string; tokenMasked: string } | null;
  /** The connected chat; null until someone presses Start on a pairing link. */
  chat: { name: string | null; connectedAt: string } | null;
  /** Until when the latest pairing link can be used; null when none is open. */
  pairingExpiresAt: string | null;
  events: EventType[];
  /** The chosen language; null writes in the store's primary language. */
  language: StoreLocale | null;
  /** The language messages are written in now. */
  writesIn: StoreLocale;
}

/** What the server needs to call Telegram for this store: secrets included. */
export interface TelegramBotRow {
  consumerId: string;
  enabled: boolean;
  botToken: string;
  botId: number;
  botUsername: string;
  webhookSecret: string;
  chatId: number | null;
  writesIn: StoreLocale;
}

const primaryLanguage = sql<string | null>`(select ${stores.lang} from ${stores} limit 1)`;

const isTelegram = eq(eventConsumers.kind, TELEGRAM_KIND);

async function readRow(db: AppDb) {
  return (
    (await db
      .select({ consumer: eventConsumers, config: storeTelegramConfig, primary: primaryLanguage })
      .from(eventConsumers)
      .leftJoin(storeTelegramConfig, eq(storeTelegramConfig.consumerId, eventConsumers.id))
      .where(isTelegram)
      .orderBy(asc(eventConsumers.createdAt), asc(eventConsumers.id))
      .limit(1)
      .get()) ?? null
  );
}

function writesIn(language: StoreLocale | null, primary: string | null): StoreLocale {
  return language ?? (isStoreLocale(primary) ? primary : DEFAULT_STORE_LOCALE);
}

function events(subscription: string): EventType[] {
  const patterns = readSubscription(subscription);
  return TELEGRAM_EVENT_TYPES.filter((type) => patterns.includes(type));
}

function mask(token: string): string {
  return `••••${token.slice(-4)}`;
}

/** The store's Telegram App, or null before a bot was ever saved. */
export async function readTelegram(db: AppDb, now: Date): Promise<TelegramView | null> {
  const row = await readRow(db);
  if (!row) return null;
  const { consumer, config } = row;
  const { language } = readTelegramSettings(consumer.settings);
  return {
    consumerId: consumer.id,
    enabled: consumer.enabled,
    disabledReason: consumer.disabledReason,
    failingSince: consumer.failingSince,
    bot: config ? { id: config.botId, username: config.botUsername, tokenMasked: mask(config.botToken) } : null,
    chat: config?.chatId != null && config.connectedAt ? { name: config.chatName, connectedAt: config.connectedAt } : null,
    pairingExpiresAt: config?.pairingCodeHash && config.pairingExpiresAt && config.pairingExpiresAt > now.toISOString() ? config.pairingExpiresAt : null,
    events: events(consumer.subscription),
    language,
    writesIn: writesIn(language, row.primary),
  };
}

/** The bot behind a Telegram Consumer, secrets included, or null when it has none. */
export async function readTelegramBot(db: AppDb, consumerId: string): Promise<TelegramBotRow | null> {
  const row = await db
    .select({ enabled: eventConsumers.enabled, settings: eventConsumers.settings, config: storeTelegramConfig, primary: primaryLanguage })
    .from(storeTelegramConfig)
    .innerJoin(eventConsumers, eq(eventConsumers.id, storeTelegramConfig.consumerId))
    .where(and(eq(storeTelegramConfig.consumerId, consumerId), isTelegram))
    .get();
  if (!row) return null;
  const { config } = row;
  return {
    consumerId: config.consumerId,
    enabled: row.enabled,
    botToken: config.botToken,
    botId: config.botId,
    botUsername: config.botUsername,
    webhookSecret: config.webhookSecret,
    chatId: config.chatId,
    writesIn: writesIn(readTelegramSettings(row.settings).language, row.primary),
  };
}

/** The store's Telegram Consumer's id, if it has one: a bot is saved onto it. */
export async function telegramConsumerId(db: AppDb): Promise<string | null> {
  return (await readRow(db))?.consumer.id ?? null;
}

export interface SavedBot {
  /** The Consumer the bot is for: the store's existing one, or the id to create it with. */
  consumerId: string;
  token: string;
  bot: { id: number; username: string };
  webhookSecret: string;
}

/**
 * Keep a bot Telegram accepted, with the webhook secret its updates now carry.
 * The first bot creates the store's Telegram Consumer — stopped until a chat
 * is connected, telling the default events in the store's language. The same
 * bot again keeps its chat; another bot starts without one, so the Consumer
 * stops until a chat presses Start on the new bot.
 */
export async function saveTelegramBot(db: AppDb, saved: SavedBot, now: Date): Promise<void> {
  const at = now.toISOString();
  const value = (v: string | number) => sql`${v}`;
  const sameBot = sql`exists (select 1 from ${storeTelegramConfig} where ${storeTelegramConfig.consumerId} = ${saved.consumerId} and ${storeTelegramConfig.botId} = ${saved.bot.id})`;
  const statements: BatchStatement[] = [
    db
      .insert(eventConsumers)
      .select(
        db
          .select(
            insertSelectRow(eventConsumers, {
              id: value(saved.consumerId),
              kind: value(TELEGRAM_KIND),
              name: value("Telegram"),
              enabled: sql`0`,
              disabledReason: value("not_connected"),
              subscription: value(JSON.stringify(TELEGRAM_DEFAULT_EVENTS)),
              settings: value(storedTelegramSettings({ language: null })),
              createdAt: value(at),
              updatedAt: value(at),
            }) as never,
          )
          .from(sql`(select 1)`)
          .where(sql`not exists (select 1 from ${eventConsumers} where ${isTelegram})`),
      ),
    db
      .update(eventConsumers)
      .set({ enabled: false, disabledReason: "not_connected", failingSince: null, updatedAt: at })
      .where(and(eq(eventConsumers.id, saved.consumerId), sql`not ${sameBot}`)),
    db
      .insert(storeTelegramConfig)
      .values({ consumerId: saved.consumerId, botToken: saved.token, botId: saved.bot.id, botUsername: saved.bot.username, webhookSecret: saved.webhookSecret, createdAt: at, updatedAt: at })
      .onConflictDoUpdate({
        target: storeTelegramConfig.consumerId,
        set: {
          botToken: saved.token,
          botUsername: saved.bot.username,
          webhookSecret: saved.webhookSecret,
          chatId: sql`case when ${storeTelegramConfig.botId} = ${saved.bot.id} then ${storeTelegramConfig.chatId} else null end`,
          chatName: sql`case when ${storeTelegramConfig.botId} = ${saved.bot.id} then ${storeTelegramConfig.chatName} else null end`,
          connectedAt: sql`case when ${storeTelegramConfig.botId} = ${saved.bot.id} then ${storeTelegramConfig.connectedAt} else null end`,
          pairingCodeHash: null,
          pairingExpiresAt: null,
          botId: saved.bot.id,
          updatedAt: at,
        },
      }),
  ];
  await db.batch(statements as [BatchStatement, ...BatchStatement[]]);
}

/** SHA-256 of a pairing code, in hex: what is kept of it. */
export async function pairingCodeHash(code: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** A new pairing code: 32 characters of Telegram's deep-link alphabet, 192 random bits. */
export function newPairingCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_");
}

/**
 * Open a pairing link for the store's bot: the code it carries, usable once,
 * until `PAIRING_CODE_TTL_MS` from now. It replaces any link opened before.
 * Null when no bot is saved.
 */
export async function openPairing(db: AppDb, consumerId: string, now: Date): Promise<{ code: string; expiresAt: string } | null> {
  const code = newPairingCode();
  const expiresAt = new Date(now.getTime() + PAIRING_CODE_TTL_MS).toISOString();
  const opened = await db
    .update(storeTelegramConfig)
    .set({ pairingCodeHash: await pairingCodeHash(code), pairingExpiresAt: expiresAt, updatedAt: now.toISOString() })
    .where(eq(storeTelegramConfig.consumerId, consumerId))
    .returning({ consumerId: storeTelegramConfig.consumerId });
  return opened.length > 0 ? { code, expiresAt } : null;
}

/**
 * Connect the chat that pressed Start on a pairing link: only with this
 * Consumer's open code, before it expires, and once — the code is spent by
 * the same statement that connects the chat, so of two chats racing for one
 * code exactly one wins. Connecting starts the Consumer. Whether it paired.
 */
export async function pairChat(db: AppDb, consumerId: string, code: string, chat: { id: number; name: string | null }, now: Date): Promise<boolean> {
  const at = now.toISOString();
  const [paired] = await db.batch([
    db
      .update(storeTelegramConfig)
      .set({ chatId: chat.id, chatName: chat.name, connectedAt: at, pairingCodeHash: null, pairingExpiresAt: null, updatedAt: at })
      .where(
        and(
          eq(storeTelegramConfig.consumerId, consumerId),
          eq(storeTelegramConfig.pairingCodeHash, await pairingCodeHash(code)),
          isNotNull(storeTelegramConfig.pairingExpiresAt),
          gt(storeTelegramConfig.pairingExpiresAt, at),
        ),
      )
      .returning({ consumerId: storeTelegramConfig.consumerId }),
    db
      .update(eventConsumers)
      .set({ enabled: true, disabledReason: null, failingSince: null, updatedAt: at })
      .where(
        and(
          eq(eventConsumers.id, consumerId),
          sql`exists (select 1 from ${storeTelegramConfig} where ${storeTelegramConfig.consumerId} = ${consumerId} and ${storeTelegramConfig.chatId} = ${chat.id} and ${storeTelegramConfig.connectedAt} = ${at} and ${storeTelegramConfig.pairingCodeHash} is null)`,
        ),
      ),
  ]);
  return paired.length > 0;
}

/**
 * The connected chat blocked the bot (`blocked`) or let it in again: a block
 * stops the Consumer (`bot_blocked`); an unblock starts again only a
 * Consumer a block stopped. Another chat's news changes nothing.
 */
export async function chatMembershipChanged(db: AppDb, consumerId: string, chatId: number, blocked: boolean, now: Date): Promise<boolean> {
  const at = now.toISOString();
  const theChat = sql`exists (select 1 from ${storeTelegramConfig} where ${storeTelegramConfig.consumerId} = ${eventConsumers.id} and ${storeTelegramConfig.chatId} = ${chatId})`;
  const changed = await db
    .update(eventConsumers)
    .set(blocked ? { enabled: false, disabledReason: "bot_blocked", updatedAt: at } : { enabled: true, disabledReason: null, failingSince: null, updatedAt: at })
    .where(
      and(
        eq(eventConsumers.id, consumerId),
        theChat,
        blocked ? eq(eventConsumers.enabled, true) : eq(eventConsumers.disabledReason, "bot_blocked"),
      ),
    )
    .returning({ id: eventConsumers.id });
  return changed.length > 0;
}

export interface TelegramChange {
  events?: EventType[];
  language?: StoreLocale | null;
  enabled?: boolean;
}

export type TelegramUpdate = { ok: true } | { ok: false; reason: "not_set_up" | "not_connected" };

/**
 * The merchant's choices: which events, which language, on or off. Turning
 * it on needs a connected chat, and clears why it stopped and its failing
 * streak; turning it off stops it as the merchant's.
 */
export async function updateTelegram(db: AppDb, change: TelegramChange, now: Date): Promise<TelegramUpdate> {
  const row = await readRow(db);
  if (!row?.config) return { ok: false, reason: "not_set_up" };
  const at = now.toISOString();
  const set: Partial<typeof eventConsumers.$inferInsert> = { updatedAt: at };
  if (change.events !== undefined) {
    if (change.events.length === 0 || !change.events.every((type) => TELEGRAM_EVENT_TYPES.includes(type))) throw new Error("Telegram tells one or more Event Types");
    set.subscription = JSON.stringify(TELEGRAM_EVENT_TYPES.filter((type) => change.events!.includes(type)));
  }
  if (change.language !== undefined) set.settings = storedTelegramSettings({ language: change.language });
  if (change.enabled === true) Object.assign(set, { enabled: true, disabledReason: null, failingSince: null });
  if (change.enabled === false) Object.assign(set, { enabled: false, disabledReason: "merchant" });
  const guard = change.enabled === true ? sql`exists (select 1 from ${storeTelegramConfig} where ${storeTelegramConfig.consumerId} = ${row.consumer.id} and ${storeTelegramConfig.chatId} is not null)` : sql`1`;
  const changed = await db.update(eventConsumers).set(set).where(and(eq(eventConsumers.id, row.consumer.id), guard)).returning({ id: eventConsumers.id });
  return changed.length > 0 ? { ok: true } : { ok: false, reason: "not_connected" };
}

/**
 * Forget the bot: its token, its secret and its chat. The Consumer stays,
 * stopped as the merchant's, with its delivery history.
 */
export async function forgetTelegramBot(db: AppDb, now: Date): Promise<void> {
  const consumerId = await telegramConsumerId(db);
  if (!consumerId) return;
  await db.batch([
    db.delete(storeTelegramConfig).where(eq(storeTelegramConfig.consumerId, consumerId)),
    db.update(eventConsumers).set({ enabled: false, disabledReason: "merchant", updatedAt: now.toISOString() }).where(eq(eventConsumers.id, consumerId)),
  ]);
}
