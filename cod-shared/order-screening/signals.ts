import { toLocalAlgerianMobile } from "../lib/phone";

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
