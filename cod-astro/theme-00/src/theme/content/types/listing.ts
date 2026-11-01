/**
 * Content pack types - product listings (all products, a category, a
 * collection) and the store's text pages.
 */

import type { Plural } from "./plural";

export type ListingStrings = Plural<"listingCount"> & Plural<"listingRangeTotal"> & Plural<"searchResults"> & {
  /** The search page: its title, the box, the button, nothing found, and what can be searched. `searchResults` names {count} and {query}. */
  searchTitle: string;
  searchPlaceholder: string;
  searchSubmit: string;
  searchEmpty: string;
  searchHint: string;
  /** The order control: its label, the listing's own order, each order the platform offers, and the button without scripts. */
  sortLabel: string;
  sortDefault: string;
  sortNewest: string;
  sortPriceAscending: string;
  sortPriceDescending: string;
  sortApply: string;
  /** Above the category chips. */
  listingBrowse: string;
  /** A text page the store has not written yet, in an editor's preview. */
  pageEmpty: string;
};
