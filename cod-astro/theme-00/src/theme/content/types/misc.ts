/**
 * Content pack types - misc (split from types.ts).
 *
 * Groups: misc.
 */

import type { Plural } from "./plural";

export type MiscStrings = Plural<"lowStock"> &
  Plural<"qtyMaxStock"> &
  Plural<"ariaStarRating"> & {
  required: string;
  featured: string;
  outOfStock: string;
  searchLabel: string;
  noResultsLabel: string;
  loadMoreLabel: string;
  allLabel: string;
  pagerPrevious: string;
  pagerNext: string;
  pagerLabel: string;
  /** Where the shopper is when the listing knows its size. */
  pagerPageOf: string;
  reviewFormMinLengthError: string;
  reviewFormRatingRequired: string;
  offerSavingsText: string;
  offerUnitLabel: string;
  ariaMainNavigation: string;
  /** The language switcher's accessible name (shown only when the store publishes several). */
  ariaLanguageSwitcher: string;
  ariaQuantity: string;
  ariaGoToImage: string;
  ariaBrowseAllProducts: string;
  ariaBrowseCategoryProducts: string;
  ariaProductCard: string;
  /** A product card's name when the card also takes a quick action: `{card}`, `{action}`. */
  ariaProductCardAction: string;
  thankYouPageTitle: string;
  defaultMetaDescription: string;
  /** A product page's title: `{product}` and `{storeName}`. */
  productPageTitle: string;
  /** A collection page's title: `{collection}` and `{storeName}`. */
  collectionPageTitle: string;
  /** A page's title in the browser: a category's, a text page's, all products'. */
  documentTitle: string;
};
