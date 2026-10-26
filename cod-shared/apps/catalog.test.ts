import { describe, expect, it } from "vitest";
import { ALL_SCOPES, SCOPE_CATEGORIES } from "../rbac/scopes";
import { APP_CATALOG, APP_KEYS, appOf, consumerOwner, consumerPermissions, INTEGRATIONS, isAppKey } from "./catalog";

describe("the App catalog", () => {
  it("keys every App by lowercase words joined by hyphens, once", () => {
    expect(APP_KEYS).toEqual(["meta", "dzverify", "turnstile", "sendili", "whatsapp-button", "telegram"]);
    for (const key of APP_KEYS) expect(key).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(new Set(APP_KEYS).size).toBe(APP_KEYS.length);
  });

  it("names each App's permissions after its key, and declares them", () => {
    for (const app of APP_CATALOG) {
      expect(app.permissions).toEqual({ read: `${app.key}:read`, manage: `${app.key}:manage` });
      expect(ALL_SCOPES).toContain(app.permissions.read);
      expect(ALL_SCOPES).toContain(app.permissions.manage);
    }
    expect(ALL_SCOPES).toContain(INTEGRATIONS.permissions.read);
    expect(ALL_SCOPES).toContain(INTEGRATIONS.permissions.manage);
  });

  it("groups the Apps' and the Integrations' permissions on the Team page, and every permission once", () => {
    expect(SCOPE_CATEGORIES.apps.scopes).toEqual(APP_CATALOG.flatMap((app) => [app.permissions.read, app.permissions.manage]));
    expect(SCOPE_CATEGORIES.integrations.scopes).toEqual([INTEGRATIONS.permissions.read, INTEGRATIONS.permissions.manage]);
    const grouped = Object.values(SCOPE_CATEGORIES).flatMap((category) => [...category.scopes]);
    expect([...grouped].sort()).toEqual([...ALL_SCOPES].sort());
  });

  it("tells an App Key from anything else", () => {
    expect(isAppKey("whatsapp-button")).toBe(true);
    expect(isAppKey("whatsapp_widget")).toBe(false);
    expect(isAppKey("acme.crm")).toBe(false);
    expect(appOf("sendili").category).toBe("messaging");
  });
});

describe("whose Consumers a kind makes", () => {
  it("gives webhooks to Integrations, Meta conversions to the Meta App and Telegram chats to the Telegram App", () => {
    expect(consumerOwner("webhook")).toBe("integrations");
    expect(consumerOwner("meta_capi")).toBe("meta");
    expect(consumerOwner("telegram")).toBe("telegram");
    expect(consumerOwner("email")).toBeNull();
  });

  it("gives every kind one owner at most", () => {
    const kinds = [...INTEGRATIONS.consumerKinds, ...APP_CATALOG.flatMap((app) => app.consumerKinds)];
    expect(new Set(kinds).size).toBe(kinds.length);
  });

  it("steers a Consumer with its owner's permissions", () => {
    expect(consumerPermissions("webhook")).toEqual({ read: "integrations:read", manage: "integrations:manage" });
    expect(consumerPermissions("meta_capi")).toEqual({ read: "meta:read", manage: "meta:manage" });
    expect(consumerPermissions("telegram")).toEqual({ read: "telegram:read", manage: "telegram:manage" });
    expect(consumerPermissions("email")).toBeNull();
  });
});
