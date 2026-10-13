/**
 * Paging for the product listings. The server pages with `limit` and `offset`
 * and answers with at most 100 rows, so a listing asks for one row more than
 * a page to learn whether a next page exists.
 */

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

/** The request for one page: its offset, and a limit one above the page size. */
export function pageRequest(page: number): { limit: number; offset: number } {
  return { limit: LISTING_PAGE_SIZE + 1, offset: (page - 1) * LISTING_PAGE_SIZE };
}

/**
 * The rows one page shows, whether a next page exists, and the 1-based numbers
 * of its first and last rows (both 0 for an empty page).
 */
export function pageWindow<T>(
  rows: readonly T[],
  page: number,
): { items: T[]; hasNext: boolean; first: number; last: number } {
  const items = rows.slice(0, LISTING_PAGE_SIZE);
  const offset = (page - 1) * LISTING_PAGE_SIZE;
  return {
    items,
    hasNext: rows.length > LISTING_PAGE_SIZE,
    first: items.length > 0 ? offset + 1 : 0,
    last: offset + items.length,
  };
}
