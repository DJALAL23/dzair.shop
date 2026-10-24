/** The territories this theme's shoppers are in, per language. */
const OPEN_GRAPH_LOCALES: ReadonlyMap<string, string> = new Map([
  ["ar", "ar_DZ"],
  ["fr", "fr_DZ"],
  ["en", "en_US"],
]);

/**
 * `og:locale` for the language a page is rendered in (language_TERRITORY). A
 * language this theme has no territory for keeps its own tag, underscored.
 */
export function openGraphLocale(locale: string): string {
  return OPEN_GRAPH_LOCALES.get(locale) ?? locale.replace(/-/g, "_");
}
