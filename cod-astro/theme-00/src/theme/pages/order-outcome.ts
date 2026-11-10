/**
 * What happens after the order form posts — one definition for every page that
 * renders the form (product, landing, checkout).
 *
 * The SDK reads what the post came to (`orderPlacementOf`); this file only
 * words it. A placed order answers with a single 303 to `/thank-you`
 * (post/redirect/get), so the form page never re-renders behind it. The
 * thank-you query is the SDK's: `thankYouHref` writes it and the thank-you
 * page reads it with `readThankYou`.
 */
import { isInputError } from "astro:actions";
import { orderPlacementOf, thankYouHref, type CouponRefusal, type OrderPlacement } from "@wocart/storefront";
import { message } from "@/theme/content/messages";
import type { FieldErrors } from "@/theme/types";
import type { OrderFormStrings } from "@/theme/content/types/order-form";

/** The order form's state after a submit: where to go, or what to show. */
export interface OrderOutcome {
  redirect: string | null;
  fieldErrors: FieldErrors;
  /** Why the order was not placed, in the store's words; null when nothing was refused or the code box says why. */
  notice: string | null;
  /** The order was refused for its code: the code box says why. */
  couponRefusal: CouponRefusal | null;
}

/** The order form's words for a refused order. Only these are ever shown to a shopper. */
export type OrderOutcomeCopy = Pick<
  OrderFormStrings,
  | "formRequiredField"
  | "formFieldInvalid"
  | "formFixFields"
  | "formOutOfStock"
  | "formOutOfStockNamed"
  | "formProductUnavailable"
  | "formProductUnavailableNamed"
  | "formDeliveryUnavailable"
  | "formBotCheckFailed"
  | "formPhoneNotVerified"
  | "formSubmitFailed"
  | "formSubmitFailedReference"
>;

const NOT_POSTED: OrderOutcome = { redirect: null, fieldErrors: {}, notice: null, couponRefusal: null };

type Refusal = Exclude<OrderPlacement, { status: "placed" }>;

/** Each refusal in the store's words; the server's own text is for the merchant. */
function refusalNotice(refusal: Refusal, copy: OrderOutcomeCopy, locale: string): string | null {
  switch (refusal.status) {
    case "coupon-refused":
      return null;
    case "out-of-stock":
      return refusal.productName ? message(copy, "formOutOfStockNamed", { product: refusal.productName }, locale) : copy.formOutOfStock;
    case "product-unavailable":
      return refusal.productName ? message(copy, "formProductUnavailableNamed", { product: refusal.productName }, locale) : copy.formProductUnavailable;
    case "delivery-unavailable":
      return copy.formDeliveryUnavailable;
    case "bot-check-failed":
      return copy.formBotCheckFailed;
    case "phone-not-verified":
      return copy.formPhoneNotVerified;
    case "invalid-fields":
      return copy.formFixFields;
    case "failed":
      return refusal.reference ? message(copy, "formSubmitFailedReference", { reference: refusal.reference }, locale) : copy.formSubmitFailed;
  }
}

export function orderOutcome(result: { data?: unknown; error?: unknown } | undefined, copy: OrderOutcomeCopy, locale: string): OrderOutcome {
  const placement = orderPlacementOf(result, isInputError);
  if (!placement) return NOT_POSTED;
  if (placement.status === "placed") return { ...NOT_POSTED, redirect: thankYouHref(placement.order) };
  return {
    redirect: null,
    fieldErrors:
      placement.status === "invalid-fields"
        ? Object.fromEntries(Object.entries(placement.fields).map(([name, problem]) => [name, [problem === "choose" ? copy.formRequiredField : copy.formFieldInvalid]]))
        : {},
    notice: refusalNotice(placement, copy, locale),
    couponRefusal: placement.status === "coupon-refused" ? placement.couponRefusal : null,
  };
}
