/**
 * Content pack types - product listings (all products, a category, a
 * collection) and the store's text pages.
 */

import type { Plural } from "./plural";

export type ListingStrings = Plural<"listingCount"> & {
  /** Products {first}–{last}: a page of a listing whose total is not known. */
  listingRange: string;
  /** Above the category chips. */
  listingBrowse: string;
  /** A text page the store has not written yet, in an editor's preview. */
  pageEmpty: string;
};
