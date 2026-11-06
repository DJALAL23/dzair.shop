/**
 * How each store language writes the Algerian dinar, and the symbol a page
 * shows. A store keeps one symbol in its primary language and may translate
 * it like any of its texts; while it keeps its language's usual symbol and has
 * not translated it, a page in another language shows that language's usual
 * one ("دج" → "DA" in French), so no French or English page reads Arabic
 * money. A symbol of the merchant's own making is theirs in every language.
 */
import type { StoreLocale } from "./locales";

export const DINAR_SYMBOLS: Readonly<Record<StoreLocale, string>> = { ar: "دج", fr: "DA", en: "DZD" };

export function servedCurrencySymbol(store: {
  currency: string;
  /** The store's own symbol, in its primary language. */
  symbol: string;
  /** The symbol after the served language's translation (the store's own when none). */
  translated: string;
  primary: string;
  locale: string;
}): string {
  if (store.translated !== store.symbol || store.locale === store.primary || store.currency !== "DZD") return store.translated;
  const usual = DINAR_SYMBOLS[store.primary as StoreLocale];
  const served = DINAR_SYMBOLS[store.locale as StoreLocale];
  return usual !== undefined && served !== undefined && store.symbol === usual ? served : store.translated;
}
