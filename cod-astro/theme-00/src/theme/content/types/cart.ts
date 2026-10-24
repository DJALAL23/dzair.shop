/**
 * Content pack types - cart (split from types.ts).
 *
 * Groups: cart.
 */

import type { Plural } from "./plural";

export type CartStrings = Plural<"cartItems"> &
  Plural<"cartLineOutOfStock"> & {
  cartTitle: string;
  cartEmptyTitle: string;
  cartEmptyHint: string;
  cartAddToCart: string;
  cartOpenLabel: string;
  cartCloseLabel: string;
  cartSubtotalLabel: string;
  cartCheckoutCta: string;
  cartRemoveLabel: string;
  cartIncreaseLabel: string;
  cartDecreaseLabel: string;
  cartFreeDeliveryEarned: string;
  cartFreeDeliveryRemaining: string;
  cartLineUnavailable: string;
  cartFixBeforeCheckout: string;
  /** An add that found no room: the basket holds as many lines or pieces as it can. */
  cartFull: string;
  cartDeliveryNote: string;
  cartContinueShopping: string;

  // ── Checkout page ─────────────────────────────────────────────────────────
  checkoutTitle: string;
  checkoutSummaryTitle: string;
  checkoutLoading: string;

  // ── Related products ──────────────────────────────────────────────────────
  relatedTitle: string;
  relatedSub: string;
};
