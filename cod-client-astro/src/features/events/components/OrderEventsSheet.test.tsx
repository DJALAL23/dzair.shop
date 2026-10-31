// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BusinessEvent } from "@/features/events/types";

const server = vi.hoisted(() => ({ events: [] as unknown[], failEvents: false, paths: [] as string[] }));

vi.mock("@/lib/api", () => ({
  ApiError: class ApiError extends Error {},
  apiFetch: vi.fn(async (path: string) => {
    server.paths.push(path);
    const url = new URL(path, "https://api.test");
    if (url.pathname === "/api/events") {
      if (server.failEvents) throw new Error("offline");
      return { success: true, data: server.events, nextCursor: null };
    }
    if (url.pathname === "/api/event-deliveries") {
      return {
        success: true, nextCursor: null,
        data: [{ id: "d1", consumerId: "meta-conversions", state: "dead", attempts: 8, nextAttemptAt: null, lastError: "HTTP 500", createdAt: "", settledAt: "", event: { id: "e1", sequence: 1, type: "order.created", orderId: "o1", occurredAt: "" } }],
      };
    }
    if (url.pathname === "/api/event-consumers") {
      return { success: true, data: [{ id: "meta-conversions", kind: "meta_capi", name: "Meta conversions", enabled: true, subscription: [], catalogueVersion: 1, disabledReason: null, failingSince: null, deliveries: { due: 0, dead: 1 }, createdAt: "", updatedAt: "" }] };
    }
    throw new Error(`unexpected ${path}`);
  }),
}));

import { OrderEventsButton } from "./OrderEventsSheet";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

const event = (id: string, type: BusinessEvent["type"], actor: BusinessEvent["actor"], origin: BusinessEvent["origin"]) =>
  ({ id, sequence: 1, type, version: 1, subject: { type: "order", id: "o1" }, orderId: "o1", occurredAt: "2026-10-25T09:00:00Z", recordedAt: "2026-10-25T09:00:00Z", actor, origin, data: {} }) as BusinessEvent;

beforeEach(() => {
  window.localStorage.setItem("locale", "en");
  server.events = [];
  server.failEvents = false;
  server.paths = [];
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function mount(canSeeDeliveries: boolean, canOpenIntegrations = canSeeDeliveries) {
  await act(async () => root.render(<OrderEventsButton orderId="o1" canSeeDeliveries={canSeeDeliveries} canOpenIntegrations={canOpenIntegrations} />));
  await act(async () => button("Sent to integrations")!.click());
}
const sheet = () => document.body.querySelector<HTMLElement>('[role="dialog"]');
const text = () => sheet()?.textContent ?? "";
const button = (label: string) => Array.from(document.body.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent?.trim() === label);

describe("an order's events, as its integrations were told", () => {
  it("are fetched only once the sheet is opened, and the sheet closes", async () => {
    await act(async () => root.render(<OrderEventsButton orderId="o1" canSeeDeliveries={false} canOpenIntegrations={false} />));
    expect(server.paths).toEqual([]);
    expect(sheet()).toBeNull();
    await act(async () => button("Sent to integrations")!.click());
    expect(server.paths).toEqual(["/api/events?orderId=o1&after=0&limit=100"]);
    expect(sheet()!.querySelector("h2")!.textContent).toBe("Sent to integrations");
    await act(async () => (document.body.querySelector('[aria-label="Close"]') as HTMLButtonElement).click());
    expect(sheet()).toBeNull();
  });

  it("lists them oldest first, each with who caused it and through what", async () => {
    server.events = [
      event("e1", "order.created", { kind: "shopper", id: null, name: null }, "storefront"),
      event("e2", "order.confirmed", { kind: "agent", id: "u1", name: "Nadia" }, "agent"),
      event("e3", "shipment.delivered", { kind: "carrier", id: "y", name: "Yalidine" }, "carrier_webhook"),
    ];
    await mount(false);
    expect(server.paths).toEqual(["/api/events?orderId=o1&after=0&limit=100"]);
    const items = Array.from(sheet()!.querySelectorAll("li")).map((li) => li.textContent);
    expect(items[0]).toContain("Order placed");
    expect(items[0]).toContain("The customer, on the store");
    expect(items[1]).toContain("Nadia's AI assistant, through an AI assistant");
    expect(items[2]).toContain("Delivered");
    expect(items[2]).toContain("Yalidine, reported by the carrier");
    expect(button("Who received it")).toBeUndefined();
    expect(document.body.querySelector('a[href="/integrations"]')).toBeNull();
  });

  it("opens an event on who received it, for those who may see a Consumer", async () => {
    server.events = [event("e1", "order.created", { kind: "shopper", id: null, name: null }, "storefront")];
    await mount(true);
    expect(document.body.querySelector('a[href="/integrations"]')!.textContent).toBe("Manage integrations");
    await act(async () => button("Who received it")!.click());
    expect(server.paths).toContain("/api/event-deliveries?eventId=e1");
    expect(text()).toContain("Meta conversions");
    expect(text()).toContain("Gave up");
    expect(text()).toContain("HTTP 500");
  });

  it("opens who received it for whoever may see Meta conversions, sending them to Integrations only with its permission", async () => {
    server.events = [event("e1", "order.created", { kind: "shopper", id: null, name: null }, "storefront")];
    await mount(true, false);
    expect(document.body.querySelector('a[href="/integrations"]')).toBeNull();
    await act(async () => button("Who received it")!.click());
    expect(text()).toContain("Meta conversions");
  });

  it("says when nothing was sent, and when the events cannot be loaded", async () => {
    await mount(false);
    expect(text()).toContain("Nothing sent yet.");
    act(() => root.unmount());
    root = createRoot(host);
    server.failEvents = true;
    await mount(false);
    expect(document.body.querySelector('[role="alert"]')!.textContent).toBe("The events could not be loaded.");
  });
});
