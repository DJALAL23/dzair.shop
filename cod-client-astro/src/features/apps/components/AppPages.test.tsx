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
  apps: [] as Array<{ key: string; category: string; status: string }>,
  turnstile: null as null | Record<string, unknown>,
  consumers: [] as unknown[],
  calls: [] as Array<{ method: string; path: string }>,
}));
vi.mock("@/lib/api", () => ({
  ApiError: class extends Error {},
  apiFetch: vi.fn(async (path: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    server.calls.push({ method, path });
    if (method === "GET" && path === "/api/apps") return { success: true, data: server.apps };
    if (method === "GET" && path === "/api/apps/turnstile") return { success: true, data: server.turnstile };
    if (method === "DELETE" && path === "/api/apps/turnstile") {
      server.turnstile = null;
      server.apps = server.apps.map((app) => (app.key === "turnstile" ? { ...app, status: "not_set_up" } : app));
      return { success: true, message: "App removed" };
    }
    if (method === "GET" && path === "/api/apps/meta") return { success: true, data: null };
    if (method === "GET" && path === "/api/event-consumers") return { success: true, data: server.consumers };
    throw new Error(`unexpected ${method} ${path}`);
  }),
}));
const notifications = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/notify", () => ({ notify: notifications }));

import AppsPageApp from "./AppsPageApp";
import AppPageApp from "./AppPageApp";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
const identity = (role: "admin" | "staff", scopes: string[]) => ({ user: { id: "u2", name: "Samira", email: "samira@example.com" }, role, scopes });
const ALL_APPS = [
  { key: "meta", category: "marketing", status: "needs_attention" },
  { key: "dzverify", category: "checkout_protection", status: "not_set_up" },
  { key: "turnstile", category: "checkout_protection", status: "on" },
  { key: "sendili", category: "messaging", status: "off" },
  { key: "whatsapp-button", category: "storefront", status: "on" },
];
const TURNSTILE = { siteKey: "0x4AAA-site", enabled: true, secretKeyMasked: "••••cret", createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z" };

beforeEach(() => {
  window.localStorage.setItem("locale", "en");
  server.apps = ALL_APPS.map((app) => ({ ...app }));
  server.turnstile = { ...TURNSTILE };
  server.consumers = [];
  server.calls = [];
  notifications.success.mockClear();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
});

const settle = async () => {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await vi.dynamicImportSettled();
    });
  }
};
async function open(element: React.ReactElement, who: ReturnType<typeof identity>) {
  session.knownIdentity.mockReturnValue(who);
  session.fetchIdentity.mockResolvedValue(who);
  await act(async () => root.render(element));
  await settle();
}
const text = () => document.body.textContent ?? "";
const button = (label: string, scope: Pick<Element, "querySelectorAll"> = document.body) =>
  Array.from(scope.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent?.trim() === label);
const writes = () => server.calls.filter((call) => call.method !== "GET");

describe("the Apps page", () => {
  it("shows the store's Apps by category, each with where it stands and a way to its page", async () => {
    await open(<AppsPageApp />, identity("admin", []));
    expect(host.querySelector("h1")!.textContent).toContain("Apps");
    expect(Array.from(host.querySelectorAll("h2")).map((h) => h.textContent)).toEqual(["Marketing", "Checkout protection", "Messaging", "Storefront"]);
    const cards = Array.from(host.querySelectorAll<HTMLAnchorElement>("a[data-app]"));
    expect(cards.map((card) => card.getAttribute("href"))).toEqual(["/apps/meta", "/apps/dzverify", "/apps/turnstile", "/apps/sendili", "/apps/whatsapp-button"]);
    expect(cards[0].textContent).toContain("Needs attention");
    expect(cards[1].textContent).toContain("Not set up");
    expect(cards[3].textContent).toContain("Off");
    expect(cards[4].textContent).toContain("WhatsApp button");
  });

  it("shows only what the server lists for the member", async () => {
    server.apps = [ALL_APPS[2]];
    await open(<AppsPageApp />, identity("staff", ["turnstile:read"]));
    expect(Array.from(host.querySelectorAll("a[data-app]")).map((card) => card.getAttribute("data-app"))).toEqual(["turnstile"]);
    expect(Array.from(host.querySelectorAll("h2")).map((h) => h.textContent)).toEqual(["Checkout protection"]);
  });

  it("stays shut, asking nothing of the server, for a member who may see no App", async () => {
    await open(<AppsPageApp />, identity("staff", ["orders:read", "settings:verification", "integrations:manage"]));
    expect(text()).toContain("You do not have permission to access this page.");
    expect(server.calls).toEqual([]);
  });
});

describe("an App Page", () => {
  it("frames the App with its name, what it does and where it stands", async () => {
    await open(<AppPageApp appKey="turnstile" />, identity("admin", []));
    const header = host.querySelector("header")!;
    expect(header.querySelector("h1")!.textContent).toBe("Turnstile");
    expect(header.textContent).toContain("On");
    expect(header.textContent).toContain("Cloudflare's bot check on your order form");
    expect(header.querySelector('a[href="/apps"]')!.getAttribute("aria-label")).toBe("Back to Apps");
    expect(text()).toContain("Bot check at checkout");
    expect(button("Save changes")).toBeDefined();
  });

  it("lets a member who may only see the App look, never change or remove it", async () => {
    await open(<AppPageApp appKey="turnstile" />, identity("staff", ["turnstile:read"]));
    expect(text()).toContain("You can see this App but not change it.");
    expect(button("Save changes")).toBeUndefined();
    expect(button("Remove app")).toBeUndefined();
    expect(host.querySelector<HTMLFieldSetElement>("fieldset")!.disabled).toBe(true);
    expect(writes()).toEqual([]);
  });

  it("stays shut for a member without the App's own permission, asking nothing of the server", async () => {
    await open(<AppPageApp appKey="turnstile" />, identity("staff", ["dzverify:read", "dzverify:manage", "settings:verification"]));
    expect(text()).toContain("You do not have permission to access this page.");
    expect(server.calls).toEqual([]);
  });

  it("removes the App once the merchant confirms, then shows it as never set up", async () => {
    await open(<AppPageApp appKey="turnstile" />, identity("staff", ["turnstile:read", "turnstile:manage"]));
    await act(async () => button("Remove app")!.click());
    await settle();
    expect(text()).toContain("Remove Turnstile?");
    await act(async () => button("Cancel", document.body.querySelector('[role="alertdialog"], [role="dialog"]')!)!.click());
    await settle();
    expect(writes()).toEqual([]);

    await act(async () => button("Remove app")!.click());
    await settle();
    await act(async () => button("Remove", document.body.querySelector('[role="alertdialog"], [role="dialog"]')!)!.click());
    await settle();
    expect(writes()).toEqual([{ method: "DELETE", path: "/api/apps/turnstile" }]);
    expect(notifications.success).toHaveBeenCalledWith("Turnstile removed");
    expect(server.calls.filter((call) => call.path === "/api/apps/turnstile" && call.method === "GET")).toHaveLength(2);
    expect(host.querySelector("header")!.textContent).toContain("Not set up");
    expect(button("Remove app")).toBeUndefined();
  });

  it("offers no removal before the App is set up", async () => {
    server.apps = server.apps.map((app) => (app.key === "turnstile" ? { ...app, status: "not_set_up" } : app));
    server.turnstile = null;
    await open(<AppPageApp appKey="turnstile" />, identity("admin", []));
    expect(host.querySelector("header")!.textContent).toContain("Not set up");
    expect(button("Remove app")).toBeUndefined();
  });

  it("shows the Meta App's own conversions, never the merchant's webhooks", async () => {
    const consumer = (id: string, kind: string, name: string) => ({
      id, kind, name, enabled: true, subscription: [], catalogueVersion: 1, builtIn: kind !== "webhook", disabledReason: null, failingSince: null,
      deliveries: { due: 0, dead: 0 }, webhook: kind === "webhook" ? { url: "https://erp.example.dz", signingSecret: "••••", previousSecretSignsUntil: null } : null, createdAt: "", updatedAt: "",
    });
    server.consumers = [consumer("meta-conversions", "meta_capi", "Meta conversions"), consumer("erp", "webhook", "ERP")];
    await open(<AppPageApp appKey="meta" />, identity("staff", ["meta:read"]));
    expect(text()).toContain("Conversions sent to Meta");
    expect(Array.from(host.querySelectorAll("[data-consumer]")).map((row) => row.getAttribute("data-consumer"))).toEqual(["meta-conversions"]);
    expect(host.querySelector<HTMLButtonElement>('[data-consumer="meta-conversions"] [role="switch"]')!.disabled).toBe(true);
  });
});
