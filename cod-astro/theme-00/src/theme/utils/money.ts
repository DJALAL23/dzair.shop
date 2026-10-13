/**
 * The theme's ONE money-format binding.
 *
 * Every amount the theme shows goes through `formatAmount`, which is the SDK's
 * `formatMoney` (the platform's digit, grouping and rounding rule) with the
 * currency symbol left out — call sites render the symbol themselves because
 * prices are styled with it in its own element.
 *
 * Why one module: before this binding, eight call sites hand-rolled
 * `toLocaleString("ar-DZ")` (cards, summary, tiers, product script, thank-you
 * page). A future theme is free to format money differently; that decision now
 * lives in one file. The locale itself is a theme-level choice today — a store
 * configured in `fr` still renders Algerian-locale digits (tracked as P1-5 in
 * `PRODUCT_ZERO_AUDIT.md`).
 *
 * Browser-safe: the SDK root entry point is safe for scripts, so
 * `scripts/product.ts` imports this module like any other theme util.
 */
import { formatMoney } from "@wocart/storefront";

/** The digit/grouping locale the theme formats DZD amounts with. */
export const MONEY_LOCALE = "ar-DZ";

/** The number part of a price (`4.500`), locale-formatted, no symbol. */
export function formatAmount(amount: number, locale: string = MONEY_LOCALE): string {
  return formatMoney(amount, { symbol: "", locale }).trim();
}

export function formatCurrency(
  amount: number,
  symbol: string,
  locale: string = MONEY_LOCALE,
): string {
  return formatMoney(amount, { symbol, locale });
}
