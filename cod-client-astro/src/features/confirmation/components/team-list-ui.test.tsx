// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OrderListItem, OrderStageCounts } from "@/features/orders/types";
import type { TeamOverview } from "@/features/confirmation/types";

const api = vi.hoisted(() => ({
  listOrders: vi.fn(),
  getOrderStageCounts: vi.fn(),
  listDeliveryCompanies: vi.fn(),
  listDrivers: vi.fn(),
  updateOrderStatus: vi.fn(),
}));
const team = vi.hoisted(() => ({ getTeam: vi.fn(), getTeamSettings: vi.fn(), assignOrders: vi.fn() }));
const identity = vi.hoisted(() => ({ scopes: [] as string[] }));
vi.mock("@/lib/api", () => ({ apiFetch: vi.fn(), ApiError: class ApiError extends Error {} }));
vi.mock("@/features/orders/api", () => api);
vi.mock("@/features/confirmation/api", () => team);
vi.mock("@/features/geography/api", () => ({ listWilayas: vi.fn().mockResolvedValue([]), listCommunes: vi.fn() }));
vi.mock("@/features/auth/components/RequireAuth", () => ({
  useIdentity: () => ({ role: "staff", scopes: identity.scopes, user: { id: "u-samira", email: "samira@shop.dz" } }),
  canScope: (_: unknown, scope: string) => identity.scopes.includes(scope),
}));

import { ConfirmDialogProvider } from "@/components/ui";
import { OrdersList } from "@/features/orders/components/OrdersList";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

const MANAGER = ["orders:read", "team:read", "team:manage"];
const OVERVIEW: TeamOverview = {
  members: [
    { userId: "u-samira", name: "Samira", email: "samira@shop.dz", role: "staff", active: true, receiving: true, joinedAt: "2026-11-01T00:00:00.000Z", waiting: 2, callbacks: 1, reach: "own" },
    { userId: "u-karim", name: "Karim", email: "karim@shop.dz", role: "staff", active: true, receiving: false, joinedAt: "2026-11-01T00:00:00.000Z", waiting: 0, callbacks: 0, reach: "all" },
  ],
  unassigned: 1,
  needsManager: 0,
  withFormerMembers: 0,
};
const COUNTS: OrderStageCounts = { stages: [{ stage: "new", count: 3 }], needsAttention: 0, archived: 0, callbacks: 2, callbacksDue: 1, noAnswer: { call1: 0, call2: 0, call3OrMore: 0 }, deliveryRate: null };

function order(id: string, overrides: Partial<OrderListItem> = {}): OrderListItem {
  return {
    id,
    orderNumber: `ORD-${id}`,
    customerId: "c1",
    customerName: "Amel",
    phone: "0551234567",
    wilayaId: 16,
    wilaya: "Alger",
    communeId: null,
    commune: null,
    city: null,
    address: "Rue 1",
    price: 3000,
    deliveryFee: 600,
    codAmount: null,
    status: "new",
    orderType: "online",
    deliveryType: "home",
    stationCode: null,
    driverName: null,
    notes: null,
    landingPageId: null,
    archivedAt: null,
    stage: "new",
    needsAttention: false,
    createdAt: "2026-11-14T08:00:00.000Z",
    updatedAt: "2026-11-14T08:00:00.000Z",
    shipmentId: null,
    shipmentKind: null,
    carrierName: null,
    trackingNumber: null,
    assigneeId: null,
    assigneeName: null,
    unansweredCalls: 0,
    ...overrides,
  };
}

beforeEach(() => {
  window.localStorage.setItem("locale", "en");
  window.history.replaceState(null, "", "/orders/?view=to_confirm");
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  for (const fn of [...Object.values(api), ...Object.values(team)]) fn.mockReset();
  identity.scopes = MANAGER;
  api.listDeliveryCompanies.mockResolvedValue([]);
  api.listDrivers.mockResolvedValue([]);
  api.getOrderStageCounts.mockResolvedValue(COUNTS);
  team.getTeam.mockResolvedValue(OVERVIEW);
  team.getTeamSettings.mockResolvedValue({ distribution: "evenly", takeBackMinutes: null, takeBackLimit: 2 });
  api.listOrders.mockResolvedValue({
    orders: [order("a", { assigneeId: "u-samira", assigneeName: "Samira" }), order("b"), order("c", { status: "confirmed", stage: "confirmed", assigneeId: "u-karim", assigneeName: "Karim" })],
    nextCursor: null,
  });
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});

async function render() {
  await act(async () => {
    root.render(
      <ConfirmDialogProvider>
        <OrdersList />
      </ConfirmDialogProvider>,
    );
  });
  for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); });
}

const rowBoxes = () => Array.from(host.querySelectorAll<HTMLInputElement>('tbody input[type="checkbox"]'));
const button = (name: RegExp) => Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((b) => name.test(b.textContent ?? ""));
const lastQuery = () => api.listOrders.mock.calls.at(-1)![0];
const bar = () => document.querySelector<HTMLElement>('[role="region"][aria-label="Selected orders"]');
const barButton = (name: string) => Array.from(bar()?.querySelectorAll<HTMLButtonElement>("button") ?? []).find((b) => b.textContent === name || b.getAttribute("aria-label") === name);
const assigned = () => {
  const column = Array.from(host.querySelectorAll("thead th")).findIndex((cell) => cell.textContent === "Assigned to");
  return Array.from(host.querySelectorAll("tbody tr")).map((row) => {
    const cell = row.children[column]!.cloneNode(true) as Element;
    for (const hidden of Array.from(cell.querySelectorAll('[aria-hidden="true"]'))) hidden.remove();
    return cell.textContent ?? "";
  });
};

describe("the orders list with a confirmation team", () => {
  it("shows who has each order under its own column, and a waiting order assigned to no one as such", async () => {
    await render();
    expect(assigned()).toEqual(["Samira", "Not assigned", "Karim"]);
  });

  it("says nothing in that column of a decided order that is with no one", async () => {
    api.listOrders.mockResolvedValue({ orders: [order("d", { status: "confirmed", stage: "confirmed" })], nextCursor: null });
    await render();
    expect(assigned()).toEqual([""]);
  });

  it("lets a manager pick the waiting orders to confirm and assign them", async () => {
    await render();
    expect(rowBoxes().map((box) => box.getAttribute("aria-label"))).toEqual(["ORD-a", "ORD-b"]);
    await act(async () => { host.querySelector<HTMLInputElement>('thead input[type="checkbox"]')!.click(); });
    expect(button(/Assign 2 orders to…/)).toBeTruthy();
    expect(button(/Ship/)).toBeUndefined();
  });

  it("offers no assigning to someone who does not manage the team", async () => {
    identity.scopes = ["orders:read", "team:read"];
    await render();
    expect(rowBoxes()).toHaveLength(0);
    expect(assigned()[0]).toBe("Samira");
  });

  it("shows no team column to a member who sees only their own orders", async () => {
    identity.scopes = ["orders:read_assigned"];
    await render();
    expect(host.querySelector("tbody")!.textContent).not.toContain("Assigned to");
    expect(team.getTeam).not.toHaveBeenCalled();
  });

  it("has a tab of the customers to call back, with those due now, soonest first", async () => {
    await render();
    const tab = button(/Callbacks/)!;
    expect(tab.textContent).toContain("2");
    expect(tab.textContent).toContain("1 due");
    await act(async () => { tab.click(); });
    for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); });
    expect(lastQuery()).toMatchObject({ callbacks: true });
    expect(window.location.search).toContain("view=callbacks");
  });

  it("opens one of the team's queues from the team page, says which, and shows every order again", async () => {
    window.history.replaceState(null, "", "/orders/?view=to_confirm&team=former");
    await render();
    expect(lastQuery()).toMatchObject({ team: "former" });
    expect(host.textContent).toContain("Orders still with a former member");
    await act(async () => { button(/Show all orders/)!.click(); });
    for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); });
    expect(lastQuery().team).toBeUndefined();
    expect(window.location.search).not.toContain("team=");
  });

  it("says under each order when it came in and, when known, where from", async () => {
    api.listOrders.mockResolvedValue({
      orders: [order("a", { source: { channel: "paid_social", platform: "meta", app: null, adName: "Promo", campaignName: null } as OrderListItem["source"] }), order("b")],
      nextCursor: null,
    });
    await render();
    const firsts = Array.from(host.querySelectorAll("tbody tr")).map((row) => row.querySelector("td:nth-child(2)")!.textContent ?? "");
    expect(firsts[0]).toMatch(/^ORD-a.+·Facebook or Instagram/);
    expect(firsts[1]).not.toContain("·");
    expect(host.querySelector("tbody")!.textContent).not.toContain("Source unknown");
  });

  it("offers to assign only once an order is picked, then to pick them all, and lets the pick go", async () => {
    await render();
    expect(bar()).toBeNull();
    expect(button(/Select orders to assign/)).toBeUndefined();
    await act(async () => { rowBoxes()[0]!.click(); });
    expect(bar()!.textContent).toContain("Assign 1 order to…");
    await act(async () => { barButton("Select all orders to call")!.click(); });
    expect(bar()!.textContent).toContain("Assign 2 orders to…");
    expect(barButton("Select all orders to call")).toBeUndefined();
    await act(async () => { barButton("Clear selection")!.click(); });
    expect(bar()).toBeNull();
    expect(rowBoxes().map((box) => box.checked)).toEqual([false, false]);
  });

  it("gathers the filters behind one button on a phone, in a sheet that narrows the list and says how many are on", async () => {
    await render();
    const filters = () => Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent?.startsWith("Filters"))!;
    expect(filters().getAttribute("aria-label")).toBeNull();
    await act(async () => filters().click());
    const sheet = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(sheet.querySelector("h2")!.textContent).toBe("Filter orders");
    const fields = () => Array.from(sheet.querySelectorAll("label")).map((label) => ({ name: label.firstElementChild?.textContent?.trim(), trigger: label.querySelector<HTMLButtonElement>('button[aria-haspopup="listbox"]')! }));
    expect(fields().map((field) => field.name)).toEqual(["Delivered by", "Type", "Protection", "Source", "Assigned to"]);
    await act(async () => fields().find((field) => field.name === "Assigned to")!.trigger.click());
    const option = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find((item) => item.textContent?.trim() === "Not assigned")!;
    await act(async () => option.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
    for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); });
    expect(lastQuery()).toMatchObject({ assignee: "none" });
    expect(filters().getAttribute("aria-label")).toBe("Filters, 1 on");
    await act(async () => Array.from(sheet.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent === "Show orders")!.click());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("shows each customer's phone beside their name", async () => {
    await render();
    const customers = Array.from(host.querySelectorAll("tbody tr")).map((row) => row.querySelector("td:nth-child(3)")!.textContent);
    expect(customers[0]).toBe("Amel0551234567");
  });

  it("opens the assigning of the picked orders from the bar", async () => {
    await render();
    await act(async () => { rowBoxes()[0]!.click(); });
    await act(async () => { barButton("Assign 1 order to…")!.click(); });
    for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); });
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it("narrows the list from a filter pill on a wide screen", async () => {
    await render();
    const pill = host.querySelector<HTMLButtonElement>('button[aria-haspopup="listbox"][aria-label="Assigned to"]')!;
    await act(async () => pill.click());
    const option = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find((item) => item.textContent?.trim() === "Not assigned")!;
    await act(async () => option.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
    for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); });
    expect(lastQuery()).toMatchObject({ assignee: "none" });
  });

  it("gives each next step in a row's menu the icon of the stage it leads to", async () => {
    identity.scopes = [...MANAGER, "orders:update"];
    await render();
    await act(async () => host.querySelector<HTMLButtonElement>('tbody button[aria-label$="ORD-c"]')!.click());
    const item = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find((entry) => entry.textContent?.trim() === "Start preparing")!;
    expect(item.querySelector("svg.lucide-package-open")).not.toBeNull();
  });

  it("filters by who has the order, the viewer named as themselves", async () => {
    window.history.replaceState(null, "", "/orders/?view=to_confirm&assignee=u-karim");
    await render();
    expect(lastQuery()).toMatchObject({ assignee: "u-karim" });
    const options = Array.from(host.querySelectorAll("option")).map((option) => option.textContent);
    expect(options).toEqual(expect.arrayContaining(["Anyone", "Not assigned", "Me (Samira)", "Karim"]));
  });
});

describe("the orders to confirm, call by call", () => {
  const ON_NO_ANSWER: OrderStageCounts = {
    ...COUNTS,
    stages: [
      { stage: "new", count: 3 },
      { stage: "unreachable", count: 6 },
      { stage: "confirmed", count: 4 },
    ],
    noAnswer: { call1: 3, call2: 2, call3OrMore: 1 },
  };
  const steps = () => host.querySelector<HTMLElement>('[role="group"][aria-label="Filter by call"]');
  const chip = (name: string) => Array.from(steps()!.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent?.startsWith(name))!;
  const settle = async () => {
    for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); });
  };

  it("opens new orders, Call 1, Call 2, Call 3 and more, each with its count, all of them first", async () => {
    api.getOrderStageCounts.mockResolvedValue(ON_NO_ANSWER);
    await render();
    expect(Array.from(steps()!.querySelectorAll("button")).map((b) => [b.textContent, b.getAttribute("aria-pressed")])).toEqual([
      ["All9", "true"],
      ["New3", "false"],
      ["Call 13", "false"],
      ["Call 22", "false"],
      ["Call 3+1", "false"],
    ]);
    expect(lastQuery()).toMatchObject({ stages: ["new", "unreachable"] });
    expect(lastQuery().calls).toBeUndefined();
  });

  it("asks the server for one call, keeps it in the address, and goes back to all of them", async () => {
    api.getOrderStageCounts.mockResolvedValue(ON_NO_ANSWER);
    await render();
    await act(async () => chip("Call 2").click());
    await settle();
    expect(lastQuery()).toMatchObject({ stages: ["new", "unreachable"], calls: 2 });
    expect(chip("Call 2").getAttribute("aria-pressed")).toBe("true");
    expect(window.location.search).toBe("?view=to_confirm&step=call2");
    await act(async () => chip("New").click());
    await settle();
    expect(lastQuery()).toMatchObject({ stages: ["new"] });
    expect(lastQuery().calls).toBeUndefined();
    await act(async () => chip("All").click());
    await settle();
    expect(lastQuery().calls).toBeUndefined();
    expect(lastQuery()).toMatchObject({ stages: ["new", "unreachable"] });
    expect(window.location.search).toBe("?view=to_confirm");
  });

  it("opens the call a link names, and forgets it on leaving the queue", async () => {
    api.getOrderStageCounts.mockResolvedValue(ON_NO_ANSWER);
    window.history.replaceState(null, "", "/orders/?view=to_confirm&step=call3");
    await render();
    expect(lastQuery()).toMatchObject({ calls: 3 });
    const all = Array.from(host.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find((tab) => tab.textContent?.startsWith("All"))!;
    await act(async () => all.click());
    await settle();
    expect(lastQuery().calls).toBeUndefined();
    expect(steps()).toBeNull();
    expect(window.location.search).toBe("");
  });

  it("keeps the steps once one is open, even with no order left on no answer, so the way back stays", async () => {
    window.history.replaceState(null, "", "/orders/?view=to_confirm&step=call2");
    await render();
    expect(chip("Call 2").getAttribute("aria-pressed")).toBe("true");
    expect(chip("All").textContent).toBe("All3");
  });

  it("offers no steps while no order is on no answer, nor outside the orders to confirm", async () => {
    await render();
    expect(steps()).toBeNull();
    api.getOrderStageCounts.mockResolvedValue(ON_NO_ANSWER);
    window.history.replaceState(null, "", "/orders/?view=all&step=call2");
    act(() => root.unmount());
    root = createRoot(host);
    await render();
    expect(steps()).toBeNull();
    expect(lastQuery().calls).toBeUndefined();
  });

  it("says which call each order is at, and when a step is empty, says so", async () => {
    api.getOrderStageCounts.mockResolvedValue(ON_NO_ANSWER);
    api.listOrders.mockResolvedValue({ orders: [order("a", { status: "unreachable", stage: "unreachable", unansweredCalls: 2 }), order("b")], nextCursor: null });
    await render();
    const rows = Array.from(host.querySelectorAll("tbody tr")).map((row) => row.textContent ?? "");
    expect(rows[0]).toContain("No answer · Call 2");
    expect(rows[1]).not.toContain("Call");
    api.listOrders.mockResolvedValue({ orders: [order("c", { status: "unreachable", stage: "unreachable", unansweredCalls: 0 })], nextCursor: null });
    await act(async () => chip("Call 1").click());
    await settle();
    expect(host.querySelector("tbody tr")!.textContent).toContain("No answer");
    expect(host.querySelector("tbody tr")!.textContent).not.toContain("Call");
    api.listOrders.mockResolvedValue({ orders: [], nextCursor: null });
    await act(async () => chip("Call 3+").click());
    await settle();
    expect(host.textContent).toContain("No order at this step");
  });

  it("records the next call from a row's menu, sending the order as the row showed it", async () => {
    identity.scopes = [...MANAGER, "orders:update"];
    api.getOrderStageCounts.mockResolvedValue(ON_NO_ANSWER);
    api.listOrders.mockResolvedValue({ orders: [order("a", { status: "unreachable", stage: "unreachable", unansweredCalls: 2 })], nextCursor: null });
    api.updateOrderStatus.mockResolvedValue({ success: true, data: null });
    await render();
    await act(async () => host.querySelector<HTMLButtonElement>('tbody button[aria-label$="ORD-a"]')!.click());
    const item = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find((entry) => entry.textContent?.trim() === "No answer · Call 3")!;
    await act(async () => item.click());
    await settle();
    expect(api.updateOrderStatus).toHaveBeenCalledWith("a", "unreachable", { status: "unreachable", unansweredCalls: 2 });
  });
});
