import type { ConsumerDisabledReason } from "../../../../../cod-shared/events/deliveries-model";
import type { TelegramApp } from "./types";

/** The `apps` message for an error the Telegram App's API answered, by its code. */
export function telegramErrorKey(code: string | undefined): string {
  switch (code) {
    case "TELEGRAM_TOKEN_REFUSED":
      return "telegram.errors.token_refused";
    case "TELEGRAM_NEEDS_PUBLIC_URL":
      return "telegram.errors.needs_public_url";
    case "TELEGRAM_REFUSED":
      return "telegram.errors.refused";
    case "TELEGRAM_NOT_SET_UP":
      return "telegram.errors.not_set_up";
    case "TELEGRAM_NOT_CONNECTED":
      return "telegram.errors.not_connected";
    case "EXTERNAL_API_FAILURE":
      return "telegram.errors.unreachable";
    default:
      return "telegram.errors.failed";
  }
}

/** What needs the merchant's attention, if anything: the `apps` message saying it. */
export function telegramAttentionKey(app: TelegramApp): string | null {
  const stopped: Partial<Record<ConsumerDisabledReason, string>> = { bot_blocked: "telegram.attention.bot_blocked", failing: "telegram.attention.failing" };
  if (!app.bot) return null;
  if (!app.enabled) return (app.disabledReason && stopped[app.disabledReason]) ?? null;
  return app.failingSince ? "telegram.attention.failing" : null;
}

/** Whether a chat connected since a pairing link was opened, when the chat then was connected at `before`. */
export function connectedSince(app: TelegramApp | null, before: string | null): boolean {
  return app?.chat != null && app.chat.connectedAt !== before;
}
