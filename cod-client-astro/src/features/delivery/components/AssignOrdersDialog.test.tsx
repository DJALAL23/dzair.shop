// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Driver } from "@/features/delivery/types";

const api = vi.hoisted(() => ({ listOrders: vi.fn(), handOffToDriver: vi.fn() }));
vi.mock("@/lib/api", () => ({ apiFetch: vi.fn(), ApiError: class ApiError extends Error {} }));
vi.mock("@/features/orders/api", () => api);

import { AssignOrdersDialog } from "./AssignOrdersDialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  window.localStorage.setItem("locale", "en");
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  api.listOrders.mockReset();
  api.handOffToDriver.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});

const driver = { id: "dr1", firstName: "Samir", lastName: "B", phone: "0661000000", status: "available" } as Driver;
const order = (id: string, address: string | null, deliveryType: "home" | "stop_desk" = "home") => ({
  id,
  orderNumber: `ORD-${id}`,
  customerName: "Karim",
  wilaya: "Alger",
  address,
  deliveryType,
});

async function settle() {
  for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve(); });
}

const box = (label: string) => Array.from(document.querySelectorAll("label")).find((l) => l.textContent?.includes(label))!.querySelector<HTMLInputElement>("input")!;

describe("giving ready orders to a driver from the driver's page", () => {
  it("cannot pick an order with no address, says a stop-desk one goes to the door, and selects all the others", async () => {
    api.listOrders.mockResolvedValue({ orders: [order("a", "12 Rue Didouche"), order("b", null), order("c", "5 Cité 200", "stop_desk")], nextCursor: null });
    api.handOffToDriver.mockResolvedValue({ results: [], summary: { accepted: 2, unknown: 0, refused: 0 } });
    await act(async () => { root.render(<AssignOrdersDialog driver={driver} onClose={vi.fn()} onDone={vi.fn()} />); });
    await settle();

    expect(box("ORD-b").disabled).toBe(true);
    expect(box("ORD-b").closest("label")!.textContent).toContain("No address");
    expect(box("ORD-c").closest("label")!.textContent).toContain("Chose a stop desk — delivered to the address");

    await act(async () => { box("Select all").click(); });
    expect([box("ORD-a").checked, box("ORD-b").checked, box("ORD-c").checked]).toEqual([true, false, true]);
    await act(async () => { Array.from(document.querySelectorAll("button")).find((b) => /Give 2 orders/.test(b.textContent ?? ""))!.click(); });
    await settle();

    expect(api.handOffToDriver).toHaveBeenCalledWith("dr1", ["a", "c"]);
  });
});
