/**
 * Reads the touches a storefront sends with an order. They come from a cookie
 * the shopper's browser holds, so nothing in them is trusted: each value is
 * checked and capped, an unreadable part is dropped, and the order is never
 * refused for it.
 */
import { TOUCH_PARAMS, type CapturedTouches, type Touch, type TouchParam } from "./model";

const MAX_WIRE_LENGTH = 8000;
const MAX_PARAM_LENGTH = 255;
const MAX_CLICK_ID_LENGTH = 500;
const MAX_PATH_LENGTH = 512;
const FUTURE_SKEW_MS = 5 * 60 * 1000;
const OLDEST_MS = 180 * 24 * 60 * 60 * 1000;

const CLICK_ID = /^[A-Za-z0-9._-]+$/;
const HOST = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/;
const CONTROL = /[\u0000-\u001f\u007f]/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > max || CONTROL.test(trimmed)) return null;
  return trimmed;
}

function param(name: TouchParam, value: unknown): string | null {
  if (name === "fbclid" || name === "ttclid" || name === "gclid") {
    const id = typeof value === "string" ? value.trim() : null;
    return id && id.length <= MAX_CLICK_ID_LENGTH && CLICK_ID.test(id) ? id : null;
  }
  return text(value, MAX_PARAM_LENGTH);
}

function instant(value: unknown, now: Date): string | null {
  if (typeof value !== "string" || !ISO_INSTANT.test(value)) return null;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return null;
  const age = now.getTime() - ms;
  if (age < -FUTURE_SKEW_MS || age > OLDEST_MS) return null;
  return new Date(ms).toISOString();
}

function pathname(value: unknown): string | null {
  const path = text(value, MAX_PATH_LENGTH);
  if (!path || !path.startsWith("/") || path.startsWith("//")) return null;
  return path.split(/[?#]/)[0]!;
}

function host(value: unknown): string | null {
  const name = text(value, 253)?.toLowerCase() ?? null;
  return name && HOST.test(name) ? name : null;
}

/** One touch as Wocart keeps it, or null when it has no time or nothing to credit. */
export function parseTouch(raw: unknown, now: Date): Touch | null {
  if (!isRecord(raw)) return null;
  const at = instant(raw.at, now);
  if (!at) return null;
  const params: Partial<Record<TouchParam, string>> = {};
  if (isRecord(raw.params)) {
    for (const name of TOUCH_PARAMS) {
      const value = param(name, raw.params[name]);
      if (value) params[name] = value;
    }
  }
  const path = pathname(raw.path);
  const ref = host(raw.ref);
  if (Object.keys(params).length === 0 && !path && !ref) return null;
  return { at, params, path, ref };
}

/** Whether a touch came from an ad or a tagged link: its URL carried one of the touch parameters. */
export function isAdTouch(touch: Touch): boolean {
  return Object.keys(touch.params).length > 0;
}

/**
 * The touches an order carries, from the storefront's JSON (an object, or the
 * same as a string), or null when nothing usable is in it. A last touch with
 * no ad parameter is not an ad touch and is dropped.
 */
export function parseCapturedTouches(raw: unknown, now: Date): CapturedTouches | null {
  let value = raw;
  if (typeof value === "string") {
    if (value.length > MAX_WIRE_LENGTH) return null;
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!isRecord(value)) return null;
  const first = parseTouch(value.first, now);
  const lastTouch = parseTouch(value.last, now);
  const last = lastTouch && isAdTouch(lastTouch) ? lastTouch : null;
  if (!first && !last) return null;
  return { first, last };
}
