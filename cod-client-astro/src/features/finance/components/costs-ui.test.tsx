// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Cost, CostsSummary, ExchangeRate } from "@/features/finance/types";

const api = vi.hoisted(() => ({
  listCosts: vi.fn(),
  getCostsSummary: vi.fn(),
  createCost: vi.fn(),
  updateCost: vi.fn(),
  deleteCost: vi.fn(),
  listRates: vi.fn(),
  setRate: vi.fn(),
  removeRate: vi.fn(),
}));
const products = vi.hoisted(() => ({ listProducts: vi.fn() }));
const identity = vi.hoisted(() => ({ scopes: [] as string[] }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/api", () => ({ apiFetch: vi.fn(), ApiError: class ApiError extends Error {} }));
vi.mock("@/features/finance/api", () => api);
vi.mock("@/features/products/api", () => products);
vi.mock("@/lib/notify", () => ({ notify: toast }));
vi.mock("@/features/auth/components/RequireAuth", () => ({
  RequireAuth: ({ children }: { children: ReactNode }) => children,
  useIdentity: () => ({ role: "staff", scopes: identity.scopes, user: { id: "u-0", email: "owner@shop.dz" } }),
  canScope: (_: unknown, scope: string) => identity.scopes.includes(scope),
}));

import { ConfirmDialogProvider } from "@/components/ui";
import CostsPageApp from "./CostsPageApp";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const T = "2026-11-01T08:00:00.000Z";
const MANAGER = ["finance:read", "finance:manage"];
const cost = (over: Partial<Cost>): Cost => ({ id: "c", name: "Cost", category: "other", charge: "monthly", amount: 1000, currency: "DZD", startsOn: "2026-09-01", since: "2026-09-01", stopsOn: null, product: null, history: [], revision: "rev-1", createdAt: T, updatedAt: T, ...over });
const RENT = cost({ id: "rent", name: "Loyer", category: "rent", amount: 30_000 });
const ADS = cost({ id: "fb", name: "Facebook robe", category: "ads", charge: "daily", amount: 20, currency: "USD", startsOn: "2026-11-01", since: "2026-11-01", product: { id: "robe", name: "Robe" } });
const PACKAGING = cost({ id: "pack", name: "Emballage", category: "packaging", charge: "per_shipped", amount: 80, startsOn: "2026-10-01", since: "2026-10-01" });
const SHOOT = cost({ id: "shoot", name: "Shooting", category: "content", charge: "once", amount: 25_000, startsOn: "2026-08-03", since: "2026-08-03" });
const SUMMARY: CostsSummary = {
  from: "2026-11-01",
  to: "2026-11-14",
  total: 15_600,
  ads: 0,
  running: 14_000,
  perOrder: 1_600,
  costs: [
    { id: "rent", amount: 14_000, ownAmount: 14_000, ownCurrency: "DZD", orders: null, missingFrom: null },
    { id: "fb", amount: 0, ownAmount: 280, ownCurrency: "USD", orders: null, missingFrom: "2026-11-01" },
    { id: "pack", amount: 1_600, ownAmount: 1_600, ownCurrency: "DZD", orders: 20, missingFrom: null },
  ],
  missing: [{ currency: "USD", from: "2026-11-01", costIds: ["fb"] }],
};
const RATES: ExchangeRate[] = [{ id: "e1", currency: "EUR", dzdPerUnit: 280, validFrom: "2026-10-01", createdAt: T }];

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-14T10:00:00.000Z"));
  window.localStorage.setItem("locale", "en");
  for (const fn of [...Object.values(api), ...Object.values(products), ...Object.values(toast)]) fn.mockReset();
  api.listCosts.mockResolvedValue([RENT, ADS, PACKAGING, SHOOT]);
  api.listRates.mockResolvedValue(RATES);
  api.getCostsSummary.mockResolvedValue(SUMMARY);
  products.listProducts.mockResolvedValue({ data: [] });
  identity.scopes = MANAGER;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
  vi.useRealTimers();
});

async function open() {
  await act(async () =>
    root.render(
      <ConfirmDialogProvider>
        <CostsPageApp />
      </ConfirmDialogProvider>,
    ),
  );
  for (let i = 0; i < 4; i++) await act(async () => {});
}

const settle = async () => {
  for (let i = 0; i < 4; i++) await act(async () => {});
};
const buttons = (within: Element, label: string) => [...within.querySelectorAll<HTMLButtonElement>("button")].filter((b) => b.getAttribute("aria-label") === label || b.textContent?.trim() === label);
const click = async (target: HTMLElement | undefined) => {
  if (!target) throw new Error("nothing to click");
  await act(async () => target.click());
  await settle();
};
const sheet = () => document.querySelector<HTMLElement>('[role="dialog"]')!;
const confirmBox = () => document.querySelector<HTMLElement>('[role="alertdialog"]')!;
const field = (label: string) => [...sheet().querySelectorAll("label")].find((l) => l.textContent?.startsWith(label))?.querySelector<HTMLInputElement>("input");

async function type(input: HTMLInputElement | null | undefined, text: string) {
  if (!input) throw new Error("no input");
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("the month's costs", () => {
  it("say what they come to, what is left out and how to fix it, what a dollar and a euro cost, and what each cost counted", async () => {
    await open();
    expect(api.getCostsSummary).toHaveBeenCalledWith("2026-11-01", "2026-11-14");
    expect(host.textContent).toContain("All costs so far");
    expect(host.textContent).toContain("15,600 DA");
    expect(host.textContent).toContain("1 cost is left out: see above");
    expect(host.textContent).toContain("Your costs in dollars are left out from Nov 1, 2026. Set what 1 $ costs you to count them.");
    expect(host.textContent).toContain("1 € = 280 DA");
    expect(host.textContent).toContain("Since Oct 1, 2026");
    expect(host.textContent).toContain("Not set: costs in this currency are left out");

    const rows = [...host.querySelectorAll("tbody tr")];
    expect(rows.map((row) => row.querySelector("td")?.textContent)).toEqual(["LoyerRent and bills", "EmballagePackaging", "Facebook robeAds · Robe"]);
    expect(rows[1]!.textContent).toContain("20 orders");
    expect(rows[1]!.textContent).toContain("Each shipped order");
    expect(rows[2]!.textContent).toContain("Left out: no rate");
    expect(rows[2]!.textContent).toContain("$20");
    expect(host.textContent).not.toContain("Shooting");

    await click(buttons(host, "Show 1 cost from other months")[0]);
    expect(host.textContent).toContain("Shooting");
  });

  it("show each cost as it stood in the month, in the table and in the phone list: its amount then, and when that amount ran", async () => {
    const raised = cost({ id: "rent", name: "Loyer", category: "rent", amount: 36_000, since: "2026-11-14", history: [{ charge: "monthly", amount: 30_000, currency: "DZD", product: null, validFrom: "2026-09-01", validTo: "2026-11-13" }] });
    api.listCosts.mockResolvedValue([raised]);
    await open();
    const row = () => host.querySelector("tbody tr")!.textContent;
    const item = () => host.querySelector('li button[aria-label="Edit Loyer"]')!.textContent;
    for (const shown of [row(), item()]) {
      expect(shown).toContain("36,000 DA");
      expect(shown).toContain("Since Nov 14, 2026");
    }
    await click(buttons(host, "Previous month")[0]);
    expect(api.getCostsSummary).toHaveBeenLastCalledWith("2026-10-01", "2026-10-31");
    for (const shown of [row(), item()]) {
      expect(shown).toContain("30,000 DA");
      expect(shown).toContain("Sep 1, 2026 to Nov 13, 2026");
    }
  });

  it("sets the dollar rate from the first day left out, in one step", async () => {
    await open();
    await click(buttons(host, "Set the dollar rate")[0]);
    expect(sheet().textContent).toContain("What does 1 $ cost you?");
    expect(field("From")?.value).toBe("2026-11-01");
    api.setRate.mockResolvedValue({ id: "u1", currency: "USD", dzdPerUnit: 250, validFrom: "2026-11-01", createdAt: T });
    await type(field("In dinars"), "250");
    await click(buttons(sheet(), "Save the rate")[0]);
    expect(api.setRate).toHaveBeenCalledWith({ currency: "USD", dzdPerUnit: 250, validFrom: "2026-11-01" });
    expect(toast.success).toHaveBeenCalledWith("Rate saved");
    expect(api.listCosts).toHaveBeenCalledTimes(2);
  });
});

describe("adding a cost", () => {
  it("starts from what stores usually pay for, and sends exactly what was chosen", async () => {
    await open();
    await click(buttons(host, "Add a cost")[0]);
    await click(buttons(sheet(), "Facebook ads")[0]);
    expect(field("Name")?.value).toBe("Facebook ads");
    expect(sheet().textContent).toContain("No rate is set for this currency yet");
    await type(field("Amount"), "20");
    api.createCost.mockResolvedValue(cost({}));
    await click(buttons(sheet(), "Save")[0]);
    expect(api.createCost).toHaveBeenCalledWith({ name: "Facebook ads", category: "ads", charge: "daily", amount: 20, currency: "USD", startsOn: "2026-11-14", stopsOn: null, productId: null });
    expect(toast.success).toHaveBeenCalledWith("Cost added");
    expect(sheet()).toBeNull();
  });

  it("says what does not belong here", async () => {
    await open();
    await click(buttons(host, "Add a cost")[0]);
    expect(sheet().textContent).toContain("Not here: what your products cost you, delivery fees and your confirmation team's pay.");
  });

  it("says what is missing instead of saving", async () => {
    await open();
    await click(buttons(host, "Add a cost")[0]);
    await type(field("Amount"), "12.345");
    await click(buttons(sheet(), "Save")[0]);
    expect(sheet().textContent).toContain("Give it a name.");
    expect(sheet().textContent).toContain("Enter an amount above zero, with at most two decimals.");
    expect(api.createCost).not.toHaveBeenCalled();
  });

  it("opens an empty store on what stores usually pay for", async () => {
    api.listCosts.mockResolvedValue([]);
    api.getCostsSummary.mockResolvedValue({ ...SUMMARY, total: 0, running: 0, perOrder: 0, costs: [], missing: [] });
    await open();
    expect(host.textContent).toContain("No costs yet");
    await click(buttons(host, "Rent")[0]);
    expect(field("Name")?.value).toBe("Rent");
  });
});

describe("changing a cost", () => {
  it("asks from which day a new amount applies, leaves the product as it is, and names the cost as it was read", async () => {
    await open();
    await click(buttons(host, "Edit Loyer")[0]);
    expect(field("Apply this change from")).toBeUndefined();
    await type(field("Amount"), "36000");
    expect(field("Apply this change from")?.value).toBe("2026-11-14");
    expect(field("Apply this change from")?.max).toBe("2026-11-14");
    expect(field("Apply this change from")?.min).toBe("2026-09-01");
    api.updateCost.mockResolvedValue(RENT);
    await click(buttons(sheet(), "Save")[0]);
    expect(api.updateCost).toHaveBeenCalledWith("rent", { name: "Loyer", category: "rent", charge: "monthly", amount: 36_000, currency: "DZD", startsOn: "2026-09-01", stopsOn: null, changeFrom: "2026-11-14" }, "rev-1");
  });

  it("asks from which day it is for another product too, and refuses a day after today", async () => {
    await open();
    await click(buttons(host, "Edit Facebook robe")[0]);
    expect(field("Apply this change from")).toBeUndefined();
    await click(buttons(sheet(), "The whole store")[0]);
    await type(field("Apply this change from"), "2026-11-20");
    await click(buttons(sheet(), "Save")[0]);
    expect(sheet().textContent).toContain("Choose a day from Nov 1, 2026 to Nov 14, 2026.");
    expect(api.updateCost).not.toHaveBeenCalled();
    await type(field("Apply this change from"), "2026-11-10");
    api.updateCost.mockResolvedValue(ADS);
    await click(buttons(sheet(), "Save")[0]);
    expect(api.updateCost).toHaveBeenCalledWith("fb", expect.objectContaining({ productId: null, changeFrom: "2026-11-10" }), "rev-1");
  });

  it("asks, for a cost that stopped before today, for a day up to its last day only", async () => {
    api.listCosts.mockResolvedValue([cost({ id: "rent", name: "Loyer", category: "rent", amount: 30_000, stopsOn: "2026-10-31" })]);
    await open();
    await click(buttons(host, "Show 1 cost from other months")[0]);
    await click(buttons(host, "Edit Loyer")[0]);
    await type(field("Amount"), "36000");
    expect(field("Apply this change from")?.value).toBe("2026-09-01");
    expect(field("Apply this change from")?.max).toBe("2026-10-31");
    await type(field("Apply this change from"), "2026-11-05");
    await click(buttons(sheet(), "Save")[0]);
    expect(sheet().textContent).toContain("Choose a day from Sep 1, 2026 to Oct 31, 2026.");
    expect(api.updateCost).not.toHaveBeenCalled();
    await type(field("Apply this change from"), "2026-10-15");
    api.updateCost.mockResolvedValue(RENT);
    await click(buttons(sheet(), "Save")[0]);
    expect(api.updateCost).toHaveBeenCalledWith("rent", expect.objectContaining({ amount: 36_000, stopsOn: "2026-10-31", changeFrom: "2026-10-15" }), "rev-1");
  });

  it("keeps a deleted product's cost on it when only the amount changes", async () => {
    api.listCosts.mockResolvedValue([cost({ id: "pack", name: "Emballage robe", category: "packaging", charge: "per_shipped", amount: 80, startsOn: "2026-11-14", since: "2026-11-14", product: { id: null, name: "Robe" } })]);
    await open();
    await click(buttons(host, "Edit Emballage robe")[0]);
    await type(field("Amount"), "90");
    api.updateCost.mockResolvedValue(PACKAGING);
    await click(buttons(sheet(), "Save")[0]);
    expect(api.updateCost).toHaveBeenCalledWith("pack", { name: "Emballage robe", category: "packaging", charge: "per_shipped", amount: 90, currency: "DZD", startsOn: "2026-11-14", stopsOn: null }, "rev-1");
  });

  it("shows what each earlier amount was for when it was for something else", async () => {
    api.listCosts.mockResolvedValue([
      cost({ id: "fb", name: "Facebook", category: "ads", charge: "daily", amount: 20, currency: "USD", since: "2026-11-10", product: { id: "sac", name: "Sac" }, history: [{ charge: "daily", amount: 20, currency: "USD", product: { id: null, name: "Robe" }, validFrom: "2026-09-01", validTo: "2026-11-09" }] }),
    ]);
    await open();
    await click(buttons(host, "Edit Facebook")[0]);
    expect(sheet().textContent).toContain("History");
    expect(sheet().textContent).toContain("$20 · Every day · for Robe (deleted) · Sep 1, 2026 to Nov 9, 2026");
  });

  it("never overwrites a cost someone changed meanwhile: it says so and reloads", async () => {
    await open();
    await click(buttons(host, "Edit Loyer")[0]);
    await type(field("Amount"), "36000");
    api.updateCost.mockRejectedValue(Object.assign(new Error("changed"), { code: "COST_CHANGED" }));
    await click(buttons(sheet(), "Save")[0]);
    expect(toast.error).toHaveBeenCalledWith("Someone changed this cost meanwhile, so nothing was saved. The list is up to date: open the cost again.");
    expect(sheet()).toBeNull();
    expect(api.listCosts).toHaveBeenCalledTimes(2);
  });

  it("stops a running cost today, and deletes one only after saying it is for a mistake", async () => {
    await open();
    await click(buttons(host, "Edit Loyer")[0]);
    await type(field("Amount"), "99999");
    await click(buttons(sheet(), "Stop it today")[0]);
    expect(confirmBox().textContent).toContain("Stop Loyer today?");
    api.updateCost.mockResolvedValue(RENT);
    await click(buttons(confirmBox(), "Stop it today")[0]);
    expect(api.updateCost).toHaveBeenCalledWith("rent", { name: "Loyer", category: "rent", charge: "monthly", amount: 30_000, currency: "DZD", startsOn: "2026-09-01", stopsOn: "2026-11-14" }, "rev-1");

    await click(buttons(host, "Edit Emballage")[0]);
    await click(buttons(sheet(), "Delete")[0]);
    expect(confirmBox().textContent).toContain("Only for a mistake");
    api.deleteCost.mockResolvedValue({});
    await click(buttons(confirmBox(), "Delete")[0]);
    expect(api.deleteCost).toHaveBeenCalledWith("pack");
    expect(toast.success).toHaveBeenLastCalledWith("Cost deleted");
  });

  it("shows a refusal in plain words and keeps the sheet open", async () => {
    await open();
    await click(buttons(host, "Edit Loyer")[0]);
    api.updateCost.mockRejectedValue(Object.assign(new Error("refused"), { code: "COST_DATES_INVALID" }));
    await type(field("Amount"), "36000");
    await click(buttons(sheet(), "Save")[0]);
    expect(sheet().textContent).toContain("These days don't fit");
  });
});

describe("who sees what", () => {
  it("shows the costs to someone who may only read them, and changes nothing", async () => {
    identity.scopes = ["finance:read"];
    await open();
    expect(buttons(host, "Add a cost")).toEqual([]);
    expect(buttons(host, "Set the dollar rate")).toEqual([]);
    expect(buttons(host, "Change")).toEqual([]);
    await click(buttons(host, "See Loyer")[0]);
    expect(sheet().querySelector("h2")?.textContent).toBe("Cost");
    expect(field("Name")?.disabled || sheet().querySelector("fieldset")?.disabled).toBe(true);
    expect(buttons(sheet(), "Save")).toEqual([]);
  });

  it("says so to someone without the finance permission, and asks nothing", async () => {
    identity.scopes = ["orders:read"];
    await open();
    expect(host.textContent).toContain("You need the finance permission to see the store's costs.");
    expect(api.listCosts).not.toHaveBeenCalled();
    expect(api.getCostsSummary).not.toHaveBeenCalled();
  });
});

describe.each(["ar", "fr"])("in %s", (locale) => {
  it("every string resolves: no raw translation key reaches the screen", async () => {
    window.localStorage.setItem("locale", locale);
    await open();
    await click(buttons(host, locale === "ar" ? "إضافة مصروف" : "Ajouter une dépense")[0]);
    expect(document.body.textContent).not.toMatch(/\b(totals|missing|rates|list|when|empty|charge|kinds|category|presets|sheet|rate_sheet|feedback|errors)\.[a-z_]+/);
  });
});
