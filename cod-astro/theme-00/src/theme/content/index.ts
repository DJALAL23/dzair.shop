/**
 * Content Loader
 * 
 * Loads and resolves content based on language and dashboard overrides.
 * 
 * @example
 * ```typescript
 * import { resolveContent } from "@/theme/content";
 * 
 * const content = resolveContent("ar", dashboardContentJson);
 * ```
 */

import { ar } from "./ar";
import { en } from "./en";
import { fr } from "./fr";
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

/**
 * Keep only the overrides the pack actually has a slot for, and only when the
 * value is a string.
 *
 * The overrides are the store language's entry in
 * `StoreConfig.contentOverrides`. They used to be one unvalidated blob, and a
 * live store carried `{"hero":{"title":"…"}}` — a nested shape that matches
 * none of the flat pack keys, so it silently did nothing; unknown keys
 * polluted the resolved object; and a non-string value could reach a
 * component that renders `string`. The override vocabulary IS the pack's key
 * set. Everything else is ignored, never thrown: a malformed entry degrades to
 * the pack instead of breaking the storefront.
 */
function pickStringOverrides(
  defaults: StoreFrontContent,
  overrides: unknown,
): Partial<StoreFrontContent> {
  if (overrides == null || typeof overrides !== "object" || Array.isArray(overrides)) {
    return {};
  }
  const picked: Partial<StoreFrontContent> = {};
  for (const key of Object.keys(defaults) as Array<keyof StoreFrontContent>) {
    const value = (overrides as Record<string, unknown>)[key];
    if (typeof value === "string") picked[key] = value;
  }
  return picked;
}

/**
 * Resolve content for a given language with optional dashboard overrides
 * 
 * @param lang - The language being rendered
 * @param overrides - The store's overrides for that same language
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
  lang: SupportedLanguage,
  overrides?: Readonly<Record<string, unknown>> | null
): StoreFrontContent {
  const defaults = languages[lang] || languages.ar;
  if (!overrides) {
    return defaults;
  }
  // Only string values for keys the pack declares: the pack owns the vocabulary.
  return { ...defaults, ...pickStringOverrides(defaults, overrides) };
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
  return lang in languages;
}

// Re-export types for convenience
export type { StoreFrontContent } from "./types";
