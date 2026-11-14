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
const COUNTS: OrderStageCounts = { stages: [{ stage: "new", count: 3 }], needsAttention: 0, archived: 0, callbacks: 2, callbacksDue: 1, deliveryRate: null };

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

describe("the orders list with a confirmation team", () => {
  it("shows who has each order, and a waiting order assigned to no one as such", async () => {
    await render();
    const rows = Array.from(host.querySelectorAll("tbody tr")).map((row) => row.textContent ?? "");
    expect(rows[0]).toContain("Assigned to Samira");
    expect(rows[1]).toContain("Not assigned");
    expect(rows[2]).toContain("Assigned to Karim");
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
    expect(host.querySelector("tbody")!.textContent).toContain("Assigned to Samira");
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

  it("filters by who has the order, the viewer named as themselves", async () => {
    window.history.replaceState(null, "", "/orders/?view=to_confirm&assignee=u-karim");
    await render();
    expect(lastQuery()).toMatchObject({ assignee: "u-karim" });
    const options = Array.from(host.querySelectorAll("option")).map((option) => option.textContent);
    expect(options).toEqual(expect.arrayContaining(["Anyone", "Not assigned", "Me (Samira)", "Karim"]));
  });
});
