/**
 * The Telegram Bot API, as the Telegram App uses it: check a bot token, point
 * the bot's updates at the store, stop them, and send a plain-text message.
 * https://core.telegram.org/bots/api
 *
 * Every answer comes to one outcome. A refusal that will not change on its
 * own is `reject` — a bad token (401, or 404 for a token Telegram cannot
 * parse), a chat that blocked the bot or never let it in (403), a chat that
 * does not exist (400). Anything that may pass later is `retry` — Telegram
 * asking to slow down (429, with how long), Telegram failing (5xx), no answer
 * in time, no connection. The bot token is in every request's URL and in no
 * answer, error or message this module returns.
 */

export const TELEGRAM_API_ORIGIN = "https://api.telegram.org";
/** How long Telegram has to answer one call. */
export const TELEGRAM_TIMEOUT_MS = 10_000;
/** The longest text a message may carry. */
export const TELEGRAM_TEXT_MAX = 4096;
/** What the bot is told about: the chat's messages, and being blocked or let in again. */
export const TELEGRAM_ALLOWED_UPDATES = ["message", "my_chat_member"] as const;

export interface TelegramBot {
  id: number;
  username: string;
  firstName: string;
}

export type TelegramRejection = "unauthorized" | "blocked" | "chat_not_found" | "bad_request";
export type TelegramRetry = "rate_limited" | "unavailable" | "unreachable";

export type TelegramFailure =
  | { ok: false; kind: "reject"; reason: TelegramRejection; error: string; httpStatus: number }
  | { ok: false; kind: "retry"; reason: TelegramRetry; error: string; httpStatus?: number; retryAfterSeconds?: number };

export type TelegramResult<T> = { ok: true; result: T; httpStatus: number } | TelegramFailure;

export interface TelegramClient {
  getMe(): Promise<TelegramResult<TelegramBot>>;
  /** Send the bot's updates to `url`, each carrying `secretToken` in `X-Telegram-Bot-Api-Secret-Token`. */
  setWebhook(input: { url: string; secretToken: string }): Promise<TelegramResult<true>>;
  /** Stop sending the bot's updates anywhere, and drop those not yet sent. */
  deleteWebhook(): Promise<TelegramResult<true>>;
  sendMessage(input: { chatId: number; text: string }): Promise<TelegramResult<{ messageId: number | null }>>;
}

interface Answer {
  ok?: unknown;
  result?: unknown;
  description?: unknown;
  parameters?: { retry_after?: unknown } | null;
}

function failure(httpStatus: number, answer: Answer | null): TelegramFailure {
  const description = typeof answer?.description === "string" ? answer.description : `HTTP ${httpStatus}`;
  const error = `Telegram answered ${httpStatus}: ${description}`;
  if (httpStatus === 429) {
    const wait = answer?.parameters?.retry_after;
    return { ok: false, kind: "retry", reason: "rate_limited", error, httpStatus, ...(typeof wait === "number" && wait > 0 ? { retryAfterSeconds: Math.ceil(wait) } : {}) };
  }
  if (httpStatus >= 500) return { ok: false, kind: "retry", reason: "unavailable", error, httpStatus };
  if (httpStatus === 401 || httpStatus === 404) return { ok: false, kind: "reject", reason: "unauthorized", error, httpStatus };
  if (httpStatus === 403) return { ok: false, kind: "reject", reason: "blocked", error, httpStatus };
  if (httpStatus === 400 && /chat not found/i.test(description)) return { ok: false, kind: "reject", reason: "chat_not_found", error, httpStatus };
  return { ok: false, kind: "reject", reason: "bad_request", error, httpStatus };
}

export function telegramClient(token: string, outbound: typeof fetch, timeoutMs = TELEGRAM_TIMEOUT_MS): TelegramClient {
  const hide = (text: string) => (token ? text.split(token).join("<bot token>") : text);

  async function call<T>(method: string, body: Record<string, unknown>, read: (result: unknown) => T): Promise<TelegramResult<T>> {
    let response: Response;
    try {
      response = await outbound(`${TELEGRAM_API_ORIGIN}/bot${token}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      if ((error as { name?: unknown } | null)?.name === "TimeoutError") return { ok: false, kind: "retry", reason: "unreachable", error: `Telegram did not answer within ${timeoutMs / 1000} s` };
      return { ok: false, kind: "retry", reason: "unreachable", error: hide(`Telegram could not be reached: ${(error as Error)?.message ?? String(error)}`) };
    }
    let answer: Answer | null = null;
    try {
      answer = (await response.json()) as Answer;
    } catch {
      answer = null;
    }
    if (response.ok && answer?.ok === true) {
      try {
        return { ok: true, result: read(answer.result), httpStatus: response.status };
      } catch {
        return { ok: false, kind: "retry", reason: "unavailable", error: `Telegram's answer to ${method} could not be read`, httpStatus: response.status };
      }
    }
    const failed = failure(response.status, answer);
    return { ...failed, error: hide(failed.error) };
  }

  return {
    getMe: () =>
      call("getMe", {}, (result) => {
        const bot = result as { id?: unknown; username?: unknown; first_name?: unknown };
        if (typeof bot.id !== "number" || typeof bot.username !== "string") throw new Error("not a bot");
        return { id: bot.id, username: bot.username, firstName: typeof bot.first_name === "string" ? bot.first_name : bot.username };
      }),
    setWebhook: ({ url, secretToken }) => call("setWebhook", { url, secret_token: secretToken, allowed_updates: TELEGRAM_ALLOWED_UPDATES, drop_pending_updates: true }, () => true as const),
    deleteWebhook: () => call("deleteWebhook", { drop_pending_updates: true }, () => true as const),
    sendMessage: ({ chatId, text }) =>
      call("sendMessage", { chat_id: chatId, text, link_preview_options: { is_disabled: true } }, (result) => {
        const messageId = (result as { message_id?: unknown } | null)?.message_id;
        return { messageId: typeof messageId === "number" ? messageId : null };
      }),
  };
}
