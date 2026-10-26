// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({
  fetchIdentity: vi.fn(),
  knownIdentity: vi.fn(),
  watchIdentity: vi.fn(() => () => undefined),
  currentJwt: vi.fn(),
  refreshJwt: vi.fn(),
  SessionUnavailableError: class extends Error {},
}));
vi.mock("@/lib/session", () => session);

const server = vi.hoisted(() => ({
  telegram: null as null | Record<string, unknown>,
  refuse: null as null | { status: number; code: string },
  test: { delivered: true, httpStatus: 200, reason: null, error: null } as Record<string, unknown>,
  removal: { updatesStopped: true, error: null } as Record<string, unknown>,
  calls: [] as Array<{ method: string; path: string; body?: unknown }>,
}));
vi.mock("@/lib/api", () => {
  class ApiError extends Error {
    constructor(
      message: string,
      public status: number,
      public code?: string,
    ) {
      super(message);
    }
  }
  return {
    ApiError,
    apiFetch: vi.fn(async (path: string, init: RequestInit = {}) => {
      const method = init.method ?? "GET";
      const body = init.body ? JSON.parse(String(init.body)) : undefined;
      server.calls.push({ method, path, ...(body === undefined ? {} : { body }) });
      if (method !== "GET" && server.refuse) throw new ApiError("refused", server.refuse.status, server.refuse.code);
      if (method === "GET" && path === "/api/apps") return { success: true, data: [{ key: "telegram", category: "messaging", status: server.telegram ? "on" : "not_set_up" }] };
      if (method === "GET" && path === "/api/apps/telegram") return { success: true, data: server.telegram };
      if (method === "PUT" && path === "/api/apps/telegram/bot") {
        server.telegram = { ...BOT_SAVED };
        return { success: true, data: server.telegram };
      }
      if (method === "POST" && path === "/api/apps/telegram/pairing") return { success: true, data: { url: "https://t.me/acme_orders_bot?start=CODE", expiresAt: new Date(Date.now() + 15 * 60_000).toISOString() } };
      if (method === "POST" && path === "/api/apps/telegram/test") return { success: true, data: server.test };
      if (method === "PATCH" && path === "/api/apps/telegram") {
        server.telegram = { ...server.telegram, ...body };
        return { success: true, data: server.telegram };
      }
      if (method === "DELETE" && path === "/api/apps/telegram") return { success: true, data: server.removal };
      if (method === "GET" && path === "/api/event-consumers") return { success: true, data: [] };
      throw new Error(`unexpected ${method} ${path}`);
    }),
  };
});
const notifications = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/notify", () => ({ notify: notifications }));
vi.mock("@/components/ui/confirm-dialog", async (original) => ({ ...(await original<object>()), useConfirmDialog: () => async () => true }));

import AppPageApp from "../components/AppPageApp";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TOKEN = "987654321:AAdashboard-test-token-not-real-x9Qa";
const BOT_SAVED = {
  consumerId: "tg",
  enabled: false,
  disabledReason: "not_connected",
  failingSince: null,
  bot: { id: 987654321, username: "acme_orders_bot", tokenMasked: "••••x9Qa" },
  chat: null,
  pairingExpiresAt: null,
  events: ["order.created", "shipment.delivered", "shipment.delivery_failed"],
  language: null,
  writesIn: "fr",
};
const CONNECTED = { ...BOT_SAVED, enabled: true, disabledReason: null, chat: { name: "Amina", connectedAt: "2026-10-26T08:00:00.000Z" } };

let root: Root;
let host: HTMLDivElement;
const identity = (role: "admin" | "staff", scopes: string[]) => ({ user: { id: "u2", name: "Samira", email: "samira@example.com" }, role, scopes });

beforeEach(() => {
  window.localStorage.setItem("locale", "en");
  server.telegram = null;
  server.refuse = null;
  server.test = { delivered: true, httpStatus: 200, reason: null, error: null };
  server.removal = { updatesStopped: true, error: null };
  server.calls = [];
  notifications.success.mockClear();
  notifications.error.mockClear();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
  vi.useRealTimers();
});

const settle = async () => {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await vi.dynamicImportSettled();
    });
  }
};
async function open(who: ReturnType<typeof identity>) {
  session.knownIdentity.mockReturnValue(who);
  session.fetchIdentity.mockResolvedValue(who);
  await act(async () => root.render(<AppPageApp appKey="telegram" />));
  await settle();
}
const ADMIN = identity("admin", []);
const text = () => document.body.textContent ?? "";
const button = (label: string) => Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent?.trim() === label);
const writes = () => server.calls.filter((call) => call.method !== "GET");
const click = async (element: Element | undefined) => {
  expect(element).toBeTruthy();
  await act(async () => (element as HTMLElement).click());
  await settle();
};
async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("setting up the Telegram App", () => {
  it("explains how to make a bot, then saves its token and shows the bot", async () => {
    await open(ADMIN);
    expect(text()).toContain("open @BotFather and send /newbot");
    const input = document.querySelector<HTMLInputElement>('input[type="password"]')!;
    await type(input, TOKEN);
    await click(button("Save the bot"));
    expect(writes()).toEqual([{ method: "PUT", path: "/api/apps/telegram/bot", body: { token: TOKEN } }]);
    expect(text()).toContain("@acme_orders_bot");
    expect(text()).toContain("••••x9Qa");
    expect(text()).not.toContain(TOKEN);
    expect(button("Connect in Telegram")).toBeTruthy();
  });

  it("says why Telegram refused, in the merchant's language", async () => {
    await open(ADMIN);
    await type(document.querySelector<HTMLInputElement>('input[type="password"]')!, TOKEN);
    for (const [code, message] of [
      ["TELEGRAM_TOKEN_REFUSED", "Telegram does not accept this token."],
      ["TELEGRAM_NEEDS_PUBLIC_URL", "Telegram can only reach your store over https."],
      ["EXTERNAL_API_FAILURE", "Telegram could not be reached."],
    ] as const) {
      server.refuse = { status: 400, code };
      await click(button("Save the bot"));
      expect(document.querySelector('[role="alert"]')!.textContent).toContain(message);
    }
  });
});

describe("connecting a chat", () => {
  it("opens the pairing link and waits until the chat is connected", async () => {
    server.telegram = { ...BOT_SAVED };
    const tab = { opener: {}, location: { href: "" }, close: vi.fn() };
    vi.spyOn(window, "open").mockReturnValue(tab as never);
    await open(ADMIN);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await click(button("Connect in Telegram"));
    expect(tab.location.href).toBe("https://t.me/acme_orders_bot?start=CODE");
    expect(tab.opener).toBeNull();
    expect(text()).toContain("Waiting for you to press Start in Telegram");

    server.telegram = { ...CONNECTED };
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3100);
    });
    await settle();
    expect(text()).toContain("Connected to Amina");
    expect(text()).not.toContain("Waiting for you to press Start");
  });

  it("sends a test message and says what Telegram answered", async () => {
    server.telegram = { ...CONNECTED };
    await open(ADMIN);
    await click(button("Send a test message"));
    expect(text()).toContain("Sent. Check your Telegram chat.");

    server.test = { delivered: false, httpStatus: 403, reason: "blocked", error: "Telegram answered 403: Forbidden: bot was blocked by the user" };
    await click(button("Send a test message"));
    expect(text()).toContain("the chat blocked the bot");
  });
});

describe("the notifications", () => {
  it("save the events and the language chosen", async () => {
    server.telegram = { ...CONNECTED };
    await open(ADMIN);
    await click(document.querySelector('input[data-event-type="shipment.delivered"]')!);
    await click(document.querySelector('input[data-event-type="order.cancelled"]')!);
    const select = document.querySelector("select")!;
    expect(select.options[0]!.textContent).toBe("The store's language (Français)");
    await act(async () => {
      select.value = "ar";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await click(button("Save changes"));
    expect(writes()).toEqual([{ method: "PATCH", path: "/api/apps/telegram", body: { events: ["order.created", "shipment.delivery_failed", "order.cancelled"], language: "ar" } }]);
  });

  it("refuse to save with no event", async () => {
    server.telegram = { ...CONNECTED, events: ["order.created"] };
    await open(ADMIN);
    await click(document.querySelector('input[data-event-type="order.created"]')!);
    await click(button("Save changes"));
    expect(writes()).toEqual([]);
    expect(text()).toContain("Choose at least one event.");
  });

  it("say why nothing is sent when the chat blocked the bot", async () => {
    server.telegram = { ...CONNECTED, enabled: false, disabledReason: "bot_blocked" };
    await open(ADMIN);
    expect(text()).toContain("The chat blocked the bot, so nothing is sent.");
  });
});

describe("someone who may only look", () => {
  it("sees the bot and the chat, never a field or an action, and changes nothing", async () => {
    server.telegram = { ...CONNECTED };
    await open(identity("staff", ["telegram:read"]));
    expect(text()).toContain("@acme_orders_bot");
    expect(text()).toContain("Connected to Amina");
    expect(document.querySelector('input[type="password"]')).toBeNull();
    for (const label of ["Use another token", "Connect another chat", "Send a test message", "Remove app"]) expect(button(label), label).toBeUndefined();
    expect(writes()).toEqual([]);
  });
});

describe("removing the Telegram App", () => {
  it("says so when Telegram could not be told to stop", async () => {
    server.telegram = { ...CONNECTED };
    server.removal = { updatesStopped: false, error: "Telegram answered 401: Unauthorized" };
    await open(ADMIN);
    await click(button("Remove app"));
    expect(writes()).toEqual([{ method: "DELETE", path: "/api/apps/telegram" }]);
    expect(notifications.error).toHaveBeenCalledWith(expect.stringContaining("Telegram could not be told to stop"));
    expect(notifications.success).not.toHaveBeenCalled();
  });
});
