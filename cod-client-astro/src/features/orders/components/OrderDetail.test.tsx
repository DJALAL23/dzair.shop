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
  updateOrderStatus: vi.fn(),
}));
const failure = vi.hoisted(() => ({
  ApiError: class ApiError extends Error {
    constructor(message: string, public status?: number, public code?: string) {
      super(message);
    }
  },
}));
vi.mock("@/lib/api", () => ({ apiFetch: vi.fn(), ApiError: failure.ApiError }));
vi.mock("@/features/orders/api", () => api);
const protection = vi.hoisted(() => ({ attemptOfOrder: vi.fn(), addToBlockList: vi.fn() }));
vi.mock("@/features/apps/order-protection/api", () => protection);
const team = vi.hoisted(() => ({ getTeam: vi.fn(), getTeamSettings: vi.fn(), assignOrders: vi.fn(), setOrderCallback: vi.fn() }));
vi.mock("@/features/confirmation/api", () => team);
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), flashSuccess: vi.fn() }));
vi.mock("@/lib/notify", () => ({ notify: toast }));
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
  unansweredCalls: 0,
  createdAt: "2026-11-12T09:39:00.000Z",
  updatedAt: "2026-11-12T09:39:00.000Z",
} as unknown as Order;

const ATTEMPT = { id: "a", orderId: "o1", orderNumber: ORDER.orderNumber, phone: "0551234567", ipKey: null, signals: {}, createdAt: ORDER.createdAt, customerName: null, total: null };

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  window.localStorage.setItem("locale", "en");
  for (const fn of [...Object.values(api), ...Object.values(protection), ...Object.values(team), ...Object.values(toast)]) fn.mockReset();
  api.getOrder.mockResolvedValue(ORDER);
  api.getOrderRemoval.mockResolvedValue({ deletable: true, archivable: false });
  api.listDeliveryCompanies.mockResolvedValue([]);
  api.listDrivers.mockResolvedValue([]);
  protection.attemptOfOrder.mockResolvedValue(null);
  team.getTeam.mockResolvedValue({ members: [{ userId: "u-karim", name: "Karim", active: true, reach: "assigned", receiving: true, waiting: 2 }] });
  team.getTeamSettings.mockResolvedValue({ distribution: "manual" });
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

const button = (label: string) => Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent?.trim() === label);
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

  it("gives an order to someone only while it waits to be confirmed", async () => {
    await open();
    expect(button("Assign to…")).toBeDefined();
    act(() => root.unmount());
    root = createRoot(host);
    api.getOrder.mockResolvedValue({ ...ORDER, status: "confirmed", stage: "confirmed", confirmedByName: "Admin" });
    await open();
    expect(host.textContent).toContain("Confirmed by Admin");
    expect(button("Assign to…")).toBeUndefined();
  });

  it("says so when the order was confirmed while it was being given", async () => {
    await open();
    await act(async () => button("Assign to…")!.click());
    await act(async () => {});
    const karim = Array.from(document.querySelectorAll<HTMLElement>('[role="radio"]')).find((choice) => choice.textContent?.includes("Karim"))!;
    await act(async () => karim.click());
    team.assignOrders.mockResolvedValue([{ orderId: "o1", ok: false, reason: "decided" }]);
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    await act(async () => Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent?.trim() === "Assign to…")!.click());
    expect(team.assignOrders).toHaveBeenCalledWith(["o1"], "u-karim");
    expect(toast.error).toHaveBeenCalledWith("This order is already confirmed or cancelled, so it stays with whoever handled it.");
  });
});

describe("an order on no answer", () => {
  const CALLED_TWICE = {
    ...ORDER,
    status: "unreachable",
    stage: "unreachable",
    unansweredCalls: 2,
    statusHistory: [
      { id: "h-placed", status: "new", timestamp: "2026-11-12T09:39:00.000Z", by: null, byName: null },
      { id: "h-call-1", status: "unreachable", timestamp: "2026-11-12T10:05:00.000Z", by: "u-owner", byName: "Admin" },
      { id: "h-call-2", status: "unreachable", timestamp: "2026-11-12T14:30:00.000Z", by: "u-owner", byName: "Admin" },
    ],
    assignmentHistory: [{ id: "a-1", at: "2026-11-12T09:39:00.000Z", to: { id: "u-owner", name: "Admin" }, from: null, way: "automatic", byName: null }],
  } as unknown as Order;
  const card = (title: string) => Array.from(host.querySelectorAll("section")).find((section) => section.querySelector("h2")?.textContent === title)!;

  it("says which call it is at, and its No answer records the next call, sending the count it showed", async () => {
    api.getOrder.mockResolvedValue(CALLED_TWICE);
    api.updateOrderStatus.mockResolvedValue({ success: true, data: null });
    await open();
    expect(host.querySelector("h1")!.parentElement!.textContent).toBe(`${ORDER.orderNumber}No answer · Call 2`);
    expect(Array.from(card("Next step").querySelectorAll("button")).map((b) => b.textContent?.trim())).toEqual(["Confirm order", "No answer · Call 3", "Cancel order"]);
    await act(async () => button("No answer · Call 3")!.click());
    expect(api.updateOrderStatus).toHaveBeenCalledWith("o1", "unreachable", { status: "unreachable", unansweredCalls: 2 });
    expect(toast.success).toHaveBeenCalledWith(`${ORDER.orderNumber}: No answer · Call 3`);
    expect(api.getOrder).toHaveBeenCalledTimes(2);
  });

  it("sends the order as it showed it with every move, so a decision on an order someone else changed is refused too", async () => {
    api.getOrder.mockResolvedValue(CALLED_TWICE);
    api.updateOrderStatus.mockResolvedValue({ success: true, data: null });
    await open();
    await act(async () => button("Confirm order")!.click());
    expect(api.updateOrderStatus).toHaveBeenCalledWith("o1", "confirmed", { status: "unreachable", unansweredCalls: 2 });
  });

  it("reads the order again and says why, once, when someone changed it first", async () => {
    api.getOrder.mockResolvedValue(CALLED_TWICE);
    api.updateOrderStatus.mockRejectedValue(new failure.ApiError("The order changed meanwhile; reload it and try again", 409, "ORDER_CHANGED"));
    await open();
    await act(async () => button("No answer · Call 3")!.click());
    for (let i = 0; i < 3; i++) await act(async () => {});
    expect(api.getOrder).toHaveBeenCalledTimes(2);
    expect(toast.error.mock.calls).toEqual([["This order was updated meanwhile. Check where it stands, then try again."]]);
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("shows the server's own words for any other refusal, and reads nothing again", async () => {
    api.getOrder.mockResolvedValue(CALLED_TWICE);
    api.updateOrderStatus.mockRejectedValue(new failure.ApiError("Cannot transition", 400, "INVALID_STATUS_TRANSITION"));
    await open();
    await act(async () => button("No answer · Call 3")!.click());
    expect(api.getOrder).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[role="alert"]')!.textContent).toBe("Cannot transition");
    expect(toast.error.mock.calls).toEqual([["The order could not be updated"]]);
  });

  it("numbers each call in its progress, back from the order's count", async () => {
    api.getOrder.mockResolvedValue({ ...CALLED_TWICE, unansweredCalls: 3 });
    await open();
    const steps = Array.from(card("Order progress").querySelectorAll("li p:first-child")).map((p) => p.textContent);
    expect(steps).toEqual(["No answer · Call 3", "No answer · Call 2", "Received"]);
  });

  it("counts the calls in the team card, and keeps its history in a side sheet, newest first", async () => {
    api.getOrder.mockResolvedValue(CALLED_TWICE);
    await open();
    const team = card("Confirmation");
    expect(team.textContent).toContain("2 calls without an answer");
    expect(team.querySelector("details")).toBeNull();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => Array.from(team.querySelectorAll("button")).find((b) => b.textContent?.trim() === "History")!.click());
    const sheet = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(sheet.querySelector("h2")!.textContent).toBe("Confirmation history");
    expect(Array.from(sheet.querySelectorAll("li")).map((entry) => entry.querySelector("p")!.textContent)).toEqual(["No answer · Call 2", "No answer · Call 1", "Assigned to Admin", "Order placed"]);
    expect(sheet.querySelectorAll("li")[0]!.textContent).toContain("Admin");
    expect(sheet.querySelectorAll("li")[2]!.textContent).toContain("Assigned automatically");
  });

  it("says in one line how the order came to its member, and in its history how long after the step before each call came", async () => {
    api.getOrder.mockResolvedValue(CALLED_TWICE);
    await open();
    const team = card("Confirmation");
    expect(team.textContent).toMatch(/Assigned [^·]+, automatically/);
    expect(team.textContent!.match(/Assigned/g)).toHaveLength(2);
    await act(async () => Array.from(team.querySelectorAll("button")).find((b) => b.textContent?.trim() === "History")!.click());
    const entries = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"] li')).map((entry) => entry.textContent ?? "");
    expect(entries[0]).toContain("4 h 25 min after call 1");
    expect(entries[1]).toContain("26 min after it was placed");
    expect(entries[2]).not.toContain(" after ");
    expect(entries[3]).not.toContain(" after ");
  });

  it("says only when the order came to its member if its last handover was to someone else", async () => {
    api.getOrder.mockResolvedValue({ ...CALLED_TWICE, assignmentHistory: [{ id: "a-2", at: "2026-11-12T10:00:00.000Z", to: { id: "u-karim", name: "Karim" }, from: { id: "u-owner", name: "Admin" }, way: "manual", byName: "Admin" }] });
    await open();
    const team = card("Confirmation");
    expect(team.textContent).toMatch(/Assigned /);
    expect(team.textContent).not.toContain("by Admin");
    expect(team.textContent).not.toContain("automatically");
  });

  it("has no history to open while there is only one thing to tell", async () => {
    api.getOrder.mockResolvedValue({ ...ORDER, assignmentHistory: [{ id: "a-1", at: ORDER.createdAt, to: { id: "u-owner", name: "Admin" }, from: null, way: "automatic", byName: null }] });
    await open();
    expect(Array.from(card("Confirmation").querySelectorAll("button")).some((b) => b.textContent?.trim() === "History")).toBe(false);
    expect(card("Confirmation").textContent).not.toContain("without an answer");
  });

  it("keeps the count once the order is decided, for whoever reads it after", async () => {
    api.getOrder.mockResolvedValue({ ...CALLED_TWICE, status: "cancelled", stage: "cancelled", unansweredCalls: 3 });
    await open();
    expect(host.querySelector("h1")!.parentElement!.textContent).toBe(`${ORDER.orderNumber}Cancelled`);
    expect(card("Confirmation").textContent).toContain("3 calls without an answer");
  });
});
