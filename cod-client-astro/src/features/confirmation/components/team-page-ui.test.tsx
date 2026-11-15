// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MemberResults, PayrollLine, TeamConfig, TeamMember, TeamOverview } from "@/features/confirmation/types";

const team = vi.hoisted(() => ({
  getTeam: vi.fn(),
  getTeamSettings: vi.fn(),
  getTeamResults: vi.fn(),
  getPayroll: vi.fn(),
  getMyMembership: vi.fn(),
  setMyReceiving: vi.fn(),
  shareOutNow: vi.fn(),
  setMemberReceiving: vi.fn(),
  removeTeamMember: vi.fn(),
  listCandidates: vi.fn(),
  addTeamMember: vi.fn(),
  updateTeamSettings: vi.fn(),
  listMemberPay: vi.fn(),
  setMemberPay: vi.fn(),
  removePayRate: vi.fn(),
}));
const identity = vi.hoisted(() => ({ scopes: [] as string[] }));
vi.mock("@/lib/api", () => ({ apiFetch: vi.fn(), ApiError: class ApiError extends Error {} }));
vi.mock("@/features/confirmation/api", () => team);
vi.mock("@/features/auth/components/RequireAuth", () => ({
  RequireAuth: ({ children }: { children: ReactNode }) => children,
  useIdentity: () => ({ role: "staff", scopes: identity.scopes, user: { id: "u-0", email: "owner@shop.dz" } }),
  canScope: (_: unknown, scope: string) => identity.scopes.includes(scope),
}));

import ConfirmationPageApp from "./ConfirmationPageApp";
import { formatMoney } from "@/features/orders/model";
import { storeMonth } from "@/lib/store-time";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

const MANAGER = ["team:read", "team:manage"];
const FINANCE = [...MANAGER, "finance:read", "finance:manage"];
const CONFIG: TeamConfig = { distribution: "evenly", takeBackMinutes: null, takeBackLimit: 2 };

const member = (n: number, name = `Member ${String(n).padStart(2, "0")}`): TeamMember => ({
  userId: `u-${n}`, name, email: `m${n}@shop.dz`, role: "staff", active: true, receiving: true, joinedAt: "2026-11-01T00:00:00.000Z", waiting: n, callbacks: 0, reach: "own",
});
const overview = (members: TeamMember[]): TeamOverview => ({ members, unassigned: 0, needsManager: 0, withFormerMembers: 0 });
const result = (name: string, fields: Partial<MemberResults>): MemberResults => ({
  userId: name, name, assigned: 0, waiting: 0, confirmed: 0, cancelled: 0, delivered: 0, returned: 0, confirmationRate: null, deliveryRate: null, minutesToDecide: null, cancelledAfterNoAnswer: 0, noAnswerCallsBeforeCancel: 0, ...fields,
});
const line = (name: string, fields: Partial<PayrollLine> = {}): PayrollLine => ({
  userId: name, name, onTeam: true, joinedOn: null, leftOn: null, paySet: true, salary: null,
  confirmed: { orders: 0, amount: 0, unpriced: 0 }, delivered: { orders: 0, amount: 0, unpriced: 0 }, total: 0, incomplete: false, ...fields,
});

beforeEach(() => {
  window.localStorage.setItem("locale", "en");
  window.history.replaceState(null, "", "/orders/team");
  for (const fn of Object.values(team)) fn.mockReset();
  team.getTeam.mockResolvedValue(overview([member(1, "Samira"), member(2, "Karim")]));
  team.getTeamSettings.mockResolvedValue(CONFIG);
  team.getMyMembership.mockResolvedValue({ member: false, receiving: false });
  team.getTeamResults.mockResolvedValue([]);
  team.getPayroll.mockResolvedValue([]);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
});

async function open(scopes: string[], search = "") {
  identity.scopes = scopes;
  window.history.replaceState(null, "", `/orders/team${search}`);
  await act(async () => root.render(<ConfirmationPageApp />));
  await act(async () => {});
}

const tabs = () => [...host.querySelectorAll<HTMLButtonElement>('[role="tablist"][aria-label="Confirmation team views"] [role="tab"]')];
const tab = (name: string) => tabs().find((button) => button.textContent!.startsWith(name))!;
const panel = (name: string) => host.querySelector<HTMLElement>(`[role="tabpanel"][aria-label="${name}"]`);
const visible = () => [...host.querySelectorAll<HTMLElement>('[role="tabpanel"]')].filter((section) => !section.hidden).map((section) => section.getAttribute("aria-label"));
const click = async (element: Element) => act(async () => (element as HTMLElement).click());
const spoken = (element: Element) => {
  const copy = element.cloneNode(true) as Element;
  copy.querySelectorAll('[aria-hidden="true"]').forEach((node) => node.remove());
  return copy.textContent!.trim();
};
const tableRows = (section: HTMLElement) => [...section.querySelectorAll("tbody tr")].map((row) => spoken(row.querySelector("td")!));

async function choose(label: string, option: string) {
  const trigger = [...document.querySelectorAll<HTMLButtonElement>('button[aria-haspopup="listbox"]')].find((b) => b.getAttribute("aria-label") === label)!;
  await act(async () => trigger.click());
  const item = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((o) => o.textContent?.trim() === option)!;
  await act(async () => item.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
  await act(async () => {});
}
const header = (within: HTMLElement, label: string) => [...within.querySelectorAll("th button")].find((b) => b.textContent!.trim() === label)!;
const button = (within: HTMLElement, label: string) => [...within.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === label || b.textContent!.trim() === label)!;

async function type(input: HTMLInputElement, text: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("the confirmation team's views", () => {
  it("opens on the team, offers the payroll only to someone who may see pay, and keeps the open view in the address", async () => {
    await open(MANAGER, "?tab=payroll");
    expect(tabs().map((b) => b.textContent)).toEqual(["Team2", "Results"]);
    expect(visible()).toEqual(["Team"]);
    expect(team.getPayroll).not.toHaveBeenCalled();
    expect(team.getTeamResults).not.toHaveBeenCalled();

    await click(tab("Results"));
    expect(visible()).toEqual(["Results"]);
    expect(window.location.search).toBe("?tab=results");
    expect(team.getTeamResults).toHaveBeenCalledTimes(1);

    await click(tab("Team"));
    expect(visible()).toEqual(["Team"]);
    expect(window.location.search).toBe("");
    await click(tab("Results"));
    expect(team.getTeamResults).toHaveBeenCalledTimes(1);
  });

  it("opens the payroll from a link for someone with the finance permission", async () => {
    await open(FINANCE, "?tab=payroll");
    expect(tabs().map((b) => b.textContent)).toEqual(["Team2", "Results", "Payroll"]);
    expect(visible()).toEqual(["Payroll"]);
    expect(team.getPayroll).toHaveBeenCalledTimes(1);
  });

  it("stays shut without the team permission, asking the server nothing", async () => {
    await open(["orders:read"]);
    expect(host.textContent).toContain("You don't have access to the confirmation team.");
    expect(team.getTeam).not.toHaveBeenCalled();
  });
});

describe("the team view", () => {
  it("adds up who is available and what is left to call, and links each number to its orders", async () => {
    team.getTeam.mockResolvedValue({
      ...overview([{ ...member(1, "Samira"), waiting: 3, callbacks: 2 }, { ...member(2, "Karim"), receiving: false, waiting: 1 }, { ...member(3, "Nadia"), waiting: 0, reach: "none" }]),
      unassigned: 4,
    });
    await open(MANAGER);
    const section = panel("Team")!;
    expect(section.textContent).toContain("Available now1of 3 members");
    expect(section.textContent).toContain("Can't see any orders yet.");
    expect(section.textContent).toContain("Orders to call44 not assigned yet");
    expect(section.querySelector('a[href="/orders?view=callbacks"]')!.textContent).toContain("2");
    expect(section.textContent).toContain("4 new orders aren't assigned");
    expect(section.textContent).toContain("Balanced · Each new order goes to the available member with the fewest orders to call.");
  });

  it("finds a member and pages a larger team ten at a time", async () => {
    team.getTeam.mockResolvedValue(overview(Array.from({ length: 12 }, (_, i) => member(i + 1))));
    await open(MANAGER);
    const section = panel("Team")!;
    expect(tab("Team").textContent).toBe("Team12");
    expect(tableRows(section)).toHaveLength(10);
    expect(section.textContent).toContain("Showing 1 to 10 of 12");

    await click(button(section, "Next page"));
    expect(tableRows(section).map((name) => name.slice(0, 9))).toEqual(["Member 11", "Member 12"]);

    await type(section.querySelector<HTMLInputElement>('input[placeholder="Search by name or email"]')!, "m3@shop");
    expect(tableRows(section).map((name) => name.slice(0, 9))).toEqual(["Member 03"]);
    expect(section.textContent).not.toContain("Showing");

    await type(section.querySelector<HTMLInputElement>("input")!, "nobody");
    expect(section.textContent).toContain("No member matches “nobody”.");
  });

  it("has no search for a small team", async () => {
    await open(MANAGER);
    expect(panel("Team")!.querySelector("input[placeholder]")).toBeNull();
  });
});

describe("the results view", () => {
  it("works the team's rates out from its sums, and sorts members by any column", async () => {
    team.getTeamResults.mockResolvedValue([
      result("Samira", { assigned: 10, confirmed: 9, cancelled: 1, confirmationRate: 90, delivered: 1, returned: 0, deliveryRate: 100 }),
      result("Karim", { assigned: 30, confirmed: 3, cancelled: 27, confirmationRate: 10, delivered: 1, returned: 3, deliveryRate: 25 }),
      result("Amel", { assigned: 2, waiting: 2 }),
    ]);
    await open(MANAGER, "?tab=results");
    const section = panel("Results")!;
    expect(section.textContent).toContain("Confirmation rate30%");
    expect(section.textContent).toContain("Delivery rate40%");
    expect(tableRows(section)).toEqual(["Karim", "Samira", "Amel"]);

    await click(header(section, "Confirmation rate"));
    expect(tableRows(section)).toEqual(["Samira", "Karim", "Amel"]);
    expect(header(section, "Confirmation rate").closest("th")!.getAttribute("aria-sort")).toBe("descending");
    await click(header(section, "Confirmation rate"));
    expect(tableRows(section)).toEqual(["Karim", "Samira", "Amel"]);
  });

  it("says how many calls each member made before cancelling an order nobody answered, and sorts by it", async () => {
    team.getTeamResults.mockResolvedValue([
      result("Samira", { assigned: 10, cancelled: 5, cancelledAfterNoAnswer: 4, noAnswerCallsBeforeCancel: 6 }),
      result("Karim", { assigned: 8, cancelled: 3, cancelledAfterNoAnswer: 2, noAnswerCallsBeforeCancel: 6 }),
      result("Amel", { assigned: 2, waiting: 2 }),
    ]);
    await open(MANAGER, "?tab=results");
    const section = panel("Results")!;
    const column = [...section.querySelectorAll("thead th")].findIndex((th) => th.textContent?.includes("Calls before cancelling"));
    expect(column).toBeGreaterThan(0);
    const wrapping = [...section.querySelectorAll("thead th")].filter((th) => th.classList.contains("whitespace-normal")).map((th) => th.textContent);
    expect(wrapping).toEqual(["Calls before cancelling", "Confirmation rate", "Delivery rate", "Response time"]);
    const calls = () => [...section.querySelectorAll("tbody tr")].map((row) => [spoken(row.querySelector("td")!), row.querySelectorAll("td")[column]!.textContent, row.querySelectorAll("td")[column]!.querySelector("[title]")?.getAttribute("title") ?? null]);
    expect(calls()).toEqual([
      ["Samira", "1.5", "4 orders cancelled after no answer"],
      ["Karim", "3", "2 orders cancelled after no answer"],
      ["Amel", "—", null],
    ]);
    await click(header(section, "Calls before cancelling"));
    expect(tableRows(section)).toEqual(["Karim", "Samira", "Amel"]);
    await click(header(section, "Calls before cancelling"));
    expect(tableRows(section)).toEqual(["Samira", "Karim", "Amel"]);
    const cards = [...section.querySelectorAll("ul li")].map((card) => card.textContent);
    expect(cards.find((text) => text?.startsWith("S"))).toContain("Calls before cancelling1.5");
    expect(cards.find((text) => text?.includes("Amel"))).toContain("2 orders · 2 still to call");
  });

  it("asks again for another period", async () => {
    await open(MANAGER, "?tab=results");
    await choose("Period", "Last 30 days");
    expect(team.getTeamResults).toHaveBeenCalledTimes(2);
    const [[from7, to7], [from30, to30]] = team.getTeamResults.mock.calls as [[string, string], [string, string]];
    expect(to30).toBe(to7);
    expect(from30 < from7).toBe(true);
  });
});

describe("the payroll view", () => {
  it("puts what needs the merchant first, says so, and adds up every line, not only the page shown", async () => {
    const paid = Array.from({ length: 11 }, (_, i) => line(`Agent ${String(i + 1).padStart(2, "0")}`, { salary: 1000, confirmed: { orders: 2, amount: 100, unpriced: 0 }, total: 1100 }));
    team.getPayroll.mockResolvedValue([
      ...paid,
      line("Zineb", { paySet: false, incomplete: true }),
      line("Yacine", { onTeam: false, delivered: { orders: 1, amount: 200, unpriced: 0 }, total: 200 }),
    ]);
    await open(FINANCE, "?tab=payroll");
    const section = panel("Payroll")!;
    const money = (amount: number) => formatMoney(amount, "en");
    expect(section.textContent).toContain(`To pay so far${money(12300)}Pay missing for 1 person`);
    expect(section.textContent).toContain(`Salaries${money(11000)}`);
    expect(section.textContent).toContain(`Commissions${money(1300)}`);

    const rows = [...section.querySelectorAll("tbody tr")];
    expect(rows[0]!.textContent).toContain("Zineb");
    expect(rows[0]!.textContent).toContain("Pay not set");
    expect(rows).toHaveLength(11);
    expect(rows.at(-1)!.textContent).toBe(`Total (13 people)${money(11000)}${money(1100)}${money(200)}${money(12300)}`);

    await click(button(section, "Next page"));
    const second = [...section.querySelectorAll("tbody tr")];
    expect(second[2]!.textContent).toContain("Yacine");
    expect(second[2]!.textContent).toContain("No longer on the team");
    expect(second.at(-1)!.textContent).toContain(money(12300));
  });

  it("shows another month, never one still to come, and comes back to this one", async () => {
    team.getPayroll.mockResolvedValue([line("Samira", { salary: 1000, total: 1000 })]);
    await open(FINANCE, "?tab=payroll");
    const section = panel("Payroll")!;
    expect(button(section, "Next month").disabled).toBe(true);
    expect(section.textContent).not.toContain("This month");

    await click(button(section, "Previous month"));
    expect(team.getPayroll).toHaveBeenCalledTimes(2);
    const [[current], [previous]] = team.getPayroll.mock.calls as [[string], [string]];
    expect(previous < current).toBe(true);
    expect(section.textContent).toContain("To pay");
    expect(section.textContent).not.toContain("To pay so far");

    await click(button(section, "This month"));
    expect(team.getPayroll).toHaveBeenLastCalledWith(current);
  });

  it("says plainly when nobody is on a month's payroll, with no totals of nothing", async () => {
    await open(FINANCE, "?tab=payroll");
    const section = panel("Payroll")!;
    expect(section.textContent).toContain("No one to pay this month");
    expect(section.textContent).not.toContain("Salaries");
    expect(section.querySelector("table")).toBeNull();
  });

  it("opens a person's pay from their row", async () => {
    team.getPayroll.mockResolvedValue([line("Samira", { salary: 1000, total: 1000 })]);
    team.listMemberPay.mockResolvedValue([]);
    await open(FINANCE, "?tab=payroll");
    await click(panel("Payroll")!.querySelector("tbody tr td")!);
    expect(document.body.textContent).toContain("Pay for Samira");
    expect(team.listMemberPay).toHaveBeenCalledWith("Samira");
  });

  it("marks only what changed in the month: a join after its first day, a leave; an empty commission is a dash", async () => {
    const month = storeMonth();
    team.getPayroll.mockResolvedValue([
      line("Amel", { joinedOn: `${month}-01`, salary: 1000, total: 1000 }),
      line("Bilel", { joinedOn: `${month}-12`, salary: 1000, total: 1000 }),
      line("Chafia", { leftOn: `${month}-09`, salary: 1000, confirmed: { orders: 3, amount: 300, unpriced: 0 }, total: 1300 }),
    ]);
    await open(FINANCE, "?tab=payroll");
    const rows = [...panel("Payroll")!.querySelectorAll("tbody tr")];
    expect(rows[0]!.textContent).not.toContain("Joined");
    expect(rows[1]!.textContent).toContain("Joined");
    expect(rows[2]!.textContent).toContain("Left");
    expect([...rows[0]!.querySelectorAll("td")].slice(2, 4).map((td) => td.textContent)).toEqual(["—", "—"]);
    expect(rows[2]!.querySelectorAll("td")[2]!.textContent).toBe(`${formatMoney(300, "en")}3 orders`);
  });
});
