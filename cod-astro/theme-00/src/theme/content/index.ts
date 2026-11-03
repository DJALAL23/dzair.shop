/**
 * Content Loader
 * 
 * Loads and resolves content based on language and dashboard overrides.
 * 
 * @example
 * ```typescript
 * import { resolveContent } from "@/theme/content";
 * 
 * const content = resolveContent(config.lang, config.contentOverrides[config.lang]);
 * ```
 */

import { ar } from "./ar";
import { en } from "./en";
import { fr } from "./fr";
import { resolveThemeContent } from "@wocart/theme";
import type { StoreFrontContent } from "./types";

/**
 * Language registry
 * Add new languages here as they become available
 */
const languages = {
  ar,
  en,
  fr,
} as const;

export type SupportedLanguage = keyof typeof languages;

const packs = languages as unknown as Readonly<Record<string, Readonly<Record<string, string>>>>;

/** The pack a store language without its own pack falls back to. */
export const DEFAULT_LANGUAGE: SupportedLanguage = "ar";

/**
 * Resolve content for a given language with optional dashboard overrides
 *
 * @param lang - The store language being rendered. One this theme has no
 *   pack for gets the `DEFAULT_LANGUAGE` pack, as a Shopify theme falls back
 *   to its default locale file.
 * @param overrides - The store's edits for that same language
 *   (`StoreConfig.contentOverrides[lang]`), already parsed by the SDK
 * @returns Complete StoreFrontContent object with all required keys
 * 
 * @example
 * ```typescript
 * // Use default Arabic content
 * const content = resolveContent("ar");
 * 
 * // Use Arabic with the store's Arabic overrides
 * const content = resolveContent("ar", { heroTitle: "Custom Title" });
 * ```
 */
export function resolveContent(
  lang: string,
  overrides?: Readonly<Record<string, unknown>> | null
): StoreFrontContent {
  // The SDK's one policy: only string values for keys the pack declares (the
  // pack owns the vocabulary), so a nested, unknown or non-string edit — a
  // live store once carried `{"hero":{"title":"…"}}` — degrades to the pack.
  return resolveThemeContent({ content: packs }, lang, overrides, { defaultLocale: DEFAULT_LANGUAGE }) as unknown as StoreFrontContent;
}

/**
 * Get list of supported languages
 * 
 * @returns Array of language codes
 */
export function getSupportedLanguages(): SupportedLanguage[] {
  return Object.keys(languages) as SupportedLanguage[];
}

/**
 * Check if a language is supported
 * 
 * @param lang - Language code to check
 * @returns true if language is supported
 */
export function isLanguageSupported(lang: string): lang is SupportedLanguage {
  return Object.hasOwn(languages, lang);
}

// Re-export types for convenience
export type { StoreFrontContent } from "./types";
