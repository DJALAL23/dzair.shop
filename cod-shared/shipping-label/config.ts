/**
 * Shipping labels — a store's settings for the labels it prints for its own
 * drivers. A carrier prints its own label; the store's driver is not a
 * carrier, so CodFlow draws that label from the order, the store's identity
 * and these settings.
 *
 * Stored as one JSON blob on `stores.shipping_label_json`, like the checkout
 * form and the WhatsApp widget, and with the same two paths: a LENIENT read
 * that never throws (a blob written by a newer deploy, or by hand, still
 * prints — unknown keys are ignored, an unreadable value falls back to its
 * default) and a STRICT write that refuses what it cannot store, every
 * problem at once. The default is stored as NULL, so "never set" and "set
 * back to the defaults" are the same row and the rollback is one UPDATE.
 *
 * No zod: cod-shared declares one dependency (drizzle-orm).
 */

/** The language of the label's own words (the order's details print as written). */
export const LABEL_LANGUAGES = ["fr", "ar"] as const;
export type LabelLanguage = (typeof LABEL_LANGUAGES)[number];

/** The physical label. One size for now: the 4×6 inch roll of thermal printers. */
export const LABEL_SIZES = ["100x150"] as const;
export type LabelSize = (typeof LABEL_SIZES)[number];

/** Whether the customer may open the parcel before paying — printed only when the store says. */
export const OPEN_PARCEL_POLICIES = ["unset", "allowed", "forbidden"] as const;
export type OpenParcelPolicy = (typeof OPEN_PARCEL_POLICIES)[number];

export const LABEL_LIMITS = { FOOTER_MAX: 120, PHONE_MAX: 20 } as const;

export interface ShippingLabelConfig {
  size: LabelSize;
  language: LabelLanguage;
  /** The store's logo at the top of the label. */
  showLogo: boolean;
  /** The number printed for the sender; null prints the contact phone of the store's legal profile. */
  senderPhone: string | null;
  /** What is in the parcel: each line's quantity, name and variant. */
  showItems: boolean;
  /** The order's notes, for the driver. */
  showNotes: boolean;
  openParcel: OpenParcelPolicy;
  /** A line of the merchant's own at the bottom of the label. */
  footer: string | null;
}

export const DEFAULT_SHIPPING_LABEL_CONFIG: ShippingLabelConfig = Object.freeze({
  size: "100x150",
  language: "fr",
  showLogo: true,
  senderPhone: null,
  showItems: true,
  showNotes: true,
  openParcel: "unset",
  footer: null,
});

const KEYS = Object.keys(DEFAULT_SHIPPING_LABEL_CONFIG) as Array<keyof ShippingLabelConfig>;

/** A printable phone: digits, spaces, an optional leading +. Landlines included — a shop's number need not be a mobile. */
const PHONE = /^\+?\d[\d ]{5,}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readText(raw: unknown, max: number): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

function readChoice<T extends string>(raw: unknown, allowed: readonly T[], fallback: T): T {
  return typeof raw === "string" && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
}

const readFlag = (raw: unknown, fallback: boolean) => (typeof raw === "boolean" ? raw : fallback);

function readPhone(raw: unknown): string | null {
  const value = readText(raw, LABEL_LIMITS.PHONE_MAX);
  return value && PHONE.test(value) ? value : null;
}

/** A stored blob as settings. Never throws. */
export function parseShippingLabelConfig(json: string | null | undefined): ShippingLabelConfig {
  if (typeof json !== "string" || !json.trim()) return DEFAULT_SHIPPING_LABEL_CONFIG;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return DEFAULT_SHIPPING_LABEL_CONFIG;
  }
  if (!isRecord(raw)) return DEFAULT_SHIPPING_LABEL_CONFIG;
  const d = DEFAULT_SHIPPING_LABEL_CONFIG;
  return {
    size: readChoice(raw.size, LABEL_SIZES, d.size),
    language: readChoice(raw.language, LABEL_LANGUAGES, d.language),
    showLogo: readFlag(raw.showLogo, d.showLogo),
    senderPhone: readPhone(raw.senderPhone),
    showItems: readFlag(raw.showItems, d.showItems),
    showNotes: readFlag(raw.showNotes, d.showNotes),
    openParcel: readChoice(raw.openParcel, OPEN_PARCEL_POLICIES, d.openParcel),
    footer: readText(raw.footer, LABEL_LIMITS.FOOTER_MAX),
  };
}

export function isDefaultShippingLabelConfig(config: ShippingLabelConfig): boolean {
  return KEYS.every((key) => config[key] === DEFAULT_SHIPPING_LABEL_CONFIG[key]);
}

/** Canonical JSON for storage: keys in one order, so saving the same settings writes the same text. */
export function serializeShippingLabelConfig(config: ShippingLabelConfig): string {
  return JSON.stringify(Object.fromEntries(KEYS.map((key) => [key, config[key]])));
}

export type LabelIssueCode = "NOT_AN_OBJECT" | "UNKNOWN_KEY" | "INVALID_FIELD" | "INVALID_CHOICE" | "INVALID_PHONE" | "TEXT_TOO_LONG";

export interface LabelIssue {
  /** The key in the submitted document. */
  path: string;
  code: LabelIssueCode;
  /** Developer-facing English; the dashboard words each code itself. */
  message: string;
}

export type LabelValidation = { ok: true; config: ShippingLabelConfig } | { ok: false; issues: LabelIssue[] };

/**
 * Settings a merchant submitted, as they will be stored — or every problem
 * with them. Keys left out keep their defaults; empty texts are none.
 */
export function validateShippingLabelInput(input: unknown): LabelValidation {
  if (!isRecord(input)) return { ok: false, issues: [{ path: "", code: "NOT_AN_OBJECT", message: "Label settings must be an object" }] };
  const issues: LabelIssue[] = [];
  const issue = (path: string, code: LabelIssueCode, message: string) => issues.push({ path, code, message });
  for (const key of Object.keys(input)) {
    if (!(KEYS as string[]).includes(key)) issue(key, "UNKNOWN_KEY", `Unknown setting "${key}"`);
  }

  const config: ShippingLabelConfig = { ...DEFAULT_SHIPPING_LABEL_CONFIG };
  const choice = <K extends "size" | "language" | "openParcel">(key: K, allowed: readonly ShippingLabelConfig[K][]) => {
    const value = input[key];
    if (value === undefined) return;
    if (typeof value === "string" && (allowed as readonly string[]).includes(value)) config[key] = value as ShippingLabelConfig[K];
    else issue(key, "INVALID_CHOICE", `${key} must be one of ${allowed.join(", ")}`);
  };
  const flag = (key: "showLogo" | "showItems" | "showNotes") => {
    const value = input[key];
    if (value === undefined) return;
    if (typeof value === "boolean") config[key] = value;
    else issue(key, "INVALID_FIELD", `${key} must be true or false`);
  };
  const text = (key: "senderPhone" | "footer", max: number) => {
    const value = input[key];
    if (value === undefined || value === null) return null;
    if (typeof value !== "string") {
      issue(key, "INVALID_FIELD", `${key} must be text`);
      return null;
    }
    const trimmed = value.trim();
    if (trimmed.length > max) {
      issue(key, "TEXT_TOO_LONG", `${key} is longer than ${max} characters`);
      return null;
    }
    return trimmed || null;
  };

  choice("size", LABEL_SIZES);
  choice("language", LABEL_LANGUAGES);
  flag("showLogo");
  const phone = text("senderPhone", LABEL_LIMITS.PHONE_MAX);
  if (phone !== null) {
    if (PHONE.test(phone)) config.senderPhone = phone;
    else issue("senderPhone", "INVALID_PHONE", "senderPhone must be a phone number");
  }
  flag("showItems");
  flag("showNotes");
  choice("openParcel", OPEN_PARCEL_POLICIES);
  config.footer = text("footer", LABEL_LIMITS.FOOTER_MAX);

  return issues.length ? { ok: false, issues } : { ok: true, config };
}
