// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventConsumer, EventDelivery } from "@/features/events/types";

const server = vi.hoisted(() => ({
  consumers: [] as EventConsumer[],
  deliveries: [] as EventDelivery[],
  calls: [] as Array<{ method: string; path: string; body?: unknown }>,
  refuse: null as null | { status: number; code: string },
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
      if (method === "GET" && url.pathname === "/api/stores/me") return { success: true, data: { storeApiKey: "sk_store_key" } };
      if (method === "GET" && url.pathname === "/api/event-deliveries") {
        const state = url.searchParams.get("state");
        const data = server.deliveries.filter((d) => d.consumerId === url.searchParams.get("consumerId") && (!state || d.state === state));
        return { success: true, data, nextCursor: null };
      }
      const consumerMatch = /^\/api\/event-consumers\/([^/]+)$/.exec(url.pathname);
      if (method === "PATCH" && consumerMatch) {
        const consumer = server.consumers.find((c) => c.id === consumerMatch[1])!;
        Object.assign(consumer, { enabled: body.enabled, disabledReason: body.enabled ? null : "merchant" });
        return { success: true, data: consumer };
      }
      if (method === "POST" && /\/replay$/.test(url.pathname)) return { success: true, data: { reopened: 2, created: 1 } };
      if (method === "POST" && /\/retry$/.test(url.pathname)) return { success: true, data: { reopened: 1, created: 0 } };
      throw new Error(`unexpected ${method} ${path}`);
    }),
  };
});

const notifications = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/notify", () => ({ notify: notifications }));

import { ConfirmDialogProvider } from "@/components/ui";
import { Integrations } from "./Integrations";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

const consumer = (over: Partial<EventConsumer>): EventConsumer => ({
  id: "meta-conversions", kind: "meta_capi", name: "Meta conversions", enabled: true, subscription: ["order.created"], catalogueVersion: 1,
  builtIn: true, disabledReason: null, failingSince: null, deliveries: { due: 0, dead: 0 }, webhook: null, createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z", ...over,
});
const delivery = (sequence: number, state: EventDelivery["state"], consumerId = "meta-conversions"): EventDelivery => ({
  id: `d${sequence}`, consumerId, state, attempts: state === "dead" ? 8 : 1, nextAttemptAt: null, lastError: state === "dead" ? "HTTP 500" : null,
  createdAt: "2026-10-25T09:00:00Z", settledAt: null, event: { id: `e${sequence}`, sequence, type: "order.created", orderId: "o1", occurredAt: "2026-10-25T09:00:00Z" },
});

const hook = (id: string, over: Partial<EventConsumer> = {}) =>
  consumer({ id, kind: "webhook", name: `Hook ${id}`, builtIn: false, webhook: { url: `https://erp.example.dz/${id}`, signingSecret: "••••abcd", previousSecretSignsUntil: null } as EventConsumer["webhook"], ...over });

beforeEach(() => {
  window.localStorage.setItem("locale", "en");
  server.consumers = [];
  server.deliveries = [];
  server.calls = [];
  server.refuse = null;
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

async function mount({ canManage = true, showApiKey = false } = {}) {
  await act(async () => {
    root.render(
      <ConfirmDialogProvider>
        <Integrations canManage={canManage} showApiKey={showApiKey} />
      </ConfirmDialogProvider>,
    );
  });
}

const settle = () => act(async () => {});
const text = () => document.body.textContent ?? "";
const button = (label: string, scope: Pick<Element, "querySelectorAll"> = document.body) =>
  Array.from(scope.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent?.trim() === label)!;
const toggle = (id: string) => row(id).querySelector<HTMLButtonElement>('[role="switch"]')!;
const menu = async (id: string, label: string) => {
  await click(row(id).querySelector<HTMLButtonElement>('button[aria-label^="More actions for"]')!);
  return button(label);
};
const row = (id: string) => host.querySelector<HTMLElement>(`[data-consumer="${id}"]`)!;
const click = async (target: HTMLElement) => {
  await act(async () => target.click());
  await settle();
};
const type = async (input: HTMLInputElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

describe("the Integrations page", () => {
  it("says so when no webhook receives the events, and offers to add one right there", async () => {
    await mount();
    expect(text()).toContain("No webhooks yet");
    expect(text()).toContain("Your server receives each order and delivery step as it happens.");
    expect(Array.from(host.querySelectorAll("button")).filter((b) => b.textContent?.trim() === "Add webhook")).toHaveLength(2);
    expect(host.querySelector("h1")!.textContent).toContain("Integrations");
  });

  it("lists the merchant's webhooks only: a Built-in Consumer is on its App's page", async () => {
    server.consumers = [consumer({}), hook("erp")];
    await mount();
    expect(Array.from(host.querySelectorAll("[data-consumer]")).map((li) => li.getAttribute("data-consumer"))).toEqual(["erp"]);
    expect(text()).not.toContain("Meta conversions");
    expect(text()).toContain("Webhooks");
  });

  it("sums up how the webhooks stand: how many work, what is on its way, what was given up", async () => {
    server.consumers = [
      consumer({ deliveries: { due: 9, dead: 9 } }),
      hook("a", { deliveries: { due: 2, dead: 3 } }),
      hook("b", { enabled: false, disabledReason: "failing", deliveries: { due: 0, dead: 4 } }),
      hook("c", { deliveries: { due: 5, dead: 0 } }),
    ];
    await mount();
    const figures = Array.from(host.querySelectorAll("section")).map((section) => section.textContent);
    expect(figures).toContain("Active2 / 3");
    expect(figures).toContain("On their way7");
    expect(figures).toContain("Given up7");
  });

  it("shows no figures before there is anything to sum", async () => {
    await mount();
    expect(text()).not.toContain("On their way");
  });

  it("offers adding a webhook only to whoever may manage them", async () => {
    server.consumers = [hook("erp")];
    await mount({ canManage: false });
    expect(button("Add webhook")).toBeUndefined();
    expect(toggle("erp").disabled).toBe(true);
  });

  it("shows the store's API key to an admin only", async () => {
    await mount();
    expect(text()).not.toContain("Store API key");
    expect(server.calls.some((c) => c.path === "/api/stores/me")).toBe(false);

    act(() => root.unmount());
    root = createRoot(host);
    await mount({ showApiKey: true });
    await settle();
    expect(text()).toContain("Store API key");
    expect(host.querySelector<HTMLInputElement>('input[aria-label="Storefront API key"]')!.value).toBe("sk_store_key");
  });
});
