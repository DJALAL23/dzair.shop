/**
 * A store's edits to a theme's storefront text, per theme and per language
 * (ADR 0005): the merchant's wording for a key the theme's content pack
 * declares, such as `heroTitle`.
 *
 * Like Shopify's theme content, edits belong to the theme that declared the
 * key: switching themes never applies one theme's wording to another theme's
 * keys. Stored one row per key (`store_content_overrides`).
 *
 * This repository only *reads* them, for the storefront. They are written by
 * CodFlow Cloud's visual editor, which is not part of it.
 */
import type { StoreLocale } from "./locales";

/** One language's edits: key → text. */
export type LocaleOverrides = Record<string, string>;

/** Every served language's edits: `{ ar: { heroTitle: "…" } }`. */
export type ContentOverrides = Partial<Record<StoreLocale, LocaleOverrides>>;

/**
 * A theme's key (`defineTheme({ key })` in `@wocart/theme`): lowercase
 * kebab-case, at most 64 characters. Mirrored by `@wocart/theme` and guarded
 * by `scripts/check-platform-parity.mjs`.
 */
export const THEME_KEY_RE = /^(?=.{1,64}$)[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/**
 * Group stored rows into one map per language, in the order `locales` lists
 * them. Rows for any other language are left out — an unpublished language's
 * drafts never reach a shopper.
 */
export function groupOverrides(
  rows: readonly { locale: string; key: string; value: string }[],
  locales: readonly StoreLocale[],
): ContentOverrides {
  const result: ContentOverrides = {};
  for (const locale of locales) {
    const entries = rows.filter((row) => row.locale === locale).map((row) => [row.key, row.value] as const);
    if (entries.length > 0) result[locale] = Object.fromEntries(entries);
  }
  return result;
}
