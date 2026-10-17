/**
 * Translations of merchant data — the single declaration of what can be
 * translated and the rules every reader and writer shares (ADR 0005, phase C).
 *
 * Shopify's Translations API model: a translation belongs to one resource,
 * one language and one **key** (a translatable field), and records a digest
 * of the source text it was written against. When the merchant later changes
 * the source, the translation is *outdated* — still served, flagged for the
 * editor. A field with no translation falls back to the source, one field at
 * a time, so a store can translate titles first and descriptions later.
 *
 * The source (the resource's own column) is always in the store's primary
 * language; a translation exists only for the other languages.
 */
import { RICH_TEXT_MAX_CHARS } from "../lib/rich-text";
import type { StoreLocale } from "./locales";

/** A product's variant option, as `products.variant_options` stores it. */
export interface VariantOption {
  name: string;
  values: { value: string; hexColor?: string | null }[];
}

export interface TranslatableField {
  /** `html` is sanitised at the write chokepoint, exactly like its source. */
  kind: "text" | "html";
  maxLength: number;
}

/**
 * Every translatable field, by resource type. Keys are the resource's own
 * field names, so a translation overlays its source by name. Caps match the
 * source's write validation where it has one, and bound the rest (titles at
 * 255, Shopify's product and collection title limit).
 */
export const TRANSLATABLE = {
  product: {
    name: { kind: "text", maxLength: 255 },
    description: { kind: "html", maxLength: RICH_TEXT_MAX_CHARS },
  },
  category: {
    name: { kind: "text", maxLength: 255 },
    description: { kind: "text", maxLength: 5000 },
    metaTitle: { kind: "text", maxLength: 60 },
    metaDescription: { kind: "text", maxLength: 160 },
  },
  offer: {
    name: { kind: "text", maxLength: 200 },
  },
  menuItem: {
    label: { kind: "text", maxLength: 100 },
  },
  collection: {
    title: { kind: "text", maxLength: 100 },
    description: { kind: "text", maxLength: 1000 },
  },
  store: {
    metaTitle: { kind: "text", maxLength: 200 },
    metaDescription: { kind: "text", maxLength: 500 },
    /** "دج" in Arabic reads "DA" in French and English. */
    currencySymbol: { kind: "text", maxLength: 10 },
  },
} as const satisfies Record<string, Record<string, TranslatableField>>;

export type TranslatableResource = keyof typeof TRANSLATABLE;
export type TranslatableKey<R extends TranslatableResource> = keyof (typeof TRANSLATABLE)[R] & string;

export const TRANSLATABLE_RESOURCES = Object.keys(TRANSLATABLE) as TranslatableResource[];

export function translatableField(resource: TranslatableResource, key: string): TranslatableField | null {
  const fields: Readonly<Record<string, TranslatableField>> = TRANSLATABLE[resource];
  return Object.hasOwn(fields, key) ? fields[key]! : null;
}

/**
 * Variant options — Shopify's ProductOption and ProductOptionValue — are
 * translated on their product. An option has no id of its own, so its
 * translations are keyed by its source text: `option:["Color"]` for the
 * option's name, `option:["Color","Red"]` for one of its values. JSON keeps
 * the key unambiguous whatever the text holds. A renamed option or value is a
 * new key; the product's writer prunes the keys its options no longer have.
 */
export const OPTION_TEXT: TranslatableField = { kind: "text", maxLength: 255 };

export const OPTION_KEY_PREFIX = "option:";

export function optionKey(name: string, value?: string): string {
  return OPTION_KEY_PREFIX + JSON.stringify(value === undefined ? [name] : [name, value]);
}

/** A product's variant options from its stored JSON; malformed or absent reads as none. */
export function parseVariantOptions(raw: unknown): VariantOption[] {
  let parsed = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(
    (option): option is VariantOption =>
      typeof option?.name === "string" &&
      Array.isArray(option.values) &&
      option.values.every((value: unknown) => typeof (value as VariantOption["values"][number])?.value === "string"),
  );
}

/** One field of one record a translation can target: its key, its rules and its source text. */
export interface TranslatableSource {
  key: string;
  field: TranslatableField;
  source: string | null;
}

/** Every field of `record` a translation can target: the registry's, and a product's option names and values. */
export function translatableSources(
  resource: TranslatableResource,
  record: Readonly<Record<string, unknown>>,
): TranslatableSource[] {
  const fields: TranslatableSource[] = Object.entries(TRANSLATABLE[resource] as Record<string, TranslatableField>).map(
    ([key, field]) => {
      const value = record[key];
      return { key, field, source: typeof value === "string" ? value : null };
    },
  );
  if (resource !== "product") return fields;
  for (const option of parseVariantOptions(record.variantOptions)) {
    fields.push({ key: optionKey(option.name), field: OPTION_TEXT, source: option.name });
    for (const { value } of option.values) {
      fields.push({ key: optionKey(option.name, value), field: OPTION_TEXT, source: value });
    }
  }
  return fields;
}

/**
 * The options whose translations would read the same as a sibling — two
 * option names, or two values of one option — and so could not be told apart
 * by a shopper. `null` stands for the option names; a string names the option
 * whose values collide.
 */
export function indistinctOptions(
  options: readonly VariantOption[],
  translated: Readonly<Record<string, string>>,
): (string | null)[] {
  const text = (key: string, source: string) => (Object.hasOwn(translated, key) ? translated[key]! : source);
  const distinct = (sources: string[], served: string[]) => new Set(served).size === new Set(sources).size;
  const issues: (string | null)[] = [];
  const names = options.map((option) => option.name);
  if (!distinct(names, options.map((option) => text(optionKey(option.name), option.name)))) issues.push(null);
  for (const option of options) {
    const values = option.values.map(({ value }) => value);
    if (!distinct(values, values.map((value) => text(optionKey(option.name, value), value)))) issues.push(option.name);
  }
  return issues;
}

/**
 * A product's variant options in one language, and the same renaming for its
 * variants' `variations`, so a storefront that matches a variant to the
 * shopper's choice still finds it. A translation that would make two option
 * names, or two values of one option, read the same is not applied: that set
 * keeps its source text.
 */
export function translateOptions(
  options: readonly VariantOption[],
  translated: Readonly<Record<string, string>>,
): { options: VariantOption[]; variations: (variations: Readonly<Record<string, string>>) => Record<string, string> } {
  const indistinct = new Set(indistinctOptions(options, translated));
  const text = (key: string, source: string) => (Object.hasOwn(translated, key) ? translated[key]! : source);
  const names = new Map(
    options.map((option) => [option.name, indistinct.has(null) ? option.name : text(optionKey(option.name), option.name)]),
  );
  const values = new Map(
    options.map((option) => [
      option.name,
      new Map(
        option.values.map(({ value }) => [
          value,
          indistinct.has(option.name) ? value : text(optionKey(option.name, value), value),
        ]),
      ),
    ]),
  );
  return {
    options: options.map((option) => ({
      ...option,
      name: names.get(option.name)!,
      values: option.values.map((entry) => ({ ...entry, value: values.get(option.name)!.get(entry.value)! })),
    })),
    variations: (variations) =>
      Object.fromEntries(
        Object.entries(variations).map(([name, value]) => [
          names.get(name) ?? name,
          values.get(name)?.get(value) ?? value,
        ]),
      ),
  };
}

/** A variant's label, its option values in order: "Red / XL". */
export function variantLabel(variations: Readonly<Record<string, string>>): string {
  return Object.values(variations).join(" / ");
}

/**
 * The digest a translation records of its source text: SHA-256 hex. An
 * empty or missing source digests like the empty string, so translating a
 * field the merchant has not filled yet is still well defined.
 */
export async function sourceDigest(source: string | null | undefined): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source ?? ""));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** One stored translation, as the overlay reads it. */
export interface TranslationRow {
  resourceId: string;
  key: string;
  value: string;
}

/**
 * Overlay translations on resources, field by field: a key with a
 * translation takes it, every other field keeps its source. Keys the
 * registry does not declare for `resource` are ignored, so a stray row can
 * never overwrite a non-translatable field (a price, an id).
 */
export function overlayTranslations<T extends { id: string }>(
  resource: TranslatableResource,
  records: readonly T[],
  rows: readonly TranslationRow[],
): T[] {
  if (rows.length === 0) return [...records];
  const byResource = new Map<string, Record<string, string>>();
  for (const row of rows) {
    if (translatableField(resource, row.key) === null) continue;
    const fields = byResource.get(row.resourceId) ?? {};
    fields[row.key] = row.value;
    byResource.set(row.resourceId, fields);
  }
  return records.map((record) => {
    const fields = byResource.get(record.id);
    return fields === undefined ? record : { ...record, ...fields };
  });
}

/** One resource as an editor sees it: its source fields and every language's translations. */
export interface TranslationView {
  /** The resource's own text, in the store's primary language. */
  source: Record<string, string | null>;
  /**
   * A product's variant options and the keys that translate them, so an
   * editor can show each value under its option. Empty for other resources.
   */
  options: { name: string; key: string; values: { value: string; key: string }[] }[];
  /**
   * Every language's translations. `outdated` is true when the source has
   * changed since the translation was written — still served, but due for
   * the translator's attention (Shopify's `Translation.outdated`).
   */
  translations: Partial<Record<StoreLocale, Record<string, { value: string; outdated: boolean }>>>;
}

/** The editor's view of one resource: its source fields and every stored translation. */
export async function translationView(
  resource: TranslatableResource,
  record: Readonly<Record<string, unknown>>,
  rows: readonly { locale: StoreLocale; key: string; value: string; sourceDigest: string }[],
): Promise<TranslationView> {
  const source: Record<string, string | null> = {};
  const digests = new Map<string, string>();
  for (const field of translatableSources(resource, record)) {
    source[field.key] = field.source;
    digests.set(field.key, await sourceDigest(field.source));
  }
  const options =
    resource === "product"
      ? parseVariantOptions(record.variantOptions).map((option) => ({
          name: option.name,
          key: optionKey(option.name),
          values: option.values.map(({ value }) => ({ value, key: optionKey(option.name, value) })),
        }))
      : [];
  const view: TranslationView = { source, options, translations: {} };
  for (const row of rows) {
    if (!digests.has(row.key)) continue;
    const fields = (view.translations[row.locale] ??= {});
    fields[row.key] = { value: row.value, outdated: row.sourceDigest !== digests.get(row.key) };
  }
  return view;
}
