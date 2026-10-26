import { describe, expect, it, vi } from "vitest";
import { TELEGRAM_API_ORIGIN, telegramClient, type TelegramResult } from "./telegram";

/**
 * The Telegram Bot API client: what it sends, and the one outcome each of
 * Telegram's answers comes to. The answers' shapes are Telegram's own
 * (`{ ok, result }` or `{ ok: false, error_code, description, parameters }`).
 */

const TOKEN = "123456789:AAtest-token-for-unit-tests-only_xyz";

function answering(status: number, body: unknown) {
  return vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
}

const refused = (status: number, description: string, parameters?: Record<string, unknown>) => answering(status, { ok: false, error_code: status, description, ...(parameters ? { parameters } : {}) });

function expectNoToken(result: TelegramResult<unknown>) {
  expect(JSON.stringify(result)).not.toContain(TOKEN);
  expect(JSON.stringify(result)).not.toContain(TOKEN.split(":")[1]);
}

describe("what the client sends", () => {
  it("calls the method on the bot's URL with a JSON body", async () => {
    const fetch = answering(200, { ok: true, result: { message_id: 42 } });
    const result = await telegramClient(TOKEN, fetch).sendMessage({ chatId: 777, text: "Hello <b>there</b>" });
    expect(result).toEqual({ ok: true, result: { messageId: 42 }, httpStatus: 200 });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(`${TELEGRAM_API_ORIGIN}/bot${TOKEN}/sendMessage`);
    expect(init?.method).toBe("POST");
    const body = JSON.parse(String(init?.body));
    expect(body).toEqual({ chat_id: 777, text: "Hello <b>there</b>", link_preview_options: { is_disabled: true } });
    expect(body).not.toHaveProperty("parse_mode");
  });

  it("points the webhook with its secret, for messages and chat membership only", async () => {
    const fetch = answering(200, { ok: true, result: true, description: "Webhook was set" });
    expect(await telegramClient(TOKEN, fetch).setWebhook({ url: "https://api.acme.dz/webhooks/telegram/c1", secretToken: "s3cret_-" })).toEqual({ ok: true, result: true, httpStatus: 200 });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(`${TELEGRAM_API_ORIGIN}/bot${TOKEN}/setWebhook`);
    expect(JSON.parse(String(init?.body))).toEqual({
      url: "https://api.acme.dz/webhooks/telegram/c1",
      secret_token: "s3cret_-",
      allowed_updates: ["message", "my_chat_member"],
      drop_pending_updates: true,
    });
  });

  it("removes the webhook and what it had not sent", async () => {
    const fetch = answering(200, { ok: true, result: true });
    expect((await telegramClient(TOKEN, fetch).deleteWebhook()).ok).toBe(true);
    expect(fetch.mock.calls[0]![0]).toBe(`${TELEGRAM_API_ORIGIN}/bot${TOKEN}/deleteWebhook`);
    expect(JSON.parse(String(fetch.mock.calls[0]![1]?.body))).toEqual({ drop_pending_updates: true });
  });

  it("reads the bot behind a token", async () => {
    const fetch = answering(200, { ok: true, result: { id: 123456789, is_bot: true, first_name: "Acme orders", username: "acme_orders_bot" } });
    expect(await telegramClient(TOKEN, fetch).getMe()).toEqual({ ok: true, result: { id: 123456789, username: "acme_orders_bot", firstName: "Acme orders" }, httpStatus: 200 });
  });

  it("does not take an answer without a bot for a bot", async () => {
    const result = await telegramClient(TOKEN, answering(200, { ok: true, result: { id: 1 } })).getMe();
    expect(result).toMatchObject({ ok: false, kind: "retry" });
  });
});

describe("what each answer comes to", () => {
  it("429: retry, after the wait Telegram asks for", async () => {
    const result = await telegramClient(TOKEN, refused(429, "Too Many Requests: retry after 35", { retry_after: 35 })).sendMessage({ chatId: 1, text: "x" });
    expect(result).toEqual({ ok: false, kind: "retry", reason: "rate_limited", error: "Telegram answered 429: Too Many Requests: retry after 35", httpStatus: 429, retryAfterSeconds: 35 });
  });

  it("429 without a wait: retry on the schedule", async () => {
    const result = await telegramClient(TOKEN, refused(429, "Too Many Requests")).sendMessage({ chatId: 1, text: "x" });
    expect(result).toMatchObject({ ok: false, kind: "retry", reason: "rate_limited" });
    expect(result).not.toHaveProperty("retryAfterSeconds");
  });

  it("403: rejected, the chat blocked the bot", async () => {
    const result = await telegramClient(TOKEN, refused(403, "Forbidden: bot was blocked by the user")).sendMessage({ chatId: 1, text: "x" });
    expect(result).toEqual({ ok: false, kind: "reject", reason: "blocked", error: "Telegram answered 403: Forbidden: bot was blocked by the user", httpStatus: 403 });
  });

  it("400 chat not found: rejected", async () => {
    expect(await telegramClient(TOKEN, refused(400, "Bad Request: chat not found")).sendMessage({ chatId: 1, text: "x" })).toMatchObject({ kind: "reject", reason: "chat_not_found", httpStatus: 400 });
  });

  it("any other 400: rejected as a bad request", async () => {
    expect(await telegramClient(TOKEN, refused(400, "Bad Request: message text is empty")).sendMessage({ chatId: 1, text: "" })).toMatchObject({ kind: "reject", reason: "bad_request" });
  });

  it("401 and 404: rejected, the token is not a bot's", async () => {
    expect(await telegramClient(TOKEN, refused(401, "Unauthorized")).getMe()).toMatchObject({ kind: "reject", reason: "unauthorized", httpStatus: 401 });
    expect(await telegramClient(TOKEN, refused(404, "Not Found")).getMe()).toMatchObject({ kind: "reject", reason: "unauthorized", httpStatus: 404 });
  });

  it("5xx, or an answer that is not Telegram's: retry", async () => {
    expect(await telegramClient(TOKEN, refused(502, "Bad Gateway")).sendMessage({ chatId: 1, text: "x" })).toMatchObject({ kind: "retry", reason: "unavailable", httpStatus: 502 });
    expect(await telegramClient(TOKEN, answering(503, "<html>down</html>")).sendMessage({ chatId: 1, text: "x" })).toMatchObject({ kind: "retry", reason: "unavailable", error: "Telegram answered 503: HTTP 503" });
  });

  it("no answer in time: retry", async () => {
    const fetch = vi.fn(async () => {
      throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    });
    expect(await telegramClient(TOKEN, fetch, 2000).sendMessage({ chatId: 1, text: "x" })).toEqual({ ok: false, kind: "retry", reason: "unreachable", error: "Telegram did not answer within 2 s" });
  });

  it("no connection: retry", async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError("Network connection lost");
    });
    expect(await telegramClient(TOKEN, fetch).getMe()).toEqual({ ok: false, kind: "retry", reason: "unreachable", error: "Telegram could not be reached: Network connection lost" });
  });

  it("gives its deadline to the request", async () => {
    const fetch = answering(200, { ok: true, result: true });
    await telegramClient(TOKEN, fetch).deleteWebhook();
    expect(fetch.mock.calls[0]![1]?.signal).toBeInstanceOf(AbortSignal);
  });
});

describe("the bot token", () => {
  it("is in no outcome, even when an error repeats the URL", async () => {
    const leaky = vi.fn(async (url: RequestInfo | URL) => {
      throw new TypeError(`fetch failed for ${String(url)}`);
    });
    const result = await telegramClient(TOKEN, leaky).sendMessage({ chatId: 1, text: "x" });
    expectNoToken(result);
    expect(result).toMatchObject({ error: `Telegram could not be reached: fetch failed for ${TELEGRAM_API_ORIGIN}/bot<bot token>/sendMessage` });

    for (const fetch of [refused(401, `Unauthorized ${TOKEN}`), refused(429, "slow down", { retry_after: 3 }), answering(500, "oops")]) {
      expectNoToken(await telegramClient(TOKEN, fetch).getMe());
    }
  });
});
