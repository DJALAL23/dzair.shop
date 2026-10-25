// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventConsumer, WebhookTest } from "@/features/events/types";

const SECRET = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSwTestTestTest=";
const server = vi.hoisted(() => ({
  consumers: [] as EventConsumer[],
  calls: [] as Array<{ method: string; path: string; body?: unknown }>,
  refuse: null as null | { status: number; code: string },
  test: null as null | WebhookTest,
}));

vi.mock("@/lib/api", () => {
  class ApiError extends Error {
    constructor(message: string, public status: number, public code?: string) {
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
      const url = new URL(path, "https://api.test");
      if (method === "GET" && url.pathname === "/api/event-consumers") return { success: true, data: server.consumers };
      if (method === "POST" && url.pathname === "/api/event-consumers") {
        const created = webhook({ id: "new", name: body.name, subscription: body.subscription, webhook: { url: body.url, signingSecret: `••••${SECRET.slice(-4)}`, secretRotatedAt: null, previousSecretSignsUntil: null } });
        server.consumers.push(created);
        return { success: true, data: { consumer: created, signingSecret: SECRET } };
      }
      const one = /^\/api\/event-consumers\/([^/]+)(\/[a-z-]+)?$/.exec(url.pathname);
      const found = one && server.consumers.find((c) => c.id === one[1]);
      if (method === "PATCH" && found) return { success: true, data: Object.assign(found, body) };
      if (method === "DELETE" && found) {
        server.consumers = server.consumers.filter((c) => c !== found);
        return { success: true, message: "Webhook deleted" };
      }
      if (method === "POST" && one?.[2] === "/rotate-secret") return { success: true, data: { signingSecret: "whsec_rotated", previousSecretSignsUntil: new Date(Date.now() + 24 * 3600_000).toISOString() } };
      if (method === "POST" && one?.[2] === "/test") return { success: true, data: server.test };
      throw new Error(`unexpected ${method} ${path}`);
    }),
  };
});

const notifications = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/notify", () => ({ notify: notifications }));

import { ConfirmDialogProvider } from "@/components/ui";
import { IntegrationsSettings } from "./IntegrationsSettings";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function webhook(over: Partial<EventConsumer>): EventConsumer {
  return {
    id: "hook", kind: "webhook", name: "Order system", enabled: true, builtIn: false, subscription: ["shipment.*"], catalogueVersion: 1, disabledReason: null, failingSince: null,
    deliveries: { due: 0, dead: 0 }, webhook: { url: "https://erp.example.dz/hooks", signingSecret: "••••Xw4=", secretRotatedAt: null, previousSecretSignsUntil: null },
    createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z", ...over,
  };
}
const meta = (): EventConsumer => ({ ...webhook({ id: "meta-conversions", kind: "meta_capi", name: "Meta conversions", builtIn: true, webhook: null, subscription: ["order.created"] }) });

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  window.localStorage.setItem("locale", "en");
  server.consumers = [];
  server.calls = [];
  server.refuse = null;
  server.test = null;
  notifications.success.mockClear();
  notifications.error.mockClear();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});

async function mount() {
  await act(async () => {
    root.render(
      <ConfirmDialogProvider>
        <IntegrationsSettings />
      </ConfirmDialogProvider>,
    );
  });
}

const text = () => document.body.textContent ?? "";
const buttons = (scope: Pick<Element, "querySelectorAll"> = document.body) => Array.from(scope.querySelectorAll<HTMLButtonElement>("button"));
const button = (label: string, scope?: Pick<Element, "querySelectorAll">) => buttons(scope).find((b) => b.textContent?.trim() === label || b.getAttribute("aria-label") === label);
const dialog = () => document.body.querySelector<HTMLElement>('[role="dialog"], [role="alertdialog"]');
const row = (id: string) => host.querySelector<HTMLElement>(`[data-consumer="${id}"]`)!;
const box = (pattern: string) => document.body.querySelector<HTMLInputElement>(`input[data-pattern="${pattern}"]`)!;
const click = async (target: HTMLElement) => {
  await act(async () => target.click());
  await act(async () => {});
};
const type = async (input: HTMLInputElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const inputs = () => Array.from(dialog()!.querySelectorAll<HTMLInputElement>('input:not([type="checkbox"])'));
const writes = () => server.calls.filter((c) => c.method !== "GET");

describe("adding a webhook", () => {
  it("is offered only once everything it needs is right, and its secret is shown once", async () => {
    server.consumers = [meta()];
    await mount();
    await click(button("Add webhook")!);
    const submit = () => button("Add webhook", dialog()!)!;
    expect(submit().disabled).toBe(true);

    const [name, url] = inputs();
    await type(name!, "  ERP  ");
    await type(url!, "https://erp.example.dz/hooks");
    expect(submit().disabled).toBe(true);
    expect(text()).toContain("Choose at least one event.");
    await click(box("order.created"));
    expect(submit().disabled).toBe(false);
    await type(url!, "http://erp.example.dz/hooks");
    expect(text()).toContain("Use an https:// address.");
    expect(submit().disabled).toBe(true);
    await type(url!, "https://192.168.1.10/hooks");
    expect(text()).toContain("Use an address on the public internet, not a local or private one.");
    expect(submit().disabled).toBe(true);
    await type(url!, "https://erp.example.dz/hooks");

    await click(box("order.*"));
    expect(box("order.created")).toMatchObject({ checked: true, disabled: true });
    expect(box("shipment.delivered")).toMatchObject({ checked: false, disabled: false });
    await click(box("shipment.delivered"));
    await click(submit());

    expect(writes()).toEqual([{ method: "POST", path: "/api/event-consumers", body: { kind: "webhook", name: "ERP", url: "https://erp.example.dz/hooks", subscription: ["order.*", "shipment.delivered"] } }]);
    expect(dialog()!.textContent).toContain("Webhook added: copy its signing secret");
    expect(dialog()!.querySelector<HTMLInputElement>("input[readonly]")!.value).toBe(SECRET);

    await click(button("I've saved it")!);
    expect(dialog()).toBeNull();
    expect(row("new").textContent).toContain("https://erp.example.dz/hooks");
    expect(row("new").textContent).toContain(`Signing secret ••••${SECRET.slice(-4)}`);
    expect(row("new").querySelector('bdi[dir="ltr"]')!.textContent).toBe(`••••${SECRET.slice(-4)}`);
    expect(text()).not.toContain(SECRET);
  });

  it("is not offered past the store's limit", async () => {
    server.consumers = Array.from({ length: 10 }, (_, i) => webhook({ id: `h${i}` }));
    await mount();
    expect(button("Add webhook")!.disabled).toBe(true);
    expect(text()).toContain("A store can have up to 10 webhooks. Delete one to add another.");
  });

  it("says why the store refused it, and keeps what was typed", async () => {
    await mount();
    await click(button("Add webhook")!);
    const [name, url] = inputs();
    await type(name!, "ERP");
    await type(url!, "https://erp.example.dz/hooks");
    await click(box("*"));
    server.refuse = { status: 409, code: "EVENT_CONSUMER_LIMIT_REACHED" };
    await click(button("Add webhook", dialog()!)!);
    expect(dialog()!.querySelector('[role="alert"]')!.textContent).toBe("Your store already has as many webhooks as it can. Delete one first.");
    expect(inputs()[0]!.value).toBe("ERP");
  });
});

describe("a webhook in the list", () => {
  it("is edited by what changed alone", async () => {
    server.consumers = [webhook({})];
    await mount();
    await click(button("More actions for Order system")!);
    await click(button("Edit")!);
    expect(inputs().map((i) => i.value)).toEqual(["Order system", "https://erp.example.dz/hooks"]);
    expect(box("shipment.*").checked).toBe(true);
    await type(inputs()[0]!, "ERP");
    await click(button("Save", dialog()!)!);
    expect(writes()).toEqual([{ method: "PATCH", path: "/api/event-consumers/hook", body: { name: "ERP" } }]);
    expect(notifications.success).toHaveBeenCalledWith("Webhook saved.");
  });

  it("changes its signing secret only once confirmed, and shows the new one with when the old stops", async () => {
    server.consumers = [webhook({})];
    await mount();
    await click(button("More actions for Order system")!);
    await click(button("Change signing secret")!);
    expect(text()).toContain("Change the signing secret of Order system?");
    await click(button("Cancel", dialog()!)!);
    expect(writes()).toEqual([]);

    await click(button("More actions for Order system")!);
    await click(button("Change signing secret")!);
    await click(button("Change secret", dialog()!)!);
    expect(writes()).toEqual([{ method: "POST", path: "/api/event-consumers/hook/rotate-secret" }]);
    expect(dialog()!.textContent).toContain("Copy the new signing secret");
    expect(dialog()!.textContent).toMatch(/stops (in 24 hours|tomorrow)/);
    expect(dialog()!.querySelector<HTMLInputElement>("input[readonly]")!.value).toBe("whsec_rotated");
  });

  it("is deleted only once confirmed", async () => {
    server.consumers = [webhook({})];
    await mount();
    await click(button("More actions for Order system")!);
    await click(button("Delete")!);
    expect(text()).toContain("Delete Order system?");
    await click(button("Cancel", dialog()!)!);
    expect(writes()).toEqual([]);
    expect(row("hook")).toBeTruthy();

    await click(button("More actions for Order system")!);
    await click(button("Delete")!);
    await click(button("Delete", dialog()!)!);
    expect(writes()).toEqual([{ method: "DELETE", path: "/api/event-consumers/hook" }]);
    expect(notifications.success).toHaveBeenCalledWith("Webhook deleted.");
    expect(host.querySelector('[data-consumer="hook"]')).toBeNull();
  });

  it("is sent a test event of a type it receives, and shows what its endpoint answered", async () => {
    server.consumers = [webhook({})];
    server.test = { event: { id: "test_1", type: "shipment.handed_off" }, outcome: "delivered", httpStatus: 200, durationMs: 42, response: '{"ok":true}', error: null };
    await mount();
    await click(button("Send test event", row("hook"))!);
    expect(dialog()!.textContent).toContain("https://erp.example.dz/hooks");
    expect(dialog()!.querySelector<HTMLElement & { value: string }>("select")!.value).toBe("shipment.handed_off");
    await click(button("Send", dialog()!)!);
    expect(writes()).toEqual([{ method: "POST", path: "/api/event-consumers/hook/test", body: { type: "shipment.handed_off" } }]);
    expect(dialog()!.textContent).toContain("Delivered: your endpoint answered HTTP 200 in 42 ms.");
    expect(dialog()!.querySelector("pre")!.textContent).toBe('{"ok":true}');

    server.test = { event: { id: "test_2", type: "shipment.handed_off" }, outcome: "retry", httpStatus: 401, durationMs: 30, response: null, error: "HTTP 401" };
    await click(button("Send", dialog()!)!);
    expect(dialog()!.textContent).toContain("Not delivered: HTTP 401");
    expect(dialog()!.querySelector('bdi[dir="ltr"]')!.textContent).toBe("HTTP 401");
    expect(dialog()!.querySelector('p[dir="ltr"]')!.textContent).toBe("https://erp.example.dz/hooks");
    expect(dialog()!.querySelector("pre")).toBeNull();
  });

  it("says when the previous secret stops signing, while it still does", async () => {
    server.consumers = [
      webhook({ webhook: { url: "https://erp.example.dz/hooks", signingSecret: "••••Xw4=", secretRotatedAt: "2026-10-25T10:00:00Z", previousSecretSignsUntil: new Date(Date.now() + 3 * 3600_000).toISOString() } }),
      webhook({ id: "old", webhook: { url: "https://old.example.dz/", signingSecret: "••••abcd", secretRotatedAt: "2026-10-01T10:00:00Z", previousSecretSignsUntil: "2026-10-02T10:00:00Z" } }),
    ];
    await mount();
    expect(row("hook").textContent).toMatch(/The previous secret stops signing in 3 hours\./);
    expect(row("old").textContent).not.toContain("previous secret");
  });
});

describe("a built-in Consumer", () => {
  it("is started and stopped, never edited, tested, re-keyed or deleted", async () => {
    server.consumers = [meta()];
    await mount();
    const actions = buttons(row("meta-conversions")).map((b) => b.textContent?.trim() || b.getAttribute("aria-label"));
    expect(actions).toEqual(["Deliveries", "Deliver again…", "Stop"]);
  });
});
