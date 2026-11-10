// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({
  fetchIdentity: vi.fn(),
  knownIdentity: vi.fn(),
  watchIdentity: vi.fn(() => () => undefined),
  currentJwt: vi.fn(),
  refreshJwt: vi.fn(),
  SessionUnavailableError: class extends Error {},
}));
vi.mock("@/lib/session", () => session);
vi.mock("@/lib/api", () => ({ ApiError: class extends Error {}, apiFetch: vi.fn() }));

const notifications = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/notify", () => ({ notify: notifications }));

const api = vi.hoisted(() => ({
  getProtection: vi.fn(),
  setProtectionEnabled: vi.fn(),
  chooseTemplate: vi.fn(),
  createRule: vi.fn(),
  updateRule: vi.fn(),
  setRuleMode: vi.fn(),
  deleteRule: vi.fn(),
  listBlockList: vi.fn(),
  addToBlockList: vi.fn(),
  removeFromBlockList: vi.fn(),
  listAttempts: vi.fn(),
  attemptOfOrder: vi.fn(),
  rescueSpamOrder: vi.fn(),
  deleteSpamOrder: vi.fn(),
}));
vi.mock("@/features/apps/order-protection/api", () => api);

import { ConfirmDialogProvider } from "@/components/ui";
import { RequireAuth } from "@/features/auth/components/RequireAuth";
import OrderProtectionApp from "./OrderProtectionApp";
import RulePageApp from "./RulePageApp";
import SpamOrdersPageApp from "@/features/orders/components/SpamOrdersPageApp";
import { OrderProtectionCard } from "@/features/orders/components/OrderProtectionCard";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
const member = (scopes: string[]) => ({ user: { id: "u", name: "S", email: "s@example.com" }, role: "staff", scopes });
const MANAGER = member(["order-protection:read", "order-protection:manage"]);
const READER = member(["order-protection:read"]);
const onSaved = vi.fn();

function signIn(identity: unknown) {
  session.fetchIdentity.mockResolvedValue(identity);
  session.knownIdentity.mockReturnValue(identity);
}

async function settle() {
  for (let i = 0; i < 6; i += 1) await act(async () => void (await Promise.resolve()));
}

async function mount(node: React.ReactNode) {
  await act(async () => root.render(<ConfirmDialogProvider>{node}</ConfirmDialogProvider>));
  await settle();
}

const byText = (text: string, selector = "button,a,[role=radio]") => [...document.querySelectorAll<HTMLElement>(selector)].find((element) => element.textContent?.includes(text));
async function click(text: string) {
  const element = byText(text);
  if (!element) throw new Error(`no ${text} in: ${document.body.textContent}`);
  await act(async () => element.click());
  await settle();
}
async function type(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  localStorage.setItem("locale", "en");
  document.documentElement.lang = "en";
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  signIn(MANAGER);
  api.listBlockList.mockResolvedValue({ data: [], total: 0 });
  api.listAttempts.mockResolvedValue({ data: [], total: 0 });
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

const RULE = { id: "r1", name: "Too many", mode: "trial", action: "flag", conditions: [{ key: "pieces", op: "at_least", value: 5 }], templateKey: null, templateRule: null, matchesLastWeek: 4 };
const ATTEMPT = { wilayaId: null, communeId: null, deliveryType: null, lines: null, phoneBlocked: false, ipBlocked: false };

describe("the App page", () => {
  it("offers the Templates first, with Recommended already chosen", async () => {
    api.getProtection.mockResolvedValue({ enabled: null, rules: [] });
    api.chooseTemplate.mockResolvedValue({ enabled: true, rules: [] });
    await mount(<OrderProtectionApp canManage onSaved={onSaved} />);
    expect(byText("Recommended", "[role=radio]")!.getAttribute("aria-checked")).toBe("true");
    await click("Use this template");
    expect(api.chooseTemplate).toHaveBeenCalledWith("recommended");
    expect(onSaved).toHaveBeenCalled();
  });

  it("uses the Template the merchant picks", async () => {
    api.getProtection.mockResolvedValue({ enabled: null, rules: [] });
    api.chooseTemplate.mockResolvedValue({ enabled: true, rules: [] });
    await mount(<OrderProtectionApp canManage onSaved={onSaved} />);
    await click("Under attack");
    await click("Use this template");
    expect(api.chooseTemplate).toHaveBeenCalledWith("under_attack");
  });

  it("does not let a reader apply a Template", async () => {
    api.getProtection.mockResolvedValue({ enabled: null, rules: [] });
    await mount(<OrderProtectionApp canManage={false} onSaved={onSaved} />);
    expect(byText("Use this template")).toBeUndefined();
  });

  it("shows each rule in words, with what it would have caught", async () => {
    api.getProtection.mockResolvedValue({ enabled: true, rules: [RULE] });
    await mount(<OrderProtectionApp canManage onSaved={onSaved} />);
    expect(document.body.textContent).toContain("Too many");
    expect(document.body.textContent).toContain("Pieces in the order at least 5");
    expect(document.body.textContent).toContain("Would have flagged 4 orders in 7 days");
  });

  it("says what a Trial rule would have done, by what it does", async () => {
    api.getProtection.mockResolvedValue({ enabled: true, rules: [{ ...RULE, action: "spam", matchesLastWeek: 1 }, { ...RULE, id: "r2", action: "accept", matchesLastWeek: 2 }, { ...RULE, id: "r3", mode: "active", matchesLastWeek: 3 }] });
    await mount(<OrderProtectionApp canManage onSaved={onSaved} />);
    expect(document.body.textContent).toContain("Would have sent 1 order to Spam in 7 days");
    expect(document.body.textContent).toContain("Would have accepted 2 orders in 7 days");
    expect(document.body.textContent).toContain("Matched 3 orders in 7 days");
  });

  it("names a template rule in the reader's language, and the merchant's own as written", async () => {
    api.getProtection.mockResolvedValue({ enabled: true, rules: [{ ...RULE, name: "زبائن استلموا طلبًا", templateRule: "good_customer" }, { ...RULE, id: "r2", name: "Mes VIP", templateRule: null }] });
    await mount(<OrderProtectionApp canManage onSaved={onSaved} />);
    expect(document.body.textContent).toContain("Customers who received an order");
    expect(document.body.textContent).not.toContain("زبائن");
    expect(document.body.textContent).toContain("Mes VIP");
  });

  it("shows the Templates first, and asks before replacing the rules, saying the counts start again", async () => {
    api.getProtection.mockResolvedValue({ enabled: true, rules: [RULE] });
    api.chooseTemplate.mockResolvedValue({ enabled: true, rules: [] });
    await mount(<OrderProtectionApp canManage onSaved={onSaved} />);
    await click("Use a template");
    expect(document.querySelector("[role=alertdialog]")).toBeNull();
    await click("Cancel");
    expect(document.body.textContent).toContain("Too many");
    await click("Use a template");
    await click("Under attack");
    await click("Use this template");
    const dialog = document.querySelector<HTMLElement>("[role=alertdialog]")!;
    expect(dialog.textContent).toContain("Replace your rule?");
    expect(dialog.textContent).toContain("starts again at 0");
    expect(api.chooseTemplate).not.toHaveBeenCalled();
    await act(async () => [...dialog.querySelectorAll("button")].find((button) => button.textContent === "Replace")!.click());
    await settle();
    expect(api.chooseTemplate).toHaveBeenCalledWith("under_attack");
  });

  it("says the Block List always applies, and when each entry was added and why", async () => {
    api.getProtection.mockResolvedValue({ enabled: true, rules: [] });
    api.listBlockList.mockResolvedValue({ data: [{ id: "b", kind: "phone", value: "0551234567", note: "ORD-1", createdAt: new Date().toISOString() }], total: 1 });
    await mount(<OrderProtectionApp canManage onSaved={onSaved} />);
    await click("Block list");
    expect(document.body.textContent).toContain("Your Block List always applies");
    expect(document.body.textContent).toContain("added");
    expect(document.body.textContent).toContain("ORD-1");
  });

  it("shows who, where and how much in Activity, and opens the order from the whole row", async () => {
    api.getProtection.mockResolvedValue({ enabled: true, rules: [] });
    api.listAttempts.mockResolvedValue({ data: [{ ...ATTEMPT, id: "a", createdAt: "2026-11-09T08:00:00.000Z", phone: "0551234567", ipKey: null, outcome: "flagged", orderId: "o1", orderNumber: "ORD-1", customerName: "Amel", total: 6600, wilayaId: 16, signals: {}, matches: [{ ruleId: "r", name: "Too many", mode: "active", action: "flag" }, { ruleId: "t", name: "Trying", mode: "trial", action: "spam" }] }], total: 1 });
    await mount(<OrderProtectionApp canManage onSaved={onSaved} />);
    await click("Activity");
    const row = document.querySelector<HTMLAnchorElement>('a[href="/orders/o1"]')!;
    expect(row.textContent).toContain("Amel");
    expect(row.textContent).toContain("Alger");
    expect(row.textContent).toContain("Matched: Too many and Trying (Trial)");
  });

  it("says when a rule can no longer be read", async () => {
    api.getProtection.mockResolvedValue({ enabled: true, rules: [{ ...RULE, conditions: null }] });
    await mount(<OrderProtectionApp canManage onSaved={onSaved} />);
    expect(document.body.textContent).toContain("can no longer be read");
  });

  it("turns off without losing the rules", async () => {
    api.getProtection.mockResolvedValue({ enabled: true, rules: [RULE] });
    api.setProtectionEnabled.mockResolvedValue({ enabled: false });
    await mount(<OrderProtectionApp canManage onSaved={onSaved} />);
    await act(async () => document.querySelector<HTMLElement>("[role=switch]")!.click());
    await settle();
    expect(api.setProtectionEnabled).toHaveBeenCalledWith(false);
    expect(document.body.textContent).toContain("Too many");
  });
});

describe("the rule builder", () => {
  const nameInput = () => document.querySelector<HTMLInputElement>("input:not([type=number])")!;

  beforeEach(() => {
    window.history.replaceState(null, "", "/apps/order-protection/rule");
  });

  it("builds a rule from the catalogue and saves it", async () => {
    api.createRule.mockResolvedValue({});
    await mount(<RulePageApp />);
    await type(nameInput(), "Blocked");
    await click("Add a condition");
    expect(document.body.textContent).toContain("Who is ordering, and how");
    await click("Phone number");
    expect(byText("is on the Block List", "option")).toBeUndefined();
    await type(document.querySelector("textarea")!, "0551234567");
    await click("To Spam");
    await click("Save");
    expect(api.createRule).toHaveBeenCalledWith({ name: "Blocked", mode: "trial", action: "spam", conditions: [{ key: "phone", op: "one_of", value: ["0551234567"] }] });
  });

  it("offers the fixed choices of a Condition as boxes to tick", async () => {
    api.createRule.mockResolvedValue({});
    await mount(<RulePageApp />);
    await type(nameInput(), "From apps");
    await click("Add a condition");
    await click("App the store was opened in");
    for (const box of ["Facebook", "TikTok", "Normal browser", "Normal browser"]) {
      await act(async () => byText(box, "label")!.querySelector("input")!.click());
    }
    await click("Flag as suspicious");
    await click("Save");
    expect(api.createRule).toHaveBeenCalledWith({ name: "From apps", mode: "trial", action: "flag", conditions: [{ key: "app_source", op: "one_of", value: ["facebook", "tiktok"] }] });
  });

  it("starts the form-speed Condition at a sensible number", async () => {
    await mount(<RulePageApp />);
    await click("Add a condition");
    await click("Time to fill the form (seconds)");
    expect(document.querySelector<HTMLInputElement>('input[type="number"]')!.value).toBe("5");
  });

  it("picks countries by name, and keeps their codes", async () => {
    window.history.replaceState(null, "", "/apps/order-protection/rule?id=r1");
    api.getProtection.mockResolvedValue({ enabled: true, rules: [{ ...RULE, conditions: [{ key: "network_country", op: "not_one_of", value: ["DZ"] }] }] });
    api.updateRule.mockResolvedValue({});
    await mount(<RulePageApp />);
    expect(document.querySelector("textarea")).toBeNull();
    expect(document.body.textContent).toContain("Algeria");
    await click("Save");
    expect(api.updateRule).toHaveBeenCalledWith("r1", { name: "Too many", mode: "trial", action: "flag", conditions: [{ key: "network_country", op: "not_one_of", value: ["DZ"] }] });
  });

  it("explains each mode and each action where they are chosen", async () => {
    await mount(<RulePageApp />);
    expect(document.body.textContent).toContain("Watches only");
    expect(document.body.textContent).toContain("You can rescue it from Spam");
    await click("Active");
    await type(nameInput(), "R");
    await click("Add a condition");
    await click("Pieces in the order");
    await click("Flag as suspicious");
    api.createRule.mockResolvedValue({});
    await click("Save");
    expect(api.createRule).toHaveBeenCalledWith(expect.objectContaining({ mode: "active" }));
  });

  it("says when a rule holds as many conditions as it can", async () => {
    await mount(<RulePageApp />);
    for (let i = 0; i < 5; i += 1) {
      await click("Add a condition");
      await click("Pieces in the order");
    }
    expect(byText("Add a condition")).toBeUndefined();
    expect(document.body.textContent).toContain("A rule can have up to 5 conditions.");
  });

  it("deletes a rule from its own page", async () => {
    window.history.replaceState(null, "", "/apps/order-protection/rule?id=r1");
    api.getProtection.mockResolvedValue({ enabled: true, rules: [RULE] });
    api.deleteRule.mockResolvedValue({});
    await mount(<RulePageApp />);
    await click("Delete rule");
    const dialog = document.querySelector<HTMLElement>("[role=alertdialog]")!;
    await act(async () => [...dialog.querySelectorAll("button")].find((button) => button.textContent === "Delete rule")!.click());
    await settle();
    expect(api.deleteRule).toHaveBeenCalledWith("r1");
  });

  it("opens a rule with its boxes ticked", async () => {
    window.history.replaceState(null, "", "/apps/order-protection/rule?id=r2");
    api.getProtection.mockResolvedValue({ enabled: true, rules: [{ ...RULE, id: "r2", conditions: [{ key: "visit_source", op: "one_of", value: ["tiktok"] }] }] });
    api.updateRule.mockResolvedValue({});
    await mount(<RulePageApp />);
    expect(byText("TikTok ad", "label")!.querySelector("input")!.checked).toBe(true);
    expect(byText("Meta ad", "label")!.querySelector("input")!.checked).toBe(false);
  });

  it("says what is missing, and saves nothing", async () => {
    await mount(<RulePageApp />);
    await type(nameInput(), "Blocked");
    await click("Save");
    expect(document.body.textContent).toContain("Choose what the rule does with the order.");
    expect(document.querySelectorAll("[role=alert]")).toHaveLength(1);
    await click("To Spam");
    await click("Save");
    expect(document.body.textContent).toContain("Add at least one condition");
    expect(document.body.textContent).not.toContain("Choose what the rule does with the order.");
    expect(api.createRule).not.toHaveBeenCalled();
  });

  it("opens a saved rule with what it holds, and saves over it", async () => {
    window.history.replaceState(null, "", "/apps/order-protection/rule?id=r1");
    api.getProtection.mockResolvedValue({ enabled: true, rules: [RULE] });
    api.updateRule.mockResolvedValue({});
    await mount(<RulePageApp />);
    expect(nameInput().value).toBe("Too many");
    expect(document.querySelector<HTMLInputElement>("input[type=number]")!.value).toBe("5");
    await click("Save");
    expect(api.updateRule).toHaveBeenCalledWith("r1", { name: "Too many", mode: "trial", action: "flag", conditions: [{ key: "pieces", op: "at_least", value: 5 }] });
  });

  it("lets a reader look but not change", async () => {
    signIn(READER);
    window.history.replaceState(null, "", "/apps/order-protection/rule?id=r1");
    api.getProtection.mockResolvedValue({ enabled: true, rules: [RULE] });
    await mount(<RulePageApp />);
    expect(nameInput().disabled).toBe(true);
    expect(byText("Add a condition")).toBeUndefined();
  });
});

describe("a rule in words", () => {
  it("names the fixed choices it holds", async () => {
    api.getProtection.mockResolvedValue({ enabled: true, rules: [{ ...RULE, conditions: [{ key: "app_source", op: "one_of", value: ["facebook", "browser"] }] }] });
    await mount(<OrderProtectionApp canManage onSaved={onSaved} />);
    expect(document.body.textContent).toContain("App the store was opened in is one of Facebook or Normal browser");
    expect(document.body.textContent).not.toContain("،");
  });
});

describe("the Spam page", () => {
  const SPAM = { ...ATTEMPT, id: "s1", createdAt: "2026-11-09T08:00:00.000Z", phone: "0551234567", ipKey: "41.100.1.1", outcome: "spam", orderId: null, orderNumber: "ORD-1", customerName: "Amel", total: 6600, signals: {}, matches: [{ ruleId: "r", name: "Blocked", mode: "active", action: "spam" }, { ruleId: "t", name: "Only trying", mode: "trial", action: "spam" }] };

  it("shows who, how much and why, naming only the rules that acted", async () => {
    api.listAttempts.mockResolvedValue({ data: [SPAM], total: 1 });
    await mount(<SpamOrdersPageApp />);
    expect(api.listAttempts).toHaveBeenCalledWith({ outcome: "spam", limit: 20, offset: 0 });
    expect(document.body.textContent).toContain("Amel");
    expect(document.body.textContent).toContain("Sent to Spam by: Blocked");
    expect(document.body.textContent).not.toContain("Only trying");
  });

  it("shows what was ordered, where to and how, and what else matched", async () => {
    api.listAttempts.mockResolvedValue({ data: [{ ...SPAM, wilayaId: 16, communeId: "c-16-055", deliveryType: "stop_desk", lines: [{ name: "Robe", variantLabel: "Rouge", quantity: 2 }, { name: "Sac", variantLabel: null, quantity: 1 }], phoneBlocked: true, matches: [{ ruleId: "block-list:phone", name: "Block List", mode: "active", action: "spam", blockList: "phone" }, { ruleId: "f", name: "Fast", mode: "active", action: "flag" }] }], total: 1 });
    await mount(<SpamOrdersPageApp />);
    const text = document.body.textContent!;
    expect(text).toContain("Robe (Rouge) × 2 and Sac × 1");
    expect(text).toContain("Alger · Baba Hassen · Stop desk");
    expect(text).toContain("Sent to Spam by: Number on your Block List");
    expect(text).toContain("Also matched: Fast");
    expect(text).toContain("Number blocked");
    expect(byText("Block number")).toBeUndefined();
  });

  it("deletes or blocks several at once", async () => {
    api.listAttempts.mockResolvedValue({ data: [SPAM, { ...SPAM, id: "s2", phone: "0661111111", orderNumber: "ORD-2" }], total: 2 });
    api.addToBlockList.mockResolvedValue({});
    api.deleteSpamOrder.mockResolvedValue({});
    await mount(<SpamOrdersPageApp />);
    await act(async () => byText("Select all", "label")!.querySelector("input")!.click());
    await settle();
    expect(document.body.textContent).toContain("2 selected");
    await click("Block numbers");
    expect(api.addToBlockList).toHaveBeenCalledWith({ kind: "phone", value: "0551234567", note: "ORD-1" });
    expect(api.addToBlockList).toHaveBeenCalledWith({ kind: "phone", value: "0661111111", note: "ORD-2" });
    expect(document.body.textContent).toContain("2 selected");
    await click("Delete");
    const dialog = document.querySelector<HTMLElement>("[role=alertdialog]")!;
    expect(dialog.textContent).toContain("Delete 2 orders?");
    await act(async () => [...dialog.querySelectorAll("button")].find((button) => button.textContent === "Delete")!.click());
    await settle();
    expect(api.deleteSpamOrder).toHaveBeenCalledWith("s1");
    expect(api.deleteSpamOrder).toHaveBeenCalledWith("s2");
  });

  it("shows how the order was sent", async () => {
    api.listAttempts.mockResolvedValue({ data: [{ ...SPAM, signals: { fillSeconds: 3.4, visitSource: "tiktok", appSource: "instagram", networkCountry: "DZ" } }], total: 1 });
    await mount(<SpamOrdersPageApp />);
    expect(document.body.textContent).toContain("Instagram · TikTok ad · Filled in 3 s · Network: Algeria");
  });

  it("shows a form filled in no time, and no empty line when nothing is known", async () => {
    api.listAttempts.mockResolvedValue({ data: [{ ...SPAM, id: "known", signals: { fillSeconds: 0 } }, { ...SPAM, id: "unknown", signals: {} }], total: 2 });
    await mount(<SpamOrdersPageApp />);
    expect(document.body.textContent).toContain("Filled in 0 s");
    expect(document.querySelectorAll("li p.text-xs")).toHaveLength(3);
  });

  it("rescues and reloads", async () => {
    api.listAttempts.mockResolvedValue({ data: [SPAM], total: 1 });
    api.rescueSpamOrder.mockResolvedValue({ orderId: "o", orderNumber: "ORD-1" });
    await mount(<SpamOrdersPageApp />);
    await click("Rescue");
    expect(api.rescueSpamOrder).toHaveBeenCalledWith("s1");
    expect(notifications.success).toHaveBeenCalled();
    expect(api.listAttempts).toHaveBeenCalledTimes(2);
  });

  it("says why a Rescue was refused", async () => {
    api.listAttempts.mockResolvedValue({ data: [SPAM], total: 1 });
    api.rescueSpamOrder.mockRejectedValue({ code: "INSUFFICIENT_STOCK" });
    await mount(<SpamOrdersPageApp />);
    await click("Rescue");
    expect(notifications.error).toHaveBeenCalledWith("Not enough stock to place this order.");
  });

  it("blocks the number", async () => {
    api.listAttempts.mockResolvedValue({ data: [SPAM], total: 1 });
    api.addToBlockList.mockResolvedValue({});
    await mount(<SpamOrdersPageApp />);
    await click("Block number");
    expect(api.addToBlockList).toHaveBeenCalledWith({ kind: "phone", value: "0551234567", note: "ORD-1" });
  });

  it("offers no action to a reader, and nothing at all without permission", async () => {
    signIn(READER);
    api.listAttempts.mockResolvedValue({ data: [SPAM], total: 1 });
    await mount(<SpamOrdersPageApp />);
    expect(document.body.textContent).toContain("Amel");
    expect(byText("Rescue")).toBeUndefined();
    await act(async () => root.unmount());
    root = createRoot(host);
    api.listAttempts.mockClear();
    signIn(member(["orders:read"]));
    await mount(<SpamOrdersPageApp />);
    expect(api.listAttempts).not.toHaveBeenCalled();
  });
});

describe("the card on an order", () => {
  const FLAGGED = { ...ATTEMPT, id: "a", createdAt: "2026-11-09T08:00:00.000Z", phone: "0551234567", ipKey: "41.100.1.1", outcome: "flagged", orderId: "o", orderNumber: "ORD-1", customerName: null, total: null, signals: {}, matches: [{ ruleId: "r", name: "Too many", mode: "active", action: "flag" }, { ruleId: "t", name: "Only trying", mode: "trial", action: "spam" }] };

  it("says why it was flagged and blocks the number or network", async () => {
    api.attemptOfOrder.mockResolvedValue({ ...FLAGGED, signals: { appSource: "browser" } });
    api.addToBlockList.mockResolvedValue({});
    await mount(<RequireAuth><OrderProtectionCard orderId="o" /></RequireAuth>);
    expect(document.body.textContent).toContain("Flagged because of: Too many");
    expect(document.body.textContent).toContain("Normal browser");
    expect(document.body.textContent).not.toContain("Only trying");
    await click("Block this number");
    expect(api.addToBlockList).toHaveBeenCalledWith({ kind: "phone", value: "0551234567", note: "ORD-1" });
    await click("Block this network");
    const dialog = document.querySelector<HTMLElement>("[role=alertdialog]")!;
    expect(dialog.textContent).toContain("share one network address");
    expect(api.addToBlockList).toHaveBeenCalledTimes(1);
    await act(async () => [...dialog.querySelectorAll("button")].find((button) => button.textContent === "Block this network")!.click());
    await settle();
    expect(api.addToBlockList).toHaveBeenCalledWith({ kind: "ip", value: "41.100.1.1", note: "ORD-1" });
  });

  it("shows nothing for an order the App did not screen, or without permission", async () => {
    api.attemptOfOrder.mockResolvedValue(null);
    await mount(<RequireAuth><OrderProtectionCard orderId="o" /></RequireAuth>);
    expect(host.textContent).toBe("");
    await act(async () => root.unmount());
    root = createRoot(host);
    api.attemptOfOrder.mockClear();
    signIn(member(["orders:read"]));
    await mount(<RequireAuth><OrderProtectionCard orderId="o" /></RequireAuth>);
    expect(api.attemptOfOrder).not.toHaveBeenCalled();
  });
});
