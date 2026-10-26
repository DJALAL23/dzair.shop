/**
 * The Apps a store can have (Apps context, ADR 0019): the one place an App is
 * described. Adding an App is one entry here, its routes and its page body.
 */

import { SCOPES } from "../rbac/scopes";
import { hasPermission } from "../rbac/utils";
import { WEBHOOK_KIND } from "../events/webhooks";
import { TELEGRAM_KIND } from "../events/telegram";

export const APP_CATEGORIES = ["marketing", "checkout_protection", "messaging", "storefront"] as const;
export type AppCategory = (typeof APP_CATEGORIES)[number];

export interface Permissions {
  read: string;
  manage: string;
}

export interface App {
  key: string;
  category: AppCategory;
  permissions: Permissions;
  /** The Consumer Kinds whose Built-in Consumers this App creates and keeps. */
  consumerKinds: readonly string[];
}

export const APP_CATALOG = [
  {
    key: "meta",
    category: "marketing",
    permissions: { read: SCOPES.META_READ, manage: SCOPES.META_MANAGE },
    consumerKinds: ["meta_capi"],
  },
  {
    key: "dzverify",
    category: "checkout_protection",
    permissions: { read: SCOPES.DZVERIFY_READ, manage: SCOPES.DZVERIFY_MANAGE },
    consumerKinds: [],
  },
  {
    key: "turnstile",
    category: "checkout_protection",
    permissions: { read: SCOPES.TURNSTILE_READ, manage: SCOPES.TURNSTILE_MANAGE },
    consumerKinds: [],
  },
  {
    key: "sendili",
    category: "messaging",
    permissions: { read: SCOPES.SENDILI_READ, manage: SCOPES.SENDILI_MANAGE },
    consumerKinds: [],
  },
  {
    key: "whatsapp-button",
    category: "storefront",
    permissions: { read: SCOPES.WHATSAPP_BUTTON_READ, manage: SCOPES.WHATSAPP_BUTTON_MANAGE },
    consumerKinds: [],
  },
  {
    key: "telegram",
    category: "messaging",
    permissions: { read: SCOPES.TELEGRAM_READ, manage: SCOPES.TELEGRAM_MANAGE },
    consumerKinds: [TELEGRAM_KIND],
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

/** May someone holding these permissions see (read) or steer (manage) a Consumer of this kind? */
export function mayConsumer(scopes: readonly string[], kind: string, level: keyof Permissions): boolean {
  const permissions = consumerPermissions(kind);
  return permissions !== null && hasPermission([...scopes], permissions[level]);
}

const OWNERS: readonly { permissions: Permissions; consumerKinds: readonly string[] }[] = [
  INTEGRATIONS,
  ...APP_CATALOG.filter((app) => app.consumerKinds.length > 0),
];

/** Every permission that sees (read) or steers (manage) some Consumer: its owners'. */
export function consumerOwnerPermissions(level: keyof Permissions): string[] {
  return OWNERS.map((owner) => owner.permissions[level]);
}

/** The Consumer Kinds whose Consumers someone holding these permissions may see or steer. */
export function consumerKindsFor(scopes: readonly string[], level: keyof Permissions): string[] {
  return OWNERS.flatMap((owner) => owner.consumerKinds).filter((kind) => mayConsumer(scopes, kind, level));
}
