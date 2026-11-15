/**
 * Meta's two browser identifiers, as Meta defines them
 * (developers.facebook.com, Conversions API › "fbp and fbc", and
 * "Parameter Builder Library"):
 *
 * - Click ID, the `_fbc` cookie / `fbc` parameter:
 *   `fb.<subdomainIndex>.<creationTimeMs>.<fbclid>[.<appendix>]`
 * - Browser ID, the `_fbp` cookie / `fbp` parameter:
 *   `fb.<subdomainIndex>.<creationTimeMs>.<randomNumber>[.<appendix>]`
 *
 * `subdomainIndex` is 0, 1 or 2; `creationTime` is Unix milliseconds; the
 * appendix is added by Meta's Parameter Builder (8 characters, 2 in its legacy
 * form). Meta accepts a malformed `fbc` without an error and simply fails to
 * match it, so a bad value is worth nothing and is dropped here, never sent on
 * and never the reason an order is refused.
 */

const MAX_LENGTH = 500;
const CLICK_ID = /^fb\.[0-2]\.\d{13}\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/;
const BROWSER_ID = /^fb\.[0-2]\.\d{13}\.\d+(?:\.[A-Za-z0-9_-]+)?$/;

function matching(value: unknown, pattern: RegExp): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_LENGTH) return null;
  return pattern.test(trimmed) ? trimmed : null;
}

/** The value as Meta's Click ID, or null when it is not one. */
export function metaClickId(value: unknown): string | null {
  return matching(value, CLICK_ID);
}

/** The value as Meta's Browser ID, or null when it is not one. */
export function metaBrowserId(value: unknown): string | null {
  return matching(value, BROWSER_ID);
}
