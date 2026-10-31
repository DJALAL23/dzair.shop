// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DriverPayment } from "@/features/delivery/types";

const api = vi.hoisted(() => ({ listDriverPayments: vi.fn(), createDriverPayment: vi.fn() }));
vi.mock("@/lib/api", () => ({ apiFetch: vi.fn(), ApiError: class ApiError extends Error {} }));
vi.mock("@/features/delivery/api", () => api);
vi.mock("@/features/auth/components/RequireAuth", () => ({
  useIdentity: () => ({ role: "admin", scopes: [] }),
  canScope: () => true,
}));

import { ConfirmDialogProvider } from "@/components/ui";
import { DriverSettlementCard } from "./DriverSettlementCard";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  window.localStorage.setItem("locale", "en");
  api.listDriverPayments.mockReset();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});

const payment: DriverPayment = {
  id: "pay1",
  driverId: "d1",
  type: "cod_remittance",
  amount: 48700,
  orderCount: 3,
  notes: null,
  createdBy: "u1",
  createdByName: "Nadia",
  createdAt: "2026-10-30T10:00:00Z",
};

const sheet = () => document.body.querySelector<HTMLElement>('[role="dialog"]');
const button = (label: string) => Array.from(document.body.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent?.trim() === label);

async function mount() {
  await act(async () =>
    root.render(
      <ConfirmDialogProvider>
        <DriverSettlementCard driverId="d1" pending={[]} onSettled={() => undefined} />
      </ConfirmDialogProvider>,
    ),
  );
}

describe("settling with a driver", () => {
  it("is titled for what it is, not after the deliveries card above it", async () => {
    await mount();
    expect(host.querySelector("h2")!.textContent).toBe("Driver payments");
  });

  it("opens the payment history in a sheet, read only once it is opened", async () => {
    api.listDriverPayments.mockResolvedValue([payment]);
    await mount();
    expect(api.listDriverPayments).not.toHaveBeenCalled();
    expect(sheet()).toBeNull();

    await act(async () => button("History")!.click());
    expect(api.listDriverPayments).toHaveBeenCalledWith("d1");
    expect(sheet()!.querySelector("h2")!.textContent).toBe("Payment history");
    expect(sheet()!.textContent).toContain("COD received");
    expect(sheet()!.textContent).toContain("3 orders · Nadia");
    expect(host.textContent).not.toContain("COD received");
  });

  it("says when there is nothing yet, and when the history cannot be read", async () => {
    api.listDriverPayments.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error("offline"));
    await mount();
    await act(async () => button("History")!.click());
    expect(sheet()!.textContent).toContain("No payment records yet");
    await act(async () => (document.body.querySelector('[aria-label="Close"]') as HTMLButtonElement).click());
    await act(async () => button("History")!.click());
    expect(sheet()!.querySelector('[role="alert"]')!.textContent).toBe("Failed to load payment history");
  });
});
