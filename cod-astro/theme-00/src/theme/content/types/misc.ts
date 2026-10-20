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
  thankYouPageTitle: string;
  defaultMetaDescription: string;
  /** A product page's title: `{product}` and `{storeName}`. */
  productPageTitle: string;
  /** A collection page's title: `{collection}` and `{storeName}`. */
  collectionPageTitle: string;
  /** A page's title in the browser: a category's, a text page's, all products'. */
  documentTitle: string;
};
