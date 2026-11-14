// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OrderDetail as Order } from "@/features/orders/types";

const api = vi.hoisted(() => ({
  getOrder: vi.fn(),
  getOrderRemoval: vi.fn(),
  listDeliveryCompanies: vi.fn(),
  listDrivers: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ apiFetch: vi.fn(), ApiError: class ApiError extends Error {} }));
vi.mock("@/features/orders/api", () => api);
const protection = vi.hoisted(() => ({ attemptOfOrder: vi.fn(), addToBlockList: vi.fn() }));
vi.mock("@/features/apps/order-protection/api", () => protection);
vi.mock("@/features/auth/components/RequireAuth", () => ({
  useIdentity: () => ({ role: "admin", scopes: ["*"], user: { id: "u-owner", email: "owner@shop.dz" } }),
  canScope: () => true,
}));

import { ConfirmDialogProvider } from "@/components/ui";
import { OrderDetail } from "./OrderDetail";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ORDER = {
  id: "o1",
  orderNumber: "ORD-20261112-7203",
  orderType: "online",
  status: "new",
  stage: "new",
  needsAttention: false,
  customerName: "Karim",
  phone: "0551234567",
  wilayaId: 16,
  wilaya: "Alger",
  communeId: null,
  commune: null,
  address: "4 rue Didouche",
  price: 3000,
  deliveryFee: 400,
  couponCode: null,
  couponDiscount: 0,
  deliveryOfferId: null,
  deliveryOfferName: null,
  products: [{ id: "l1", productName: "Robe", variantLabel: null, quantity: 1, unitPrice: 3000, discount: 0, reward: false, returnedQuantity: 0 }],
  notes: null,
  archivedAt: null,
  shipment: null,
  attribution: null,
  statusHistory: [],
  assigneeId: "u-owner",
  assigneeName: "Admin",
  assignedAt: "2026-11-12T09:39:00.000Z",
  assignmentHistory: [],
  createdAt: "2026-11-12T09:39:00.000Z",
  updatedAt: "2026-11-12T09:39:00.000Z",
} as unknown as Order;

const ATTEMPT = { id: "a", orderId: "o1", orderNumber: ORDER.orderNumber, phone: "0551234567", ipKey: null, signals: {}, createdAt: ORDER.createdAt, customerName: null, total: null };

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  window.localStorage.setItem("locale", "en");
  for (const fn of [...Object.values(api), ...Object.values(protection)]) fn.mockReset();
  api.getOrder.mockResolvedValue(ORDER);
  api.getOrderRemoval.mockResolvedValue({ deletable: true, archivable: false });
  api.listDeliveryCompanies.mockResolvedValue([]);
  api.listDrivers.mockResolvedValue([]);
  protection.attemptOfOrder.mockResolvedValue(null);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
});

async function open() {
  await act(async () =>
    root.render(
      <ConfirmDialogProvider>
        <OrderDetail orderId="o1" />
      </ConfirmDialogProvider>,
    ),
  );
  for (let i = 0; i < 3; i++) await act(async () => {});
}

const cards = () => Array.from(host.querySelectorAll("h2")).map((heading) => heading.textContent);

describe("an order's page", () => {
  it("names the order with its stage and when it was placed", async () => {
    await open();
    const title = host.querySelector("h1")!;
    expect(title.parentElement!.textContent).toBe(`${ORDER.orderNumber}New`);
    const placed = title.closest("header")!.querySelector(`time[datetime="${ORDER.createdAt}"]`)!;
    expect(placed.textContent).toMatch(/2026/);
    expect(placed.parentElement!.textContent).toContain("Online");
  });

  it("reads the order first, what to do now next, and where it came from last", async () => {
    await open();
    const order = cards();
    expect(order.slice(0, 3)).toEqual(["Customer information", "Products", "Next step"]);
    expect(order.at(-1)).toBe("Source");
  });

  it("warns about a flagged order before its next step", async () => {
    protection.attemptOfOrder.mockResolvedValue({ ...ATTEMPT, outcome: "flagged", matches: [{ ruleId: "r", name: "Too many", mode: "active", action: "flag" }] });
    await open();
    const order = cards();
    expect(order.indexOf("Order Protection")).toBeLessThan(order.indexOf("Next step"));
    expect(host.textContent).toContain("Flagged because of: Too many");
  });

  it("keeps an order the App let through below the work on it", async () => {
    protection.attemptOfOrder.mockResolvedValue({ ...ATTEMPT, outcome: "accepted", matches: [] });
    await open();
    const order = cards();
    expect(order.indexOf("Order Protection")).toBeGreaterThan(order.indexOf("Confirmation"));
  });
});
