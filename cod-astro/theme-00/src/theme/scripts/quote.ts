/**
 * The storefront's quote, asked of the server.
 *
 * What the lines cost (every offer applied) and, for a destination, the
 * delivery fee come from the server, computed by the same function that
 * charges the order (see cart-render.ts for the basket's own
 * validator). A product page asks with its form's fields; the answer is kept
 * only if it is the latest request — a slow earlier answer never overwrites a
 * newer one.
 */

import type { CartDeliveryQuote } from "@wocart/storefront";

export const QUOTE_URL = "/api/cart/validate";

export interface QuoteAnswer {
  /** Absent from a server that predates quotes, or when no destination was asked: the caller falls back. */
  delivery?: CartDeliveryQuote;
  /** What the lines cost, every offer applied (quantity pricing included). */
  subtotal?: number;
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
      const data = payload?.data as { delivery?: unknown; subtotal?: unknown } | undefined;
      const subtotal = typeof data?.subtotal === "number" && Number.isFinite(data.subtotal) ? data.subtotal : undefined;
      return {
        ...(isQuote(data?.delivery) ? { delivery: data.delivery } : {}),
        ...(subtotal === undefined ? {} : { subtotal }),
      };
    } catch {
      return undefined;
    }
  };
}
