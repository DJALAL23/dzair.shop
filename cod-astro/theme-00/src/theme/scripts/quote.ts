/**
 * The storefront's delivery quote, asked of the server.
 *
 * A destination's fee and total come from the server, computed by the same
 * function that charges the order (see cart-render.ts for the basket's own
 * validator). A product page asks with its form's fields; the answer is kept
 * only if it is the latest request — a slow earlier answer never overwrites a
 * newer one.
 */

import type { CartDeliveryQuote } from "@wocart/storefront";

export const QUOTE_URL = "/api/cart/validate";

export interface QuoteAnswer {
  /** Absent from a server that predates quotes: the caller falls back. */
  delivery?: CartDeliveryQuote;
}

function isQuote(value: unknown): value is CartDeliveryQuote {
  if (typeof value !== "object" || value === null) return false;
  const quote = value as { available?: unknown; fee?: unknown };
  if (quote.available === false) return quote.fee === null;
  return quote.available === true && typeof quote.fee === "number" && Number.isFinite(quote.fee);
}

/**
 * Returns a quoter. Each call posts `body`; the result is `undefined` when the
 * answer is stale or the request failed, so the caller keeps what it shows.
 */
export function createQuoter(url: string = QUOTE_URL) {
  let latest = 0;

  return async function quote(body: Record<string, unknown>): Promise<QuoteAnswer | undefined> {
    const id = ++latest;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) return undefined;
      const payload = await res.json();
      if (id !== latest) return undefined;
      const delivery = (payload?.data as { delivery?: unknown } | undefined)?.delivery;
      return isQuote(delivery) ? { delivery } : {};
    } catch {
      return undefined;
    }
  };
}
