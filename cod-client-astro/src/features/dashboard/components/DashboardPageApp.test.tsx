// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const identity = vi.hoisted(() => ({ scopes: [] as string[] }));
const api = vi.hoisted(() => ({ getOrderStageCounts: vi.fn(), listOrders: vi.fn(), getOrderActivity: vi.fn() }));
vi.mock("@/lib/api", () => ({ apiFetch: vi.fn(), ApiError: class ApiError extends Error {} }));
vi.mock("@/features/orders/api", () => ({ getOrderStageCounts: api.getOrderStageCounts, listOrders: api.listOrders }));
vi.mock("@/features/dashboard/api", () => ({ getOrderActivity: api.getOrderActivity }));
vi.mock("@/features/auth/components/RequireAuth", () => ({
  RequireAuth: ({ children }: { children: ReactNode }) => children,
  useIdentity: () => ({ role: "staff", scopes: identity.scopes, user: { id: "u-lina", email: "lina@shop.dz" } }),
  canScope: (_: unknown, scope: string) => identity.scopes.includes(scope),
}));

import DashboardPageApp from "./DashboardPageApp";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let replace: ReturnType<typeof vi.fn>;

beforeEach(() => {
  window.localStorage.setItem("locale", "en");
  replace = vi.fn();
  Object.defineProperty(window, "location", { configurable: true, value: { ...window.location, replace, pathname: "/dashboard" } });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
});

async function open(scopes: string[]) {
  identity.scopes = scopes;
  await act(async () => root.render(<DashboardPageApp />));
  await act(async () => {});
}

describe("home for someone who may not see it", () => {
  it("sends a confirmation agent straight to their orders, with no error on the way", async () => {
    await open(["orders:read_assigned", "orders:update"]);
    expect(replace).toHaveBeenCalledWith("/orders");
    expect(host.textContent).not.toContain("permission");
    expect(api.getOrderStageCounts).not.toHaveBeenCalled();
  });

  it("says so only when there is no page at all to go to", async () => {
    await open([]);
    expect(replace).not.toHaveBeenCalled();
    expect(host.textContent).toContain("You do not have permission to access this page.");
  });
});

describe("home's recent orders", () => {
  it("says which call a customer who does not answer is at, as the orders list does", async () => {
    api.getOrderStageCounts.mockResolvedValue({ stages: [{ stage: "unreachable", count: 1 }], needsAttention: 0, archived: 0, callbacks: 0, callbacksDue: 0, noAnswer: { call1: 0, call2: 0, call3OrMore: 1 }, deliveryRate: null });
    api.getOrderActivity.mockResolvedValue({ from: "2026-10-17", to: "2026-11-15", days: [], previous: { orders: 0, orderValue: 0 } });
    api.listOrders.mockResolvedValue({
      orders: [{ id: "o1", orderNumber: "ORD-1", customerName: "Amel", status: "unreachable", stage: "unreachable", needsAttention: false, unansweredCalls: 3, price: 3000, deliveryFee: 400, products: [], createdAt: "2026-11-14T08:00:00.000Z" }],
      nextCursor: null,
    });
    await open(["dashboard:view", "orders:read"]);
    for (let i = 0; i < 3; i++) await act(async () => {});
    expect(host.textContent).toContain("No answer · Call 3");
  });
});
