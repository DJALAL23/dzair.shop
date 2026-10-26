import { describe, expect, it } from "vitest";
import { connectedSince, telegramAttentionKey, telegramErrorKey } from "./model";
import type { TelegramApp } from "./types";

const app = (over: Partial<TelegramApp> = {}): TelegramApp => ({
  consumerId: "tg",
  enabled: true,
  disabledReason: null,
  failingSince: null,
  bot: { id: 1, username: "acme_bot", tokenMasked: "••••x9Qa" },
  chat: { name: "Amina", connectedAt: "2026-10-26T08:00:00.000Z" },
  pairingExpiresAt: null,
  events: ["order.created"],
  language: null,
  writesIn: "ar",
  ...over,
});

describe("the Telegram App's words", () => {
  it.each([
    ["TELEGRAM_TOKEN_REFUSED", "telegram.errors.token_refused"],
    ["TELEGRAM_NEEDS_PUBLIC_URL", "telegram.errors.needs_public_url"],
    ["TELEGRAM_REFUSED", "telegram.errors.refused"],
    ["TELEGRAM_NOT_SET_UP", "telegram.errors.not_set_up"],
    ["TELEGRAM_NOT_CONNECTED", "telegram.errors.not_connected"],
    ["EXTERNAL_API_FAILURE", "telegram.errors.unreachable"],
    [undefined, "telegram.errors.failed"],
    ["VALIDATION_FAILED", "telegram.errors.failed"],
  ])("say %s as %s", (code, key) => {
    expect(telegramErrorKey(code)).toBe(key);
  });

  it("call for attention when the chat blocked the bot or messages fail, never when the merchant turned it off", () => {
    expect(telegramAttentionKey(app())).toBeNull();
    expect(telegramAttentionKey(app({ enabled: false, disabledReason: "bot_blocked" }))).toBe("telegram.attention.bot_blocked");
    expect(telegramAttentionKey(app({ enabled: false, disabledReason: "failing" }))).toBe("telegram.attention.failing");
    expect(telegramAttentionKey(app({ failingSince: "2026-10-26T09:00:00.000Z" }))).toBe("telegram.attention.failing");
    expect(telegramAttentionKey(app({ enabled: false, disabledReason: "merchant" }))).toBeNull();
    expect(telegramAttentionKey(app({ enabled: false, disabledReason: "not_connected", chat: null }))).toBeNull();
    expect(telegramAttentionKey(app({ bot: null, enabled: false, disabledReason: "merchant" }))).toBeNull();
  });

  it("see a chat connected only once it is a new connection", () => {
    expect(connectedSince(app({ chat: null }), null)).toBe(false);
    expect(connectedSince(app(), null)).toBe(true);
    expect(connectedSince(app(), "2026-10-26T08:00:00.000Z")).toBe(false);
    expect(connectedSince(app(), "2026-10-20T08:00:00.000Z")).toBe(true);
    expect(connectedSince(null, null)).toBe(false);
  });
});
