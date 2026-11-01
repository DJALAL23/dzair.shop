/**
 * What a listing's address asks for — its page and its order — read the same
 * way by every listing, and written back into its links. The page itself is
 * the SDK's `products.page`: the rows, whether another page follows, and how
 * many the whole listing holds.
 */
import { PRODUCT_SORTS, type ProductSort } from "@wocart/storefront";

/** Products per listing page. */
export const LISTING_PAGE_SIZE = 24;

/** The largest page a shopper can ask for. Past this the offset means nothing useful. */
const MAX_PAGE = 10_000;

/** The page the shopper asked for: 1 unless the query is a whole number from 1 up. */
export function requestedPage(raw: string | null | undefined): number {
  if (!/^\d+$/.test(raw ?? "")) return 1;
  const page = Number(raw);
  return Number.isSafeInteger(page) && page >= 1 && page <= MAX_PAGE ? page : 1;
}

/** The order `?sort=` asks for, or none — the listing's own — for anything the SDK does not offer. */
export function requestedSort(raw: string | null | undefined): ProductSort | undefined {
  return PRODUCT_SORTS.find((sort) => sort === raw);
}

/** The rows of `page` a listing asks the server for. */
export function pageRequest(page: number, sort: ProductSort | undefined): { limit: number; offset: number; sort?: ProductSort } {
  return { limit: LISTING_PAGE_SIZE, offset: (page - 1) * LISTING_PAGE_SIZE, ...(sort ? { sort } : {}) };
}

/** The 1-based numbers of a page's first and last rows (both 0 for an empty page). */
export function pageSpan(page: number, shown: number): { first: number; last: number } {
  const offset = (page - 1) * LISTING_PAGE_SIZE;
  return { first: shown > 0 ? offset + 1 : 0, last: offset + shown };
}

/** How many pages a listing of `total` products fills. */
export function pageCount(total: number): number {
  return Math.max(1, Math.ceil(total / LISTING_PAGE_SIZE));
}

/** A listing's address at a page and an order, under its localized path; the first page carries no `page`. `keep` rides along (a search's words). */
export function listingHref(path: string, page: number, sort: ProductSort | undefined, keep: Record<string, string> = {}): string {
  const query = new URLSearchParams(keep);
  if (page > 1) query.set("page", String(page));
  if (sort) query.set("sort", sort);
  const search = query.toString();
  return search ? `${path}?${search}` : path;
}
