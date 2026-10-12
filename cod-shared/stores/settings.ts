/**
 * The store row as settings: what the dashboard reads and how a settings save
 * becomes a column update. Pure — no database access — so every caller (route
 * handlers, tests, future editors) shares one mapping.
 */
import type { stores } from "../db/schema";
import { parseContentOverrides, type ContentOverrides } from "../i18n/content-overrides";
import { parseEnabledLocales, storeLocales, type StoreLocale } from "../i18n/locales";

type StoreUpdate = Partial<typeof stores.$inferInsert>;
type StoreRow = typeof stores.$inferSelect;

/**
 * The store as the dashboard sees it: the language columns parsed, never raw
 * JSON. `enabledLocales` always starts with the primary language.
 */
export type StoreSettings = Omit<StoreRow, "enabledLocalesJson" | "contentOverridesJson"> & {
  enabledLocales: StoreLocale[];
  contentOverrides: ContentOverrides;
};

/** What a settings save may change about languages, beside the plain columns. */
export interface StoreLanguageInput {
  lang?: StoreLocale;
  enabledLocales?: readonly StoreLocale[];
  contentOverrides?: ContentOverrides;
}

export function toStoreSettings(row: StoreRow): StoreSettings {
  const { enabledLocalesJson, contentOverridesJson, ...settings } = row;
  return {
    ...settings,
    enabledLocales: storeLocales(row.lang, parseEnabledLocales(enabledLocalesJson)),
    contentOverrides: parseContentOverrides(contentOverridesJson),
  };
}

/**
 * The column update for a settings save. The primary language is always
 * served: changing `lang` adds it to the enabled languages, and an
 * `enabledLocales` list that leaves it out gets it back. `contentOverrides`
 * replaces the whole map, like every other settings object.
 */
export function storeSettingsUpdate<T extends StoreLanguageInput>(
  input: T,
  current: Pick<StoreRow, "lang" | "enabledLocalesJson">,
): Omit<T, "enabledLocales" | "contentOverrides"> & StoreUpdate {
  const { enabledLocales, contentOverrides, ...columns } = input;
  const update: Omit<T, "enabledLocales" | "contentOverrides"> & StoreUpdate = { ...columns };
  if (input.lang !== undefined || enabledLocales !== undefined) {
    const primary = input.lang ?? current.lang;
    const wanted = enabledLocales ?? storeLocales(current.lang, parseEnabledLocales(current.enabledLocalesJson));
    update.enabledLocalesJson = JSON.stringify(storeLocales(primary, wanted));
  }
  if (contentOverrides !== undefined) {
    update.contentOverridesJson = JSON.stringify(contentOverrides);
  }
  return update;
}
