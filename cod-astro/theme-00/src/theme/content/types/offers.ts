/**
 * Content pack types - offers (split from types.ts).
 *
 * Groups: offers.
 */

import type { Plural } from "./plural";

export type OffersStrings = Plural<"offerQuantity"> & {
  /** Label for the free item row in the order summary */
  offerFreeLabel: string;
  /** Title above the offer tier selector section */
  offerSectionTitle: string;
  /** Badge text on free-shipping offer tiers */
  offerFreeShippingBadge: string;
  /** "Buy 1" label on the base tier card */
  offerBuyOne: string;
  /** "Most Popular" badge on the first offer tier */
  offerBestValue: string;
  /** A quantity tier's per-unit price: `{price}`. */
  qtyTierEach: string;
  /** A quantity tier's saving: `{pct}`. */
  qtyTierSave: string;
};
