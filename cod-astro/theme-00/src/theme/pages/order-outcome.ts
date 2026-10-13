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
import type { OrderFormStrings } from "@/theme/content/types/order-form";

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

/** The order form's words for a refused order. Only these are ever shown to a shopper. */
export type OrderOutcomeCopy = Pick<OrderFormStrings, "formSubmitFailed" | "formFieldInvalid" | "formRequiredField">;

/** The dropdowns: a missing answer there is a choice to make, not a value to check. */
const CHOICE_FIELDS = new Set(["wilayaId", "communeId", "deliveryType"]);

/** The server's own messages are English and written for the merchant; the form says its own. */
function shopperFieldErrors(fields: FieldErrors, copy: OrderOutcomeCopy): FieldErrors {
  return Object.fromEntries(
    Object.keys(fields).map((name) => [name, [CHOICE_FIELDS.has(name) ? copy.formRequiredField : copy.formFieldInvalid]]),
  );
}

export function orderOutcome(
  result: { data?: PlacedOrder | undefined; error?: unknown } | undefined,
  copy: OrderOutcomeCopy,
): OrderOutcome {
  if (result?.data?.orderNumber) {
    return { redirect: thankYouHref(result.data), fieldErrors: {}, serverError: null };
  }
  const error = result?.error;
  if (isInputError(error)) {
    return { redirect: null, fieldErrors: shopperFieldErrors(error.fields, copy), serverError: null };
  }
  // The server's message is written for the merchant (an SKU is missing, an
  // item is out of stock). The shopper gets the store's own sentence, and the
  // detail stays in the server's logs.
  return {
    redirect: null,
    fieldErrors: {},
    serverError: error ? copy.formSubmitFailed : null,
  };
}
