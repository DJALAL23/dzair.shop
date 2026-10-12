/**
 * A store's overrides of its theme's storefront text, one map per language
 * (ADR 0005): `{ "ar": { "heroTitle": "…" }, "fr": { "heroTitle": "…" } }`.
 *
 * The theme owns the vocabulary (its content pack's keys); the store owns the
 * values. Stored as JSON in `stores.content_overrides_json`. Switching or adding
 * a language never mixes languages: each language reads only its own map.
 */
import { STORE_LOCALES, type StoreLocale } from "./locales";

export type ContentOverrides = Partial<Record<StoreLocale, Record<string, string>>>;

/** Caps that keep one store row small; a pack has a few hundred keys. */
export const CONTENT_OVERRIDE_LIMITS = { keysPerLocale: 1000, keyLength: 100, valueLength: 5000 } as const;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Read the stored column. Never throws: malformed JSON, unknown languages,
 * non-string values, over-long entries and `__proto__` are dropped, so a bad
 * row degrades to the theme's pack instead of breaking a storefront.
 */
export function parseContentOverrides(json: string | null | undefined): ContentOverrides {
  if (!json) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return {};
  }
  if (!isPlainObject(parsed)) return {};
  const result: ContentOverrides = {};
  for (const locale of STORE_LOCALES) {
    const entries = Object.hasOwn(parsed, locale) ? parsed[locale] : undefined;
    if (!isPlainObject(entries)) continue;
    const kept: Record<string, string> = {};
    let count = 0;
    for (const [key, value] of Object.entries(entries)) {
      if (count >= CONTENT_OVERRIDE_LIMITS.keysPerLocale) break;
      if (
        key === "__proto__" ||
        key.length === 0 ||
        key.length > CONTENT_OVERRIDE_LIMITS.keyLength ||
        typeof value !== "string" ||
        value.length > CONTENT_OVERRIDE_LIMITS.valueLength
      ) {
        continue;
      }
      kept[key] = value;
      count += 1;
    }
    result[locale] = kept;
  }
  return result;
}

/** Only the languages a store serves reach its storefront. */
export function overridesForLocales(
  overrides: ContentOverrides,
  locales: readonly StoreLocale[],
): ContentOverrides {
  const result: ContentOverrides = {};
  for (const locale of locales) {
    const entries = overrides[locale];
    if (entries !== undefined) result[locale] = entries;
  }
  return result;
}
