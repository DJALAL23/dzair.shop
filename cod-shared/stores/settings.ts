/**
 * A store's settings and languages as the dashboard and storefront see them.
 * Pure — no database access — so every caller (route handlers, tests, future
 * editors) shares one set of rules (ADR 0005).
 *
 * The rules, after Shopify's shop locales: a store has one primary language
 * (`stores.lang`), always published; any other language it has added is
 * published (shown to shoppers) or not (being translated).
 */
import type { stores } from "../db/schema";
import { STORE_LOCALE_INFO, isStoreLocale, orderLocales, type StoreLocale, type StoreLocaleInfo } from "../i18n/locales";

type StoreRow = typeof stores.$inferSelect;

/** One stored `store_locales` row, as written. */
export interface LocaleRow {
  locale: StoreLocale;
  published: boolean;
}

/** A language as the dashboard lists it. */
export interface StoreLanguage extends LocaleRow {
  primary: boolean;
}

/**
 * The columns the dashboard no longer edits: a store's colors and font are
 * its theme's settings now (`store_theme_settings`). The columns stay, frozen,
 * only because `/store/config` must keep sending them to @wocart/storefront
 * up to 1.7, which requires them.
 */
type ThemePresentationColumns = "primaryColor" | "accentColor" | "bgColor" | "fontFamily";

export type StoreSettings = Omit<StoreRow, ThemePresentationColumns> & { languages: StoreLanguage[] };

/**
 * The store's languages: the primary first and always published, then the
 * others in registry order. Unknown codes are dropped, so a stray row can
 * never add a language the platform does not support or hide the primary.
 */
export function storeLanguages(
  primary: StoreLocale,
  rows: readonly { locale: string; published: boolean }[],
): StoreLanguage[] {
  const published = new Map<StoreLocale, boolean>();
  for (const row of rows) if (isStoreLocale(row.locale)) published.set(row.locale, row.published);
  return orderLocales(primary, [...published.keys()]).map((locale) => ({
    locale,
    published: locale === primary || published.get(locale) === true,
    primary: locale === primary,
  }));
}

/** What shoppers are served: the published languages, primary first. */
export function servedLocales(languages: readonly StoreLanguage[]): StoreLocale[] {
  return languages.filter((language) => language.published).map((language) => language.locale);
}

/** The served languages as a storefront needs them: code, name, direction. */
export function servedLanguageInfo(languages: readonly StoreLanguage[]): StoreLocaleInfo[] {
  return servedLocales(languages).map((locale) => STORE_LOCALE_INFO[locale]);
}

/**
 * The language a storefront read is served in: the requested one when the
 * store publishes it, otherwise the primary — never an error, so a stale link
 * to an unpublished language still renders. `translate` names the language
 * to overlay translations from, and is null for the primary, whose text the
 * source columns already hold.
 */
export function servedLocale(
  requested: string | null | undefined,
  languages: readonly StoreLanguage[],
): { locale: StoreLocale; primary: StoreLocale; translate: StoreLocale | null } {
  const primary = languages.find((language) => language.primary)!.locale;
  const match = languages.find((language) => language.published && language.locale === requested);
  if (match === undefined || match.locale === primary) return { locale: primary, primary, translate: null };
  return { locale: match.locale, primary, translate: match.locale };
}

export function toStoreSettings(
  row: StoreRow,
  localeRows: readonly { locale: string; published: boolean }[],
): StoreSettings {
  const { primaryColor: _primary, accentColor: _accent, bgColor: _bg, fontFamily: _font, ...settings } = row;
  return { ...settings, languages: storeLanguages(row.lang, localeRows) };
}

/** What a settings save may change about languages, beside the plain columns. */
export interface StoreLanguageInput {
  lang?: StoreLocale;
  /** The store's whole language list; replaces the stored one. */
  languages?: readonly LocaleRow[];
}

export type LanguagePlan =
  | { ok: true; rows: LocaleRow[] | null }
  | { ok: false; reason: "primary-not-published" };

/**
 * The `store_locales` rows a settings save leaves behind, or `null` when it
 * does not touch languages.
 *
 * - A `languages` list replaces the stored one, and must publish the primary
 *   (the new one when `lang` changes in the same save): a list that would
 *   leave shoppers without the store's own language is refused, never fixed
 *   up silently.
 * - `lang` alone keeps every language and publishes the new primary.
 */
export function planStoreLanguages(
  input: StoreLanguageInput,
  current: { lang: StoreLocale; rows: readonly LocaleRow[] },
): LanguagePlan {
  if (input.lang === undefined && input.languages === undefined) return { ok: true, rows: null };
  const primary = input.lang ?? current.lang;
  if (input.languages !== undefined) {
    const wanted = new Map(input.languages.map((row) => [row.locale, row.published]));
    if (wanted.get(primary) !== true) return { ok: false, reason: "primary-not-published" };
    return { ok: true, rows: rowsOf(storeLanguages(primary, input.languages)) };
  }
  return { ok: true, rows: rowsOf(storeLanguages(primary, current.rows)) };
}

const rowsOf = (languages: readonly StoreLanguage[]): LocaleRow[] =>
  languages.map(({ locale, published }) => ({ locale, published }));
