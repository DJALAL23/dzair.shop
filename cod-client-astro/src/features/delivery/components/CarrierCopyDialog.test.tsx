// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ShippingProfileWithRules } from "@/features/delivery/types";

const api = vi.hoisted(() => ({ listAllDeliveryCompanies: vi.fn(), previewCarrierCopy: vi.fn(), copyCarrierRates: vi.fn(), syncCompanyPlaces: vi.fn() }));
const notify = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(),
  ApiError: class ApiError extends Error {
    constructor(message: string, public status: number, public code?: string) {
      super(message);
    }
  },
}));
vi.mock("@/features/delivery/api", () => api);
vi.mock("@/lib/notify", () => ({ notify }));

import { ApiError } from "@/lib/api";
import { CarrierCopyDialog, copySummary } from "./CarrierCopyDialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  window.localStorage.setItem("locale", "en");
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  for (const fn of [...Object.values(api), ...Object.values(notify)]) fn.mockReset();
  api.listAllDeliveryCompanies.mockResolvedValue([
    { id: "zr", name: "ZR Express", nameAr: "زر إكسبرس", active: true },
    { id: "old", name: "Old Co", nameAr: "قديمة", active: false },
  ]);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
  vi.useRealTimers();
});

const profile = { id: "p1", name: "ZR prices", isDefault: false, notes: null, productCount: 2, rules: [], createdAt: "", updatedAt: "" } as unknown as ShippingProfileWithRules;
const prices = (homePrice: number, stopDeskPrice: number, communes = 0) => ({ homePrice, stopDeskPrice, homeEnabled: true, stopDeskEnabled: true, communes });
const PREVIEW = {
  company: { id: "zr", name: "ZR Express", nameAr: "زر إكسبرس", placesSyncedAt: new Date(Date.now() - 3_600_000).toISOString() },
  wilayas: [
    { wilayaId: 9, before: prices(500, 350), after: prices(500, 350) },
    { wilayaId: 16, before: prices(600, 400), after: prices(550, 400, 2) },
    { wilayaId: 31, before: prices(700, 450), after: null },
  ],
};

async function settle() {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      vi.advanceTimersByTime(300);
      await Promise.resolve();
    });
  }
}

async function choose(label: string, option: string) {
  const trigger = Array.from(document.querySelectorAll<HTMLButtonElement>('button[aria-haspopup="listbox"]')).find((b) => b.getAttribute("aria-label") === label)!;
  await act(async () => trigger.click());
  const item = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find((o) => o.textContent?.trim() === option)!;
  await act(async () => item.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
  await settle();
}

async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle();
}

const text = () => document.body.textContent ?? "";
const button = (label: string) => Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim() === label)!;

async function open() {
  const onCopied = vi.fn();
  await act(async () => root.render(<CarrierCopyDialog profile={profile} onClose={vi.fn()} onCopied={onCopied} />));
  await settle();
  return onCopied;
}

describe("copying a delivery company's prices into a profile", () => {
  it("offers only active companies, and copies nothing before one is chosen", async () => {
    await open();
    const trigger = document.querySelector<HTMLButtonElement>('button[aria-label="Delivery company"]')!;
    await act(async () => trigger.click());
    expect(Array.from(document.querySelectorAll('[role="option"]')).map((o) => o.textContent?.trim())).toEqual(["Choose a company", "ZR Express"]);
    expect(api.previewCarrierCopy).not.toHaveBeenCalled();
    expect(button("Replace the prices").disabled).toBe(true);
  });

  it("previews the change at the merchant's amount and rounding, then copies exactly that", async () => {
    api.previewCarrierCopy.mockResolvedValue(PREVIEW);
    api.copyCarrierRates.mockResolvedValue({ ...profile, rules: [] });
    const onCopied = await open();
    await choose("Delivery company", "ZR Express");
    await type(document.querySelector<HTMLInputElement>('input[type="number"]')!, "100");
    await choose("Round up", "Up to the next 50 DA");

    expect(api.previewCarrierCopy).toHaveBeenLastCalledWith("p1", { companyId: "zr", add: 100, roundTo: 50 });
    expect(text()).toContain("ZR Express's prices read 1 hour ago");
    expect(text()).toContain("Delivers to 2 wilayas");
    expect(text()).toContain("home delivery in 2 wilayas · stop desk in 2 wilayas");
    expect(text()).toContain("1 wilaya of this profile is not served by ZR Express: delivery there will be turned off.");
    const rows = Array.from(document.querySelectorAll("tbody tr")).map((r) => r.textContent);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain("2 communes with their own price");
    expect(rows[0]).toContain("was 600");
    expect(rows[1]).toContain("Not served: delivery off");

    await act(async () => button("Replace the prices").click());
    await settle();
    expect(api.copyCarrierRates).toHaveBeenCalledWith("p1", { companyId: "zr", add: 100, roundTo: 50 });
    expect(onCopied).toHaveBeenCalled();
    expect(notify.success).toHaveBeenCalledWith("ZR Express's prices are now this profile's prices.");
  });

  it("refuses an amount that is not a whole number from 0 to 5,000, and previews nothing for it", async () => {
    api.previewCarrierCopy.mockResolvedValue(PREVIEW);
    await open();
    await choose("Delivery company", "ZR Express");
    api.previewCarrierCopy.mockClear();
    await type(document.querySelector<HTMLInputElement>('input[type="number"]')!, "-5");
    expect(text()).toContain("Enter a whole amount from 0 to 5,000 DA.");
    expect(api.previewCarrierCopy).not.toHaveBeenCalled();
    expect(button("Replace the prices").disabled).toBe(true);
  });

  it("says when the company's prices were never read, and reads them again on demand", async () => {
    api.previewCarrierCopy.mockRejectedValueOnce(new (ApiError as any)("x", 422, "CARRIER_PLACES_NOT_READ")).mockResolvedValue(PREVIEW);
    api.syncCompanyPlaces.mockResolvedValue({});
    await open();
    await choose("Delivery company", "ZR Express");
    expect(text()).toContain("ZR Express's places and prices have not been read yet.");
    await act(async () => button("Read prices again").click());
    await settle();
    expect(api.syncCompanyPlaces).toHaveBeenCalledWith("zr");
    expect(text()).toContain("Delivers to 2 wilayas");
  });

  it("lists the wilayas that get new prices before the ones the company does not serve", () => {
    const { changed } = copySummary({
      ...PREVIEW,
      wilayas: [
        { wilayaId: 1, before: prices(500, 700), after: null },
        { wilayaId: 16, before: prices(600, 400), after: prices(550, 400) },
        { wilayaId: 2, before: prices(500, 700), after: null },
        { wilayaId: 9, before: prices(500, 700), after: prices(650, 450) },
      ],
    });
    expect(changed.map((w) => w.wilayaId)).toEqual([16, 9, 1, 2]);
  });

  it("says when the company gives no price", async () => {
    api.previewCarrierCopy.mockRejectedValue(new (ApiError as any)("x", 422, "CARRIER_RATES_MISSING"));
    await open();
    await choose("Delivery company", "ZR Express");
    expect(text()).toContain("ZR Express gives no prices for your account, so there is nothing to copy.");
    expect(button("Replace the prices").disabled).toBe(true);
  });
});
