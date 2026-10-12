/**
 * The storefront languages the platform supports — the single declaration
 * (ADR 0005). Every enum, validator and fallback rule for a *store's* language
 * reads this list. Storefronts never mirror it: `/store/config` sends each
 * served language's code, name and direction, so a theme or SDK learns a new
 * language from the server instead of from a release (ADR 0005).
 *
 * Adding a language is adding a row (then shipping its theme packs and
 * translations). Codes are BCP 47 tags in canonical case. Order is the order
 * an editor or switcher lists them.
 */
export const STORE_LOCALES = ["ar", "fr", "en"] as const;

export type StoreLocale = (typeof STORE_LOCALES)[number];

export interface StoreLocaleInfo {
  code: StoreLocale;
  /** The language's name in itself (its endonym), for a language switcher. */
  nativeName: string;
  direction: "rtl" | "ltr";
}

export const STORE_LOCALE_INFO: Readonly<Record<StoreLocale, StoreLocaleInfo>> = {
  ar: { code: "ar", nativeName: "العربية", direction: "rtl" },
  fr: { code: "fr", nativeName: "Français", direction: "ltr" },
  en: { code: "en", nativeName: "English", direction: "ltr" },
};

/** A new store's primary language. Matches the `stores.lang` column default. */
export const DEFAULT_STORE_LOCALE: StoreLocale = "ar";

export function isStoreLocale(value: unknown): value is StoreLocale {
  return typeof value === "string" && (STORE_LOCALES as readonly string[]).includes(value);
}

/**
 * A store's languages in display order: the primary first, then the others in
 * registry order. Unknown and repeated codes are dropped.
 */
export function orderLocales(primary: StoreLocale, locales: readonly unknown[]): StoreLocale[] {
  const wanted = new Set<StoreLocale>(locales.filter(isStoreLocale));
  return [primary, ...STORE_LOCALES.filter((locale) => locale !== primary && wanted.has(locale))];
}

/**
 * Where to look, in order, when serving `requested` in a store: the requested
 * language, then the store's primary — each once. `pickByLocale` continues
 * with any language that has a value.
 */
export function localeChain(requested: StoreLocale, primary: StoreLocale): StoreLocale[] {
  return requested === primary ? [requested] : [requested, primary];
}

/**
 * The first value available along `chain`, else the first available in
 * registry order, reporting which language it came from. `null` only when no
 * language has a value — a translated record is never shown as missing while
 * any translation of it exists.
 */
export function pickByLocale<T>(
  available: ReadonlyMap<StoreLocale, T>,
  chain: readonly StoreLocale[],
): { locale: StoreLocale; value: T } | null {
  for (const locale of [...chain, ...STORE_LOCALES]) {
    if (available.has(locale)) return { locale, value: available.get(locale) as T };
  }
  return null;
}
