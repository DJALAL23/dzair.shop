/**
 * Content pack types - coupon: the code box on the order forms, and what the
 * shopper is told about the code typed.
 *
 * One sentence per refusal reason the platform names; a reason the theme does
 * not know yet reads `couponRefused`.
 */

import type { Plural } from "./plural";

export type CouponStrings = Plural<"couponBelowQuantity"> & {
  /** The link that opens the code box. */
  couponToggle: string;
  couponLabel: string;
  couponPlaceholder: string;
  couponApply: string;
  /** Takes the applied code off the order. */
  couponRemove: string;
  /** While the store checks the code. */
  couponChecking: string;
  /** `{amount}`: what the code takes off, with the currency. */
  couponApplied: string;
  couponAppliedFreeShipping: string;
  /** The summary row: `{code}`. */
  couponSummaryLabel: string;
  couponNotFound: string;
  /** `{date}`: when the code begins. */
  couponNotStarted: string;
  couponExpired: string;
  couponUsedUp: string;
  couponIdentifyFirst: string;
  couponNotEligible: string;
  couponAlreadyUsed: string;
  couponNoEligibleProducts: string;
  /** Everything the code covers already has an offer: one promotion per product. */
  couponOfferApplied: string;
  /** `{amount}`: what the products the code covers still lack, with the currency. */
  couponBelowSubtotal: string;
  couponDeliveryAlreadyFree: string;
  couponRefused: string;
};
