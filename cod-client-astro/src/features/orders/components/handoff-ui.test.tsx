// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Driver, OrderListItem } from "@/features/orders/types";

const api = vi.hoisted(() => ({
  listOrders: vi.fn(),
  getOrderStageCounts: vi.fn(),
  listWilayas: vi.fn(),
  listDeliveryCompanies: vi.fn(),
  listDrivers: vi.fn(),
  listStopDesks: vi.fn(),
  handOffOrder: vi.fn(),
  handOffToCarrier: vi.fn(),
  handOffToDriver: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ apiFetch: vi.fn(), ApiError: class ApiError extends Error {} }));
vi.mock("@/features/orders/api", () => api);
vi.mock("@/features/auth/components/RequireAuth", () => ({
  useIdentity: () => ({ role: "admin", scopes: [] }),
  canScope: () => true,
}));

import { HandoffDialog } from "./HandoffDialog";
import { BulkHandoffDialog } from "./BulkHandoffDialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  window.localStorage.setItem("locale", "en");
  window.history.replaceState(null, "", "/orders/");
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  for (const fn of Object.values(api)) fn.mockReset();
  api.listWilayas.mockResolvedValue([]);
  api.listDeliveryCompanies.mockResolvedValue([]);
  api.listDrivers.mockResolvedValue([driver]);
  api.getOrderStageCounts.mockResolvedValue({ stages: [], needsAttention: 0, archived: 0 });
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});

const driver = { id: "dr1", firstName: "Samir", lastName: "B", phone: "0661000000", status: "available" } as Driver;

function order(id: string, overrides: Partial<OrderListItem> = {}): OrderListItem {
  return {
    id,
    orderNumber: `ORD-${id}`,
    customerId: "c1",
    customerName: "Karim",
    phone: "0551234567",
    wilayaId: 16,
    wilaya: "Alger",
    communeId: null,
    commune: null,
    city: null,
    address: "12 Rue Didouche",
    price: 1500,
    deliveryFee: 400,
    codAmount: null,
    status: "ready",
    orderType: "online",
    deliveryType: "home",
    stationCode: null,
    driverName: null,
    notes: null,
    landingPageId: null,
    archivedAt: null,
    stage: "ready_to_ship",
    needsAttention: false,
    createdAt: "2026-10-20T10:00:00.000Z",
    updatedAt: "2026-10-20T10:00:00.000Z",
    shipmentId: null,
    shipmentKind: null,
    carrierName: null,
    trackingNumber: null,
    ...overrides,
  };
}

async function settle() {
  for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve(); });
}

async function render(ui: React.ReactNode) {
  await act(async () => { root.render(ui); });
  await settle();
}

const buttonNamed = (name: RegExp) => Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((b) => name.test(b.textContent ?? ""))!;
const choose = (label: RegExp) => Array.from(document.querySelectorAll<HTMLElement>('[role="radio"], [aria-checked]')).find((el) => label.test(el.textContent ?? ""))!;

describe("giving an order to the store's driver", () => {
  it("asks for no delivery type or stop desk, and says a stop-desk order goes to the door", async () => {
    api.handOffOrder.mockResolvedValue({ outcome: "accepted", orderId: "a", orderNumber: "ORD-a", shipment: { kind: "driver" } });
    const desk = order("a", { deliveryType: "stop_desk", stationCode: "16001" });
    await render(<HandoffDialog order={desk} kinds={["driver"]} companies={[]} drivers={[driver]} onClose={vi.fn()} onDone={vi.fn()} />);

    expect(document.querySelector("select")).toBeNull();
    expect(document.body.textContent).toContain("Your driver brings it to their address instead");
    await act(async () => { choose(/Samir B/).click(); });
    await act(async () => { buttonNamed(/Give to the driver/).click(); });
    await settle();

    expect(api.handOffOrder).toHaveBeenCalledWith("a", { kind: "driver", driverId: "dr1" });
  });

  it("cannot give a driver an order with no address", async () => {
    await render(<HandoffDialog order={order("a", { address: null, deliveryType: "stop_desk" })} kinds={["driver"]} companies={[]} drivers={[driver]} onClose={vi.fn()} onDone={vi.fn()} />);
    await act(async () => { choose(/Samir B/).click(); });

    expect(document.body.textContent).toContain("Your driver delivers to the customer's address. Edit the order to add one.");
    expect(buttonNamed(/Give to the driver/).disabled).toBe(true);
  });
});

describe("giving several orders to the store's driver", () => {
  it("leaves out and names the orders with no address, and sends the rest", async () => {
    api.handOffToDriver.mockResolvedValue({ results: [], summary: { accepted: 2, unknown: 0, refused: 0 } });
    const orders = [order("a"), order("b", { address: "  " }), order("c", { deliveryType: "stop_desk" })];
    await render(<BulkHandoffDialog orders={orders} kinds={["driver"]} companies={[]} drivers={[driver]} onClose={vi.fn()} onDone={vi.fn()} />);

    expect(document.body.textContent).toContain("1 order has no address and is left out");
    expect(document.querySelector('a[href="/orders/b"]')?.textContent).toBe("ORD-b");
    expect(document.body.textContent).toContain("1 customer chose a stop desk; your driver brings that parcel to their address.");
    await act(async () => { choose(/Samir B/).click(); });
    await act(async () => { buttonNamed(/Ship 2 orders/).click(); });
    await settle();

    expect(api.handOffToDriver).toHaveBeenCalledWith("dr1", ["a", "c"]);
  });
});
