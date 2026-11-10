import { toLocalAlgerianMobile } from "../lib/phone";

export const ORDER_ATTEMPT_OUTCOMES = ["accepted", "flagged", "spam", "rescued"] as const;
export type OrderAttemptOutcome = (typeof ORDER_ATTEMPT_OUTCOMES)[number];

export const BLOCK_LIST_KINDS = ["phone", "ip"] as const;
export type BlockListKind = (typeof BLOCK_LIST_KINDS)[number];

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function ipv4Key(raw: string): string | null {
  const parts = IPV4.exec(raw);
  if (!parts) return null;
  const octets = parts.slice(1).map(Number);
  return octets.every((octet) => octet <= 255) ? octets.join(".") : null;
}

/** The eight groups of an IPv6 address, or null when it is not one. */
function ipv6Groups(raw: string): number[] | null {
  const halves = raw.split("::");
  if (halves.length > 2) return null;
  const side = (part: string | undefined) => (part ? part.split(":") : []);
  const left = side(halves[0]);
  const right = side(halves[1]);
  const missing = 8 - left.length - right.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...left, ...Array<string>(halves.length === 1 ? 0 : missing).fill("0"), ...right];
  if (!groups.every((group) => /^[0-9a-f]{1,4}$/i.test(group))) return null;
  return groups.map((group) => parseInt(group, 16));
}

/**
 * What identifies a network: an IPv4 address whole, the first 64 bits of an
 * IPv6 address (the rest changes on one phone). Null when it is neither.
 */
export function ipKey(raw: string): string | null {
  const address = raw.trim().toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(address);
  if (mapped) return ipv4Key(mapped[1]);
  if (!address.includes(":")) return ipv4Key(address);
  const groups = ipv6Groups(address);
  return groups ? `${groups.slice(0, 4).map((group) => group.toString(16)).join(":")}::/64` : null;
}

/** A phone in the form orders keep it, or null when it cannot be one. */
export function phoneKey(raw: string): string | null {
  const text = raw.trim();
  return toLocalAlgerianMobile(text) ?? (/^\+?\d{6,15}$/.test(text) ? text : null);
}

/** A Block List value in the form it is compared in, or null when it cannot be one. */
export function blockListValue(kind: BlockListKind, raw: string): string | null {
  return kind === "phone" ? phoneKey(raw) : ipKey(raw);
}

export const VISIT_SOURCES = ["meta", "tiktok", "google", "other"] as const;
export type VisitSource = (typeof VISIT_SOURCES)[number];

export const APP_SOURCES = ["facebook", "instagram", "tiktok", "browser"] as const;
export type AppSource = (typeof APP_SOURCES)[number];

/** What the storefront said about one checkout. Each part is kept only when it is understood. */
export interface CheckoutSignals {
  deviceKey?: string;
  fillSeconds?: number;
  visitSource?: VisitSource;
}

export interface NetworkSignals {
  networkCountry?: string;
}

const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const LONGEST_FILL_MS = 3_600_000;
const LONGEST_SIGNAL = 512;

function jsonFields(raw: string | undefined, read: (text: string) => string = (text) => text): Record<string, unknown> {
  if (!raw || raw.length > LONGEST_SIGNAL) return {};
  try {
    return (JSON.parse(read(raw)) ?? {}) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function readCheckoutSignals(raw: string | undefined): CheckoutSignals {
  const { d: device, f: fill, s: source } = jsonFields(raw);
  return {
    ...(typeof device === "string" && UUID.test(device) ? { deviceKey: device.toLowerCase() } : {}),
    ...(typeof fill === "number" && Number.isInteger(fill) && fill >= 0 && fill <= LONGEST_FILL_MS ? { fillSeconds: fill / 1000 } : {}),
    ...((VISIT_SOURCES as readonly unknown[]).includes(source) ? { visitSource: source as VisitSource } : {}),
  };
}

export function readNetworkSignals(header: string | undefined): NetworkSignals {
  const { c: country } = jsonFields(header, decodeURIComponent);
  return typeof country === "string" && /^[A-Z0-9]{2}$/i.test(country) ? { networkCountry: country.toUpperCase() } : {};
}

const IN_APP_BROWSERS: readonly (readonly [RegExp, AppSource])[] = [
  [/Instagram/i, "instagram"],
  [/FBAN|FBAV|FB_IAB|FBIOS/, "facebook"],
  [/musical_ly|TikTok|BytedanceWebview|trill_/i, "tiktok"],
];

/** Which app's built-in browser sent the order, from its User-Agent. */
export function appSourceOf(userAgent: string | undefined): AppSource | undefined {
  if (!userAgent) return undefined;
  return IN_APP_BROWSERS.find(([pattern]) => pattern.test(userAgent))?.[1] ?? "browser";
}
