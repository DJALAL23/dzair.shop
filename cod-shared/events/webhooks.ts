/**
 * Webhook Consumers (Events context): the merchant's own endpoints, reached
 * per the Standard Webhooks specification. What an endpoint URL may be, what
 * a webhook Consumer keeps in its settings, and its Signing Secrets. Shared
 * by the server, which enforces it, and the dashboard, which explains it
 * before the merchant saves.
 */

/** As stored on `event_consumers.kind`. */
export const WEBHOOK_KIND = "webhook";
/** The most webhook Consumers a store may have: each multiplies the rows every Business Event writes. */
export const WEBHOOK_CONSUMERS_MAX = 10;
/** After a rotation, Deliveries are signed with the previous Signing Secret too, for this long. */
export const PREVIOUS_SECRET_SIGNS_FOR_MS = 24 * 60 * 60_000;
export const WEBHOOK_URL_MAX = 2048;

export type WebhookUrlProblem = "invalid" | "too_long" | "not_https" | "credentials" | "private_host";

/**
 * What keeps a URL from being a webhook endpoint, or null when it may be one:
 * `https`, no credentials in it, and a host on the public internet — never an
 * address or a name that can only mean a private network. Checked when an
 * endpoint is saved and again before every Attempt. The host is judged by
 * what it is written as; what a public name resolves to is not looked up.
 */
export function webhookUrlProblem(raw: string): WebhookUrlProblem | null {
  if (raw.length > WEBHOOK_URL_MAX) return "too_long";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "invalid";
  }
  if (url.protocol !== "https:") return "not_https";
  if (url.username || url.password) return "credentials";
  return isPublicHost(url.hostname) ? null : "private_host";
}

/** Top-level names that are never delegated on the public internet (RFC 6761, 6762, 8375, 9476; ICANN). */
const PRIVATE_TOP_LEVEL = new Set(["localhost", "local", "internal", "test", "example", "invalid", "onion", "arpa", "alt", "lan", "home", "corp", "intranet", "private"]);

function isPublicHost(hostname: string): boolean {
  if (hostname.startsWith("[")) return isPublicIpv6(hostname.slice(1, -1));
  const name = hostname.replace(/\.$/, "");
  if (/^\d+\.\d+\.\d+\.\d+$/.test(name)) return isPublicIpv4(name.split(".").map(Number));
  const labels = name.split(".");
  return labels.length > 1 && labels.every(Boolean) && !PRIVATE_TOP_LEVEL.has(labels.at(-1)!);
}

/** IPv4 ranges that are private, shared, loopback, link-local, reserved, documentation or multicast. */
const PRIVATE_IPV4: ReadonlyArray<[number, number]> = [
  [0x00000000, 8], [0x0a000000, 8], [0x64400000, 10], [0x7f000000, 8], [0xa9fe0000, 16], [0xac100000, 12],
  [0xc0000000, 24], [0xc0000200, 24], [0xc0586300, 24], [0xc0a80000, 16], [0xc6120000, 15], [0xc6336400, 24],
  [0xcb007100, 24], [0xe0000000, 4], [0xf0000000, 4],
];

function isPublicIpv4(octets: number[]): boolean {
  const address = octets.reduce((value, octet) => value * 256 + octet, 0);
  return !PRIVATE_IPV4.some(([base, bits]) => Math.floor(address / 2 ** (32 - bits)) === Math.floor(base / 2 ** (32 - bits)));
}

/** The eight 16-bit groups of an IPv6 address as a URL writes it (compressed, lower case, hexadecimal only). */
function ipv6Groups(address: string): number[] {
  const [head, tail] = address.includes("::") ? address.split("::") : [address, null];
  const parse = (part: string | null | undefined) => (part ? part.split(":").map((group) => parseInt(group, 16)) : []);
  const left = parse(head);
  const right = parse(tail);
  return tail === null ? left : [...left, ...Array(8 - left.length - right.length).fill(0), ...right];
}

function isPublicIpv6(address: string): boolean {
  const g = ipv6Groups(address);
  if (g[0]! <= 0x00ff) return false; // ::/8: unspecified, loopback, IPv4-mapped and -compatible, NAT64
  if ((g[0]! & 0xfe00) === 0xfc00) return false; // fc00::/7 unique local
  if ((g[0]! & 0xffc0) === 0xfe80 || (g[0]! & 0xffc0) === 0xfec0) return false; // fe80::/10 link-local, fec0::/10 site-local
  if ((g[0]! & 0xff00) === 0xff00) return false; // ff00::/8 multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return false; // 2001:db8::/32 documentation
  if (g[0] === 0x0100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return false; // 100::/64 discard
  if (g[0] === 0x2002) return isPublicIpv4([g[1]! >> 8, g[1]! & 0xff, g[2]! >> 8, g[2]! & 0xff]); // 6to4 carries an IPv4 address
  return true;
}

/** What a webhook Consumer keeps in `event_consumers.settings`. */
export interface WebhookSettings {
  url: string;
}

export function readWebhookSettings(stored: string): WebhookSettings {
  const settings = JSON.parse(stored) as Partial<WebhookSettings>;
  if (typeof settings.url !== "string") throw new Error("A webhook Consumer's settings carry no URL");
  return { url: settings.url };
}

const SECRET_PREFIX = "whsec_";

/** A new Signing Secret: 32 random bytes, base64, after `whsec_` (Standard Webhooks). */
export function newSigningSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return SECRET_PREFIX + btoa(String.fromCharCode(...bytes));
}

/** The key a Signing Secret signs with: the bytes its base64 part encodes. */
export function signingKey(secret: string): Uint8Array {
  if (!secret.startsWith(SECRET_PREFIX)) throw new Error("Not a Signing Secret");
  return Uint8Array.from(atob(secret.slice(SECRET_PREFIX.length)), (c) => c.charCodeAt(0));
}

/** Until when the previous Signing Secret still signs, or null when none does. */
export function previousSecretSignsUntil(secretRotatedAt: string | null, previousSigningSecret: string | null): string | null {
  if (!secretRotatedAt || !previousSigningSecret) return null;
  return new Date(Date.parse(secretRotatedAt) + PREVIOUS_SECRET_SIGNS_FOR_MS).toISOString();
}

/** The Signing Secrets a Delivery made now is signed with: the current one, and the previous one while it still signs. */
export function signingSecretsAt(consumer: { signingSecret: string | null; previousSigningSecret: string | null; secretRotatedAt: string | null }, now: Date): string[] {
  if (!consumer.signingSecret) throw new Error("A webhook Consumer without a Signing Secret");
  const until = previousSecretSignsUntil(consumer.secretRotatedAt, consumer.previousSigningSecret);
  return until && now.toISOString() < until ? [consumer.signingSecret, consumer.previousSigningSecret!] : [consumer.signingSecret];
}
