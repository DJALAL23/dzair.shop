// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CarrierPlacesSummary } from "@/features/delivery/types";

const api = vi.hoisted(() => ({ getCompanyRates: vi.fn() }));
const geography = vi.hoisted(() => ({ listWilayas: vi.fn() }));
vi.mock("@/features/delivery/api", () => api);
vi.mock("@/features/geography/api", () => geography);

import { CompanyPlacesCard } from "./CompanyPlacesCard";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  window.localStorage.setItem("locale", "en");
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  api.getCompanyRates.mockReset().mockResolvedValue([
    { wilayaId: 5, communes: 61, home: { min: 800, max: 800 }, stopDesk: { min: 530, max: 530 }, returnFee: { min: 200, max: 200 } },
    { wilayaId: 16, communes: 57, home: { min: 500, max: 650 }, stopDesk: null, returnFee: { min: 200, max: 200 } },
  ]);
  geography.listWilayas.mockReset().mockResolvedValue([
    { id: 5, name: "Batna", nameAr: "باتنة" },
    { id: 16, name: "Alger", nameAr: "الجزائر" },
  ]);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});

const READ: CarrierPlacesSummary = { syncedAt: new Date(Date.now() - 180_000).toISOString(), communes: 1531, home: 1531, priced: 1531, total: 1541, unmatched: [] };
const text = () => document.body.textContent ?? "";
const button = (label: string) => Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim() === label);

async function render(places: CarrierPlacesSummary, onRead = vi.fn(), canManage = true) {
  await act(async () => root.render(<CompanyPlacesCard companyId="zr" companyName="ZR Express" places={places} canManage={canManage} reading={false} onRead={onRead} />));
  return onRead;
}

async function settle() {
  for (let i = 0; i < 4; i++) await act(async () => await Promise.resolve());
}

describe("where a delivery company delivers", () => {
  it("says what was read and when, and that it is read again on its own", async () => {
    await render(READ);
    expect(text()).toContain("1,531 communes of 1,541");
    expect(text()).toContain("read 3 minutes ago");
    expect(text()).toContain("read when it is connected and again every week");
  });

  it("reads again on demand, a secondary action once the list was read", async () => {
    const onRead = await render(READ);
    await act(async () => button("Read again")!.click());
    expect(onRead).toHaveBeenCalledOnce();
  });

  it("asks to read a list that was never read, and offers no prices", async () => {
    await render({ ...READ, syncedAt: null });
    expect(text()).toContain("has not been read yet");
    expect(button("Read its places")).toBeDefined();
    expect(button("See its prices")).toBeUndefined();
  });

  it("offers no reading to someone who cannot manage delivery", async () => {
    await render(READ, vi.fn(), false);
    expect(button("Read again")).toBeUndefined();
  });

  it("opens the company's prices in a side panel, only when asked, and leads to the shipping profiles", async () => {
    await render(READ);
    expect(api.getCompanyRates).not.toHaveBeenCalled();
    await act(async () => button("See its prices")!.click());
    await settle();
    const panel = document.querySelector('[role="dialog"]')!;
    expect(panel.textContent).toContain("What ZR Express charges you");
    const rows = Array.from(panel.querySelectorAll("tbody tr")).map((row) => row.textContent);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain("05 Batna");
    expect(rows[1]).toContain("No price");
    expect(panel.querySelector('a[href="/delivery/shipping-profiles"]')?.textContent).toContain("Use them in a shipping profile");
    await act(async () => button("Close")!.click());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});
