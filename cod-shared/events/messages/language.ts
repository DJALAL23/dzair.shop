import type { StoreLocale } from "../../i18n/locales";
import type { EventType, OrderField } from "../catalogue";
import type { BusinessEvent } from "../log";

export type EventOf<T extends EventType> = Extract<BusinessEvent, { type: T }>;

/** One language's words for the team's messages: a headline per Event Type, and the labels around the facts. */
export interface MessageLanguage {
  locale: StoreLocale;
  /** The locale numbers are written in. */
  numbers: string;
  currency: string;
  headline: { [T in EventType]: (event: EventOf<T>) => string };
  words: {
    total: string;
    toCollect: string;
    carrier: string;
    driver: string;
    tracking: string;
    reason: string;
    by: string;
    changed: string;
    refused: string;
    home: string;
    stopDesk: string;
  };
  fields: Record<OrderField, string>;
  /** What the bot says once a chat is connected. */
  connected: string;
  /** What a test message says. */
  test: string;
  /** What the bot answers a link that cannot connect the chat: used, expired, or not this bot's. */
  pairingRefused: string;
}
