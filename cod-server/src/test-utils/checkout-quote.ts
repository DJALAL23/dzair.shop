import type { CheckoutQuote } from "../../../cod-shared/queries/checkout-quote";

/**
 * The checkout quote for tests that stub the store queries and care only that
 * the store delivers there at `rate`: no lines priced, no offer, no coupon.
 * The quote itself is proven against real D1 (`store/coupon-checkout-e2e`,
 * `store/delivery-quote-e2e`).
 */
export function deliveredAt(rate: number): CheckoutQuote {
  return {
    basket: { priced: [], subtotal: 0, rewards: [], freeShippingOfferId: null, coupon: null },
    coupon: null,
    couponOutcome: null,
    delivery: { rate, fee: rate },
  };
}
