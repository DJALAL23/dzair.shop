/**
 * What happens after the order form posts — one definition for every page that
 * renders the form (product, landing, checkout) and for the thank-you page that
 * reads the result.
 *
 * A placed order answers with a single 303 to `/thank-you` (post/redirect/get),
 * so the form page never re-renders behind it. The thank-you query is a contract
 * between this theme's own pages: `thankYouHref` writes it and `readThankYou`
 * reads it, so the parameter names exist in exactly one place.
 */
import { isInputError } from "astro:actions";
import type { FieldErrors } from "@/theme/types";

const ORDER_NUMBER = "order";
const TOTAL = "total";
const ORDER_ID = "oid";

/** The part of a placed order the thank-you page needs. */
export interface PlacedOrder {
  orderNumber: string;
  total: number;
  orderId?: string | null;
}

export function thankYouHref(order: PlacedOrder): string {
  const query = new URLSearchParams({
    [ORDER_NUMBER]: order.orderNumber,
    [TOTAL]: String(order.total),
    [ORDER_ID]: order.orderId ?? "",
  });
  return `/thank-you?${query.toString()}`;
}

/** The thank-you query, parsed. A missing or non-numeric total is `null`. */
export function readThankYou(url: URL): { orderNumber: string; orderId: string; total: number | null } {
  const rawTotal = url.searchParams.get(TOTAL);
  const total = rawTotal === null ? Number.NaN : Number.parseInt(rawTotal, 10);
  return {
    orderNumber: url.searchParams.get(ORDER_NUMBER) ?? "",
    orderId: url.searchParams.get(ORDER_ID) ?? "",
    total: Number.isFinite(total) ? total : null,
  };
}

/** The order form's state after a submit: where to go, or what to show. */
export interface OrderOutcome {
  redirect: string | null;
  fieldErrors: FieldErrors;
  serverError: string | null;
}

export function orderOutcome(
  result: { data?: PlacedOrder | undefined; error?: unknown } | undefined,
): OrderOutcome {
  if (result?.data?.orderNumber) {
    return { redirect: thankYouHref(result.data), fieldErrors: {}, serverError: null };
  }
  const error = result?.error;
  if (isInputError(error)) {
    return { redirect: null, fieldErrors: error.fields, serverError: null };
  }
  return {
    redirect: null,
    fieldErrors: {},
    serverError: error instanceof Error ? error.message : null,
  };
}
