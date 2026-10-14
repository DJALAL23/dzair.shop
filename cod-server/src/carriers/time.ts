/**
 * Carrier timestamps → canonical UTC instants.
 *
 * Algerian carriers write local wall-clock times without a zone
 * (`2022-04-28 00:01:26`). Algeria keeps UTC+1 all year (no daylight saving
 * since 1981), so the conversion is a fixed offset. Values that already carry
 * a zone (`…Z`, `…+01:00`) are taken as they are.
 *
 * Shipment logic compares instants as strings, so every adapter must hand
 * over `toISOString()` form — never a carrier's raw text.
 */

const ALGIERS_OFFSET_MINUTES = 60;
const LOCAL = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?$/;

/** The instant a carrier timestamp denotes, or null when it cannot be read. */
export function carrierInstant(value: string | null | undefined): string | null {
  if (!value) return null;
  const text = value.trim();
  const local = LOCAL.exec(text);
  if (local) {
    const [, y, mo, d, h = "0", mi = "0", s = "0", ms = "0"] = local;
    const utc = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s, +ms.padEnd(3, "0")) - ALGIERS_OFFSET_MINUTES * 60_000;
    const date = new Date(utc);
    // Reject impossible dates (2026-02-30) that Date.UTC would roll over.
    const check = new Date(utc + ALGIERS_OFFSET_MINUTES * 60_000);
    if (check.getUTCMonth() !== +mo - 1 || check.getUTCDate() !== +d) return null;
    return date.toISOString();
  }
  if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(text)) return null;
  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}
