/**
 * A store's edits to a theme's storefront text, per theme and per language
 * (ADR 0005): the merchant's wording for a key the theme's content pack
 * declares, such as `heroTitle`.
 *
 * Like Shopify's theme content, edits belong to the theme that declared the
 * key: switching themes never applies one theme's wording to another theme's
 * keys. Stored one row per key (`store_content_overrides`), so two editors
 * changing different keys never overwrite each other.
 */
import type { StoreLocale } from "./locales";

/** One language's edits: key → text. */
export type LocaleOverrides = Record<string, string>;

/** Every served language's edits: `{ ar: { heroTitle: "…" } }`. */
export type ContentOverrides = Partial<Record<StoreLocale, LocaleOverrides>>;

/** A pack has a few hundred keys; the caps leave room and bound one read. */
export const CONTENT_OVERRIDE_LIMITS = { keysPerLocale: 1000, keyLength: 100, valueLength: 5000 } as const;

/**
 * A theme's key (`defineTheme({ key })` in `@codflow/theme`): lowercase
 * kebab-case, at most 64 characters. Mirrored by `@codflow/theme` and guarded
 * by `scripts/check-platform-parity.mjs`.
 */
export const THEME_KEY_RE = /^(?=.{1,64}$)[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

export function isThemeKey(value: unknown): value is string {
  return typeof value === "string" && THEME_KEY_RE.test(value);
}

/** Whether `key` may name an override: non-empty, bounded, never a prototype key. */
export function isOverrideKey(key: string): boolean {
  return key.length > 0 && key.length <= CONTENT_OVERRIDE_LIMITS.keyLength && key !== "__proto__";
}

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

/**
 * Apply a JSON Merge Patch (RFC 7396) to one language's edits: a string sets
 * the key, `null` removes it, an absent key is untouched. Returns the keys to
 * write and to delete, and the language's key count afterwards so a caller can
 * enforce `keysPerLocale` before writing anything.
 */
export function planOverridePatch(
  existingKeys: readonly string[],
  patch: Readonly<Record<string, string | null>>,
): { set: [string, string][]; remove: string[]; keyCount: number } {
  const keys = new Set(existingKeys);
  const set: [string, string][] = [];
  const remove: string[] = [];
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      if (keys.delete(key)) remove.push(key);
    } else {
      keys.add(key);
      set.push([key, value]);
    }
  }
  return { set, remove, keyCount: keys.size };
}
