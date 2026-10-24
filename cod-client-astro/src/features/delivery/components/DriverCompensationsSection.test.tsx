// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Driver, DriverCompensation, Wilaya } from "@/features/delivery/types";

vi.mock("@/lib/api", () => ({ apiFetch: vi.fn(), ApiError: class ApiError extends Error {} }));
vi.mock("@/features/auth/components/RequireAuth", () => ({
  useIdentity: () => ({ role: "admin", scopes: [] }),
  canScope: () => true,
}));

import { ConfirmDialogProvider } from "@/components/ui";
import { DriverCompensationsSection } from "./DriverCompensationsSection";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  window.localStorage.setItem("locale", "en");
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});

const driver = { id: "d1", firstName: "Karim", lastName: "B", phone: "0551234567" } as Driver;
const wilayas: Wilaya[] = [
  { id: 1, name: "Adrar", nameAr: "أدرار" },
  { id: 2, name: "Chlef", nameAr: "الشلف" },
  { id: 16, name: "Alger", nameAr: "الجزائر" },
];

/** The server's grid: every wilaya, with null where the driver has no rate. */
function grid(fees: Record<number, number>): DriverCompensation[] {
  return wilayas.map((w) => ({ wilayaId: w.id, wilayaName: w.name, wilayaNameAr: w.nameAr, feePerDelivery: fees[w.id] ?? null }));
}

function mount(compensations: DriverCompensation[]) {
  act(() =>
    root.render(
      <ConfirmDialogProvider>
        <DriverCompensationsSection driver={driver} compensations={compensations} wilayas={wilayas} />
      </ConfirmDialogProvider>,
    ),
  );
}

const addButtons = () => Array.from(host.querySelectorAll<HTMLButtonElement>("button")).filter((b) => b.textContent?.trim() === "Add rate");
const text = () => host.textContent ?? "";

describe("a driver's pay grid", () => {
  it("counts and lists only the wilayas with a rate, and lets the merchant add the others", () => {
    mount(grid({ 16: 300 }));

    expect(text()).toContain("rates configured1/ 3");
    expect(text()).toContain("300");
    expect(host.querySelectorAll("ul > li")).toHaveLength(1);
    expect(addButtons().every((b) => !b.disabled)).toBe(true);
  });

  it("shows the empty state when no wilaya has a rate", () => {
    mount(grid({}));

    expect(text()).toContain("No wilaya rates yet");
    expect(host.querySelectorAll("ul > li")).toHaveLength(0);
    expect(addButtons().every((b) => !b.disabled)).toBe(true);
  });

  it("offers in the new-rate picker only the wilayas without a rate", () => {
    mount(grid({ 16: 300 }));

    act(() => addButtons()[0].click());

    const options = Array.from(host.querySelectorAll("form option")).map((o) => o.getAttribute("value")).filter(Boolean);
    expect(options).toEqual(["1", "2"]);
    const trigger = host.querySelector<HTMLButtonElement>('form button[aria-haspopup="listbox"]')!;
    expect(trigger.textContent).toContain("01 — أدرار · Adrar");
    act(() => trigger.click());
    const shown = Array.from(document.querySelectorAll('[role="option"]')).map((o) => o.textContent?.trim());
    expect(shown).toEqual(["Choose a wilaya…", "01 — أدرار · Adrar", "02 — الشلف · Chlef"]);
  });
});
