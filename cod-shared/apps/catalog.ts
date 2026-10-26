/**
 * The Apps a store can have (Apps context, ADR 0019): the one place an App is
 * described. Adding an App is one entry here, its routes and its page body.
 */

import { SCOPES } from "../rbac/scopes";
import { WEBHOOK_KIND } from "../events/webhooks";

export const APP_CATEGORIES = ["marketing", "checkout_protection", "messaging", "storefront"] as const;
export type AppCategory = (typeof APP_CATEGORIES)[number];

export const CONNECTION_POINTS = ["checkout_check", "storefront_add_on", "consumer_kind", "email_sender", "api"] as const;
export type ConnectionPoint = (typeof CONNECTION_POINTS)[number];

export interface Permissions {
  read: string;
  manage: string;
}

export interface App {
  key: string;
  category: AppCategory;
  connectionPoints: readonly ConnectionPoint[];
  permissions: Permissions;
  /** The Consumer Kinds whose Built-in Consumers this App creates and keeps. */
  consumerKinds: readonly string[];
}

export const APP_CATALOG = [
  {
    key: "meta",
    category: "marketing",
    connectionPoints: ["storefront_add_on", "consumer_kind"],
    permissions: { read: SCOPES.META_READ, manage: SCOPES.META_MANAGE },
    consumerKinds: ["meta_capi"],
  },
  {
    key: "dzverify",
    category: "checkout_protection",
    connectionPoints: ["checkout_check"],
    permissions: { read: SCOPES.DZVERIFY_READ, manage: SCOPES.DZVERIFY_MANAGE },
    consumerKinds: [],
  },
  {
    key: "turnstile",
    category: "checkout_protection",
    connectionPoints: ["checkout_check", "storefront_add_on"],
    permissions: { read: SCOPES.TURNSTILE_READ, manage: SCOPES.TURNSTILE_MANAGE },
    consumerKinds: [],
  },
  {
    key: "sendili",
    category: "messaging",
    connectionPoints: ["email_sender"],
    permissions: { read: SCOPES.SENDILI_READ, manage: SCOPES.SENDILI_MANAGE },
    consumerKinds: [],
  },
  {
    key: "whatsapp-button",
    category: "storefront",
    connectionPoints: ["storefront_add_on"],
    permissions: { read: SCOPES.WHATSAPP_BUTTON_READ, manage: SCOPES.WHATSAPP_BUTTON_MANAGE },
    consumerKinds: [],
  },
] as const satisfies readonly App[];

export type AppKey = (typeof APP_CATALOG)[number]["key"];

export const APP_KEYS: readonly AppKey[] = APP_CATALOG.map((app) => app.key);

export function isAppKey(value: string): value is AppKey {
  return (APP_KEYS as readonly string[]).includes(value);
}

export function appOf(key: AppKey): App {
  return APP_CATALOG.find((app) => app.key === key)!;
}

/** The merchant's own systems: their webhooks (and their API key, which no Consumer is). */
export const INTEGRATIONS = {
  permissions: { read: SCOPES.INTEGRATIONS_READ, manage: SCOPES.INTEGRATIONS_MANAGE },
  consumerKinds: [WEBHOOK_KIND],
} as const;

export type ConsumerOwner = AppKey | "integrations";

/** Whose Consumers a kind makes: the App that keeps them, or the merchant's Integrations. */
export function consumerOwner(kind: string): ConsumerOwner | null {
  if ((INTEGRATIONS.consumerKinds as readonly string[]).includes(kind)) return "integrations";
  return APP_CATALOG.find((app) => (app.consumerKinds as readonly string[]).includes(kind))?.key ?? null;
}

/** The permissions a Consumer of this kind is seen and steered with: its owner's. */
export function consumerPermissions(kind: string): Permissions | null {
  const owner = consumerOwner(kind);
  if (owner === null) return null;
  return owner === "integrations" ? INTEGRATIONS.permissions : appOf(owner).permissions;
}
