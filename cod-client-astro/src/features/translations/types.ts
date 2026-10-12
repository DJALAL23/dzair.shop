import type { StoreLocale } from "../../../../cod-shared/i18n/locales";
import type { TranslatableResource } from "../../../../cod-shared/i18n/translations";

export type { StoreLocale, TranslatableResource };

/** `GET …/translations` — a resource's source text and every stored translation. */
export interface TranslationView {
  resource: TranslatableResource;
  id: string;
  /** The store's primary language: the language of `source`. */
  sourceLocale: StoreLocale;
  /** The languages this resource can be translated into, published or not. */
  targetLocales: { locale: StoreLocale; published: boolean }[];
  source: Record<string, string | null>;
  /** A product's variant options and the keys that translate them; empty for other resources. */
  options: { name: string; key: string; values: { value: string; key: string }[] }[];
  translations: Partial<Record<StoreLocale, Record<string, { value: string; outdated: boolean }>>>;
}

/** `PATCH …/translations` — a JSON Merge Patch of one language. */
export interface TranslationPatch {
  locale: StoreLocale;
  values: Record<string, string | null>;
}
