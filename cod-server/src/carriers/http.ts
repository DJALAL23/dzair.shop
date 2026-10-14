/**
 * The one way adapters talk HTTP to carriers.
 *
 * Every call gets a timeout, and every failure leaves as a classified
 * `CarrierError`. The classification depends on whether the call could have
 * changed something at the carrier: a read that fails is simply unavailable,
 * but a write that times out, drops, or meets a server error may already have
 * happened — it is ambiguous, and the caller must not assume either way.
 *
 * Reads are retried once when the carrier is unavailable. Writes are never
 * retried here: carriers do not document rejecting a repeated create, so a
 * blind retry could ship a parcel twice.
 */

import { CarrierError, type CarrierProvider } from "./contract";

export const DEFAULT_TIMEOUT_MS = 15_000;
const READ_RETRY_DELAY_MS = 300;

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export interface CarrierHttpConfig {
  provider: CarrierProvider;
  /** The carrier's name in messages, when it differs from the provider (a platform's other brands). */
  label?: string;
  baseUrl: string;
  headers: () => Record<string, string>;
  /** The carrier's human message for a failed response, or null to use the status. */
  describeError?: (status: number, json: unknown) => string | null;
  timeoutMs?: number;
}

export interface CarrierHttp {
  read<T>(method: Method, path: string, body?: unknown): Promise<T>;
  write<T>(method: Method, path: string, body?: unknown): Promise<T>;
  /** A raw read (for binary bodies such as label PDFs); failures are classified like `read`. */
  readRaw(path: string): Promise<Response>;
}

/** Flatten a carrier's field-error bag into one readable line. */
export function flattenErrorBag(errors: unknown): string | null {
  if (!errors) return null;
  if (Array.isArray(errors)) {
    if (errors.length === 0) return null;
    return errors
      .map((e) => {
        if (typeof e === "string") return e;
        const obj = e as { description?: string; message?: string };
        return obj.description ?? obj.message ?? JSON.stringify(e);
      })
      .join(" | ");
  }
  if (typeof errors !== "object") return null;
  const entries = Object.entries(errors as Record<string, unknown>);
  if (entries.length === 0) return null;
  return entries
    .map(([field, value]) => `${field}: ${(Array.isArray(value) ? value.map(String) : [String(value)]).join(", ")}`)
    .join(" | ");
}

function retryAfterSeconds(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  const date = Date.parse(header);
  return Number.isNaN(date) ? null : Math.max(0, Math.ceil((date - Date.now()) / 1000));
}

function parseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  if (!text) return { ok: true, value: {} };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function createCarrierHttp(config: CarrierHttpConfig): CarrierHttp {
  const { provider } = config;
  const baseUrl = config.baseUrl.replace(/\/+$/, "");
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const label = config.label ?? provider;

  async function send(method: Method, path: string, body: unknown, isWrite: boolean): Promise<Response> {
    const headers = config.headers();
    try {
      return await fetch(`${baseUrl}${path}`, {
        method,
        headers,
        signal: AbortSignal.timeout(timeoutMs),
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch (cause) {
      const timedOut = cause instanceof Error && (cause.name === "TimeoutError" || cause.name === "AbortError");
      const what = timedOut ? `timed out after ${timeoutMs} ms` : `could not be reached (${(cause as Error)?.message ?? cause})`;
      throw new CarrierError(
        provider,
        isWrite ? "ambiguous" : "unavailable",
        `${label} ${method} ${path} ${what}`,
      );
    }
  }

  function failure(response: Response, text: string, isWrite: boolean): CarrierError {
    const status = response.status;
    const parsed = parseJson(text);
    const json = parsed.ok ? parsed.value : null;
    const described = json !== null ? config.describeError?.(status, json) ?? null : null;
    const snippet = text.replace(/\s+/g, " ").slice(0, 180);
    const message = `${label} HTTP ${status}${described ? `: ${described}` : snippet ? ` (${snippet})` : ""}`;
    const details = { httpStatus: status };

    if (status === 429) {
      return new CarrierError(provider, "rate_limited", message, {
        ...details,
        retryAfterSec: retryAfterSeconds(response.headers.get("retry-after")),
      });
    }
    if (status >= 500) return new CarrierError(provider, isWrite ? "ambiguous" : "unavailable", message, details);
    // An edge block page (HTML, not the carrier's API) never reached the carrier.
    if (!parsed.ok) return new CarrierError(provider, "unavailable", message, details);
    if (status === 401 || status === 403) return new CarrierError(provider, "auth", message, details);
    return new CarrierError(provider, "rejected", message, details);
  }

  async function call<T>(method: Method, path: string, body: unknown, isWrite: boolean): Promise<T> {
    const response = await send(method, path, body, isWrite);
    const text = await response.text();
    if (!response.ok) throw failure(response, text, isWrite);
    const parsed = parseJson(text);
    if (!parsed.ok) {
      throw new CarrierError(
        provider,
        isWrite ? "ambiguous" : "unavailable",
        `${label} HTTP ${response.status}: the response is not JSON (${text.replace(/\s+/g, " ").slice(0, 120)})`,
        { httpStatus: response.status },
      );
    }
    return parsed.value as T;
  }

  return {
    async read<T>(method: Method, path: string, body?: unknown): Promise<T> {
      try {
        return await call<T>(method, path, body, false);
      } catch (error) {
        if (!(error instanceof CarrierError) || error.kind !== "unavailable") throw error;
        await delay(READ_RETRY_DELAY_MS);
        return call<T>(method, path, body, false);
      }
    },
    write<T>(method: Method, path: string, body?: unknown): Promise<T> {
      return call<T>(method, path, body, true);
    },
    async readRaw(path: string): Promise<Response> {
      const response = await send("GET", path, undefined, false);
      if (!response.ok) throw failure(response, await response.text(), false);
      return response;
    },
  };
}
