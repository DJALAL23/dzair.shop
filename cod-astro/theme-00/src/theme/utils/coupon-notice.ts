/**
 * What the shopper is told about the code they typed — the one place a
 * coupon's answer becomes a sentence, for the browser (the live quote) and for
 * the server (an order refused for its code) alike.
 *
 * The answer is the platform's (`CouponOutcome` from the cart quote, or the
 * refusal an order came back with); this only words it. A reason the theme
 * does not know yet reads the general refusal.
 */
import { couponRefusalTone, type COUPON_REFUSAL_REASONS, type CouponOutcome, type CouponRefusal } from "@wocart/storefront";
import type { CouponStrings } from "@/theme/content/types/coupon";
import { message, pluralKeys } from "@/theme/content/messages";
import { formatCurrency } from "@/theme/utils/money";

/**
 * `applied`: the code took something off. `refused`: the code itself cannot be
 * used — unknown, outside its dates, used up, not for this shopper. `hint`: the
 * code is good but this basket does not meet it yet — a product under an
 * offer, a minimum not reached, a phone still to type.
 */
export interface CouponNotice {
  tone: "applied" | "refused" | "hint";
  text: string;
}

/** The coupon copy a notice needs — what an order form hands its script. */
export const COUPON_COPY_KEYS = [
  "couponApplied",
  "couponAppliedFreeShipping",
  "couponNotFound",
  "couponNotStarted",
  "couponExpired",
  "couponUsedUp",
  "couponIdentifyFirst",
  "couponNotEligible",
  "couponAlreadyUsed",
  "couponNoEligibleProducts",
  "couponOfferApplied",
  "couponBelowSubtotal",
  ...pluralKeys("couponBelowQuantity"),
  "couponDeliveryAlreadyFree",
  "couponRefused",
] as const;

export type CouponCopy = Partial<Record<(typeof COUPON_COPY_KEYS)[number], string>>;

/** The coupon copy of a content pack, for `data-*` and for `couponNotice`. */
export function couponCopy(pack: CouponStrings): CouponCopy {
  const source = pack as unknown as Record<string, string | undefined>;
  return Object.fromEntries(COUPON_COPY_KEYS.flatMap((key) => (source[key] === undefined ? [] : [[key, source[key]]])));
}

/** The reasons worded with a figure, each by its own branch below. */
type FigureReason = "below_minimum_quantity" | "below_minimum_subtotal" | "not_started";

/** The reasons worded without a figure: every other reason the SDK names, or the type check fails. */
const REFUSAL_KEY: Record<Exclude<(typeof COUPON_REFUSAL_REASONS)[number], FigureReason>, keyof CouponCopy> = {
  not_found: "couponNotFound",
  expired: "couponExpired",
  used_up: "couponUsedUp",
  identify_first: "couponIdentifyFirst",
  not_eligible: "couponNotEligible",
  already_used: "couponAlreadyUsed",
  no_eligible_products: "couponNoEligibleProducts",
  offer_applied: "couponOfferApplied",
  delivery_already_free: "couponDeliveryAlreadyFree",
};

export function couponNotice(
  answer: CouponOutcome | ({ applied: false } & CouponRefusal),
  copy: CouponCopy,
  locale: string,
  currency: string,
): CouponNotice {
  if (answer.applied) {
    const text =
      answer.freeShipping
        ? (copy.couponAppliedFreeShipping ?? "")
        : message(copy, "couponApplied", { amount: formatCurrency(answer.discount, currency) }, locale);
    return { tone: "applied", text };
  }
  const refused = (text: string | undefined): CouponNotice => ({
    tone: text !== undefined ? couponRefusalTone(answer.reason) : "refused",
    text: text ?? copy.couponRefused ?? "",
  });
  // Reasons that carry a figure are worded with it, and only with it.
  if (answer.reason === "below_minimum_quantity") {
    return answer.shortBy === undefined ? refused(undefined) : refused(message(copy, "couponBelowQuantity", { count: answer.shortBy }, locale));
  }
  if (answer.reason === "below_minimum_subtotal") {
    return answer.shortBy === undefined ? refused(undefined) : refused(message(copy, "couponBelowSubtotal", { amount: formatCurrency(answer.shortBy, currency) }, locale));
  }
  if (answer.reason === "not_started") {
    const date = answer.startsAt ? new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric" }).format(new Date(answer.startsAt)) : null;
    return refused(date === null ? undefined : message(copy, "couponNotStarted", { date }, locale));
  }
  const key: keyof CouponCopy | undefined = REFUSAL_KEY[answer.reason as keyof typeof REFUSAL_KEY];
  return refused(key ? copy[key] : undefined);
}
