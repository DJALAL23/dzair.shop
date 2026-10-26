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
import { ConsumerRow } from "./ConsumerRow";

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

async function mount(canManage = true) {
  const draw = () =>
    root.render(
      <ConfirmDialogProvider>
        <ul>
          {server.consumers.map((shown) => (
            <ConsumerRow key={shown.id} consumer={shown} canManage={canManage} onChanged={draw} />
          ))}
        </ul>
      </ConfirmDialogProvider>,
    );
  await act(async () => draw());
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

describe("a Consumer row", () => {
  it("shows how a Consumer stands", async () => {
    server.consumers = [
      consumer({ deliveries: { due: 2, dead: 3 } }),
      consumer({ id: "hook", kind: "webhook_future", name: "Order hook", enabled: false, disabledReason: "failing" }),
      consumer({ id: "ads", name: "Ads account", deliveries: { due: 0, dead: 0 } }),
    ];
    await mount();
    expect(row("meta-conversions").textContent!.match(/Meta conversions/g)).toHaveLength(1);
    expect(row("meta-conversions").textContent).toContain("Active");
    expect(row("meta-conversions").textContent).toContain("2 on their way");
    expect(row("meta-conversions").textContent).toContain("3 given up");
    expect(row("hook").textContent).toContain("Stopped: every delivery failed for 3 days");
    expect(row("hook").textContent).not.toContain("webhook_future");
    expect(row("hook").querySelector('button[aria-label^="More actions for"]')).toBeNull();
    expect(row("ads").textContent).toContain("Ads account");
    expect(row("ads").textContent).toContain("Meta conversions");
    expect(row("ads").textContent).not.toContain("Native");
  });

  it("stops a Consumer only once the merchant confirms", async () => {
    server.consumers = [consumer({})];
    await mount();
    expect(toggle("meta-conversions").getAttribute("aria-checked")).toBe("true");
    expect(toggle("meta-conversions").getAttribute("aria-label")).toBe("Meta conversions receives events");
    await click(toggle("meta-conversions"));
    expect(text()).toContain("Stop Meta conversions?");
    await click(button("Cancel", document.body.querySelector<HTMLElement>('[role="alertdialog"], [role="dialog"]')!));
    expect(server.calls.filter((c) => c.method === "PATCH")).toEqual([]);
    expect(row("meta-conversions").textContent).toContain("Active");

    await click(toggle("meta-conversions"));
    const dialog = document.body.querySelector<HTMLElement>('[role="alertdialog"], [role="dialog"]')!;
    await click(button("Stop", dialog));
    expect(server.calls.filter((c) => c.method === "PATCH")).toEqual([{ method: "PATCH", path: "/api/event-consumers/meta-conversions", body: { enabled: false } }]);
    expect(row("meta-conversions").textContent).toContain("Stopped");
    expect(toggle("meta-conversions").getAttribute("aria-checked")).toBe("false");
  });

  it("starts a stopped one at once", async () => {
    server.consumers = [consumer({ enabled: false, disabledReason: "merchant" })];
    await mount();
    await click(toggle("meta-conversions"));
    expect(server.calls.filter((c) => c.method === "PATCH")).toEqual([{ method: "PATCH", path: "/api/event-consumers/meta-conversions", body: { enabled: true } }]);
    expect(row("meta-conversions").textContent).toContain("Active");
  });

  it("opens the Deliveries on the ones given up on, and retries one", async () => {
    server.consumers = [consumer({ deliveries: { due: 0, dead: 1 } })];
    server.deliveries = [delivery(4, "dead"), delivery(5, "delivered")];
    await mount();
    await click(button("Deliveries", row("meta-conversions")));
    const sheet = document.body.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(sheet.querySelector("h2")!.textContent).toBe("Deliveries to Meta conversions");
    expect(row("meta-conversions").querySelector("[data-delivery]")).toBeNull();
    const listed = () => Array.from(document.body.querySelectorAll("[data-delivery]")).map((li) => li.getAttribute("data-delivery"));
    expect(listed()).toEqual(["d4"]);
    expect(document.body.querySelector('[data-delivery="d4"]')!.textContent).toContain("Event #4");
    expect(document.body.querySelector('[data-delivery="d4"]')!.textContent).toContain("8 attempts");
    expect(document.body.querySelector('[data-delivery="d4"]')!.textContent).toContain("HTTP 500");

    await click(button("Try again", document.body.querySelector('[data-delivery="d4"]')!));
    expect(server.calls).toContainEqual({ method: "POST", path: "/api/event-deliveries/d4/retry" });
    expect(notifications.success).toHaveBeenCalledWith("The delivery is on its way again.");

    await click(button("All"));
    expect(listed()).toEqual(["d4", "d5"]);
  });

  it("words a refused retry", async () => {
    server.consumers = [consumer({ deliveries: { due: 0, dead: 1 } })];
    server.deliveries = [delivery(4, "dead")];
    server.refuse = { status: 409, code: "EVENT_DELIVERY_ALREADY_DUE" };
    await mount();
    await click(button("Deliveries", row("meta-conversions")));
    await click(button("Try again"));
    expect(notifications.error).toHaveBeenCalledWith("This delivery is already on its way.");
  });

  it("replays the range of what was given up on, and refuses a reversed range", async () => {
    server.consumers = [consumer({ deliveries: { due: 0, dead: 2 } })];
    server.deliveries = [delivery(9, "delivered"), delivery(7, "dead"), delivery(4, "dead")];
    await mount();
    await click((await menu("meta-conversions", "Deliver again…"))!);
    const [from, to] = Array.from(document.body.querySelectorAll<HTMLInputElement>('input[type="number"]'));
    expect([from!.value, to!.value]).toEqual(["4", "7"]);

    await type(from!, "8");
    expect(text()).toContain("The first event comes before the last.");
    expect(button("Deliver again").disabled).toBe(true);

    await type(from!, "3");
    await click(button("Deliver again"));
    expect(server.calls).toContainEqual({ method: "POST", path: "/api/event-consumers/meta-conversions/replay", body: { fromSequence: 3, toSequence: 7 } });
    expect(notifications.success).toHaveBeenCalledWith("3 deliveries are on their way.");
  });

  it("starts and stops a Built-in Consumer and replays to it, never edits, tests, re-keys or deletes it", async () => {
    server.consumers = [consumer({})];
    await mount();
    const actions = Array.from(row("meta-conversions").querySelectorAll("button")).map((b) => b.textContent?.trim() || b.getAttribute("aria-label"));
    expect(actions).toEqual(["Deliveries", "Meta conversions receives events", "More actions for Meta conversions"]);
    await click(row("meta-conversions").querySelector<HTMLButtonElement>('button[aria-label^="More actions for"]')!);
    const items = Array.from(document.body.querySelectorAll('[role="menuitem"]')).map((item) => item.textContent?.trim());
    expect(items).toEqual(["Deliver again…"]);
  });

  it("lets someone who may only read see how it went, never steer it", async () => {
    server.consumers = [consumer({ deliveries: { due: 0, dead: 1 } })];
    server.deliveries = [delivery(4, "dead")];
    await mount(false);
    expect(toggle("meta-conversions").disabled).toBe(true);
    expect(row("meta-conversions").querySelector('button[aria-label^="More actions for"]')).toBeNull();
    await click(button("Deliveries", row("meta-conversions")));
    expect(document.body.querySelector('[data-delivery="d4"]')!.textContent).toContain("HTTP 500");
    expect(button("Try again")).toBeUndefined();
    expect(server.calls.filter((c) => c.method !== "GET")).toEqual([]);
  });
});
