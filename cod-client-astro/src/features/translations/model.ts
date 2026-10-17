/**
 * Translation editing — everything that isn't a fetch. What can be translated,
 * and every rule about it, lives in cod-shared/i18n/translations.ts; this file
 * only decides how an editor shows and saves it.
 */
import { STORE_LOCALE_INFO } from "../../../../cod-shared/i18n/locales";
import { OPTION_TEXT, TRANSLATABLE, type TranslatableField } from "../../../../cod-shared/i18n/translations";
import type { StoreLocale, TranslatableResource, TranslationPatch, TranslationView } from "./types";

/** The route that serves a resource's translations, from its own router. */
export function translationsPath(resource: TranslatableResource, id: string): string {
  const encoded = encodeURIComponent(id);
  switch (resource) {
    case "product":
      return `/api/products/${encoded}/translations`;
    case "category":
      return `/api/product-groups/${encoded}/translations`;
    case "offer":
      return `/api/offers/${encoded}/translations`;
    case "store":
      return "/api/stores/me/translations";
    case "menuItem":
      return `/api/menus/items/${encoded}/translations`;
  }
}

export interface TranslationFieldSpec extends TranslatableField {
  key: string;
  /** A plain-text field longer than a title gets a textarea; an `html` field gets the rich editor. */
  control: "input" | "textarea" | "rich";
  /** A field of the resource itself, a variant option's name, or one of its values. */
  part: { kind: "field" } | { kind: "option"; option: string } | { kind: "value"; option: string };
}

/** Every field an editor shows for a resource: its registry fields, then each variant option and its values. */
export function translationFields(view: Pick<TranslationView, "resource" | "options">): TranslationFieldSpec[] {
  const fields: TranslationFieldSpec[] = Object.entries(TRANSLATABLE[view.resource] as Record<string, TranslatableField>).map(
    ([key, field]) => ({
      key,
      ...field,
      control: field.kind === "html" ? "rich" : field.maxLength > 255 ? "textarea" : "input",
      part: { kind: "field" },
    }),
  );
  for (const option of view.options) {
    fields.push({ key: option.key, ...OPTION_TEXT, control: "input", part: { kind: "option", option: option.name } });
    for (const { key } of option.values) {
      fields.push({ key, ...OPTION_TEXT, control: "input", part: { kind: "value", option: option.name } });
    }
  }
  return fields;
}

/** The editable values for one language: its stored translations, "" where there is none. */
export function draftFor(view: TranslationView, locale: StoreLocale): Record<string, string> {
  const stored = view.translations[locale] ?? {};
  return Object.fromEntries(
    translationFields(view).map(({ key }) => [key, stored[key]?.value ?? ""]),
  );
}

/**
 * The merge patch that turns the stored language into `draft`: changed fields
 * only, a cleared field removes its translation. `null` when nothing changed.
 */
export function patchFor(
  view: TranslationView,
  locale: StoreLocale,
  draft: Readonly<Record<string, string>>,
): TranslationPatch | null {
  const stored = view.translations[locale] ?? {};
  const values: Record<string, string | null> = {};
  for (const { key } of translationFields(view)) {
    const next = (draft[key] ?? "").trim();
    const current = stored[key]?.value ?? "";
    if (next === current.trim()) continue;
    // A field that differs from its stored value and is now empty had a
    // translation: clearing it removes that translation.
    values[key] = next === "" ? null : next;
  }
  return Object.keys(values).length === 0 ? null : { locale, values };
}

/** How many fields of one language still need a translator: missing or outdated. */
export function pendingCount(view: TranslationView, locale: StoreLocale): number {
  const stored = view.translations[locale] ?? {};
  return translationFields(view).filter(({ key }) => {
    const hasSource = (view.source[key] ?? "").trim() !== "";
    const translation = stored[key];
    return hasSource && (translation === undefined || translation.outdated);
  }).length;
}

/** A language's own name and text direction, for its tab and the inputs that hold it. */
export function languageInfo(locale: StoreLocale): { nativeName: string; direction: "rtl" | "ltr" } {
  return STORE_LOCALE_INFO[locale];
}
