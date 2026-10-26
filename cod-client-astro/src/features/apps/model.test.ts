import { describe, expect, it } from "vitest";
import { APP_CATEGORIES, APP_KEYS } from "../../../../cod-shared/apps/catalog";
import { APP_STATUSES } from "../../../../cod-shared/queries/apps";
import { appAccess, appsByCategory, canRemove, mayReadAnApp, STATUS_TONES } from "./model";
import { APP_REGISTRY } from "./registry";
import type { AppSummary } from "./types";

const holding = (...scopes: string[]) => (scope: string) => scopes.includes(scope);

describe("the Apps page's sections", () => {
  it("groups the Apps by category in catalog order, leaving out a category with none to show", () => {
    const apps: AppSummary[] = [
      { key: "whatsapp-button", category: "storefront", status: "on" },
      { key: "meta", category: "marketing", status: "off" },
      { key: "turnstile", category: "checkout_protection", status: "not_set_up" },
      { key: "dzverify", category: "checkout_protection", status: "needs_attention" },
    ];
    expect(appsByCategory(apps).map(({ category, apps: listed }) => [category, listed.map((app) => app.key)])).toEqual([
      ["marketing", ["meta"]],
      ["checkout_protection", ["turnstile", "dzverify"]],
      ["storefront", ["whatsapp-button"]],
    ]);
    expect(appsByCategory([])).toEqual([]);
  });
});

describe("who may do what with an App", () => {
  it("reads and manages an App with its own permissions only", () => {
    expect(appAccess("sendili", holding("sendili:read"))).toEqual({ read: true, manage: false });
    expect(appAccess("sendili", holding("sendili:manage"))).toEqual({ read: false, manage: true });
    expect(appAccess("sendili", holding("settings:email", "dzverify:manage"))).toEqual({ read: false, manage: false });
    expect(appAccess("whatsapp-button", holding("whatsapp-button:read", "whatsapp-button:manage"))).toEqual({ read: true, manage: true });
  });

  it("opens the Apps page to whoever may see one App, and to nobody else", () => {
    expect(mayReadAnApp(holding("turnstile:read"))).toBe(true);
    expect(mayReadAnApp(holding("orders:read", "meta:manage", "integrations:read", "whatsapp_widget:read"))).toBe(false);
  });

  it("offers removal only once there is a setup to forget", () => {
    expect(canRemove(null)).toBe(false);
    expect(canRemove("not_set_up")).toBe(false);
    for (const status of ["on", "off", "needs_attention"] as const) expect(canRemove(status)).toBe(true);
  });
});

describe("every App", () => {
  it("has a page body and a mark, and every status a tone", () => {
    expect(Object.keys(APP_REGISTRY).sort()).toEqual([...APP_KEYS].sort());
    expect(Object.keys(STATUS_TONES).sort()).toEqual([...APP_STATUSES].sort());
    expect(STATUS_TONES.needs_attention).toBe("warning");
    expect(STATUS_TONES.on).toBe("success");
    expect(APP_CATEGORIES.length).toBeGreaterThan(0);
  });
});
