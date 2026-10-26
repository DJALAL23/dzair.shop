import type { ConsumerDisabledReason } from "../../../../../cod-shared/events/deliveries-model";
import type { EventType } from "../../../../../cod-shared/events/catalogue";
import type { StoreLocale } from "../../../../../cod-shared/i18n/locales";

/** The Telegram App as `GET /api/apps/telegram` answers it. Absent (null) before a bot was ever saved. */
export interface TelegramApp {
  consumerId: string;
  enabled: boolean;
  disabledReason: ConsumerDisabledReason | null;
  failingSince: string | null;
  bot: { id: number; username: string; tokenMasked: string } | null;
  chat: { name: string | null; connectedAt: string } | null;
  pairingExpiresAt: string | null;
  events: EventType[];
  language: StoreLocale | null;
  writesIn: StoreLocale;
}

export interface TelegramChange {
  events?: EventType[];
  language?: StoreLocale | null;
  enabled?: boolean;
}

export interface TelegramPairing {
  url: string;
  expiresAt: string;
}

export type TelegramTestReason = "unauthorized" | "blocked" | "chat_not_found" | "bad_request" | "rate_limited" | "unavailable" | "unreachable";

export interface TelegramTest {
  delivered: boolean;
  httpStatus: number | null;
  reason: TelegramTestReason | null;
  error: string | null;
}
