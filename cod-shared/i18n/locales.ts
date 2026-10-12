/**
 * The storefront languages the platform supports — the single declaration
 * (ADR 0005). Every enum, validator and fallback rule for a *store's* language
 * reads this list; `@codflow/storefront` mirrors it, guarded by
 * `scripts/check-platform-parity.mjs`.
 *
 * Adding a language is adding a row (then shipping its theme packs and
 * translations). Order is the order an editor or switcher lists them.
 */
export const STORE_LOCALES = ["ar", "fr", "en"] as const;

export type StoreLocale = (typeof STORE_LOCALES)[number];

export interface StoreLocaleInfo {
  code: StoreLocale;
  /** The language's name in itself, for a language switcher. */
  nativeName: string;
  direction: "rtl" | "ltr";
}

export const STORE_LOCALE_INFO: Readonly<Record<StoreLocale, StoreLocaleInfo>> = {
  ar: { code: "ar", nativeName: "العربية", direction: "rtl" },
  fr: { code: "fr", nativeName: "Français", direction: "ltr" },
  en: { code: "en", nativeName: "English", direction: "ltr" },
};

/**
 * The platform's last-resort language: where a lookup lands when neither the
 * requested language nor the store's primary has a value. Matches the
 * `stores.lang` column default.
 */
export const DEFAULT_STORE_LOCALE: StoreLocale = "ar";

export function isStoreLocale(value: unknown): value is StoreLocale {
  return typeof value === "string" && (STORE_LOCALES as readonly string[]).includes(value);
}

export function textDirection(locale: StoreLocale): "rtl" | "ltr" {
  return STORE_LOCALE_INFO[locale].direction;
}

/**
 * The languages a store serves: its primary first, then every other enabled
 * language in registry order. The primary is always included, unknown or
 * repeated entries are dropped — a stored list can never take the primary
 * language away or add one the platform does not support.
 */
export function storeLocales(primary: StoreLocale, enabled: readonly unknown[] | null | undefined): StoreLocale[] {
  const wanted = new Set<StoreLocale>((enabled ?? []).filter(isStoreLocale));
  return [primary, ...STORE_LOCALES.filter((locale) => locale !== primary && wanted.has(locale))];
}

/** Read `stores.enabled_locales_json`; anything but a JSON array reads as "none stored". */
export function parseEnabledLocales(json: string | null | undefined): unknown[] | null {
  if (!json) return null;
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Where to look, in order, when serving `requested` in a store: the requested
 * language, the store's primary, then the platform default — each once.
 */
export function localeChain(requested: StoreLocale, primary: StoreLocale): StoreLocale[] {
  return [...new Set<StoreLocale>([requested, primary, DEFAULT_STORE_LOCALE])];
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
