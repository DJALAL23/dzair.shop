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
  store: {
    announcementBar: { kind: "text", maxLength: 500 },
    metaTitle: { kind: "text", maxLength: 200 },
    metaDescription: { kind: "text", maxLength: 500 },
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

/** One field of a resource as an editor sees it, per language. */
export interface TranslationView {
  /** The resource's own text, in the store's primary language. */
  source: Record<string, string | null>;
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
  for (const key of Object.keys(TRANSLATABLE[resource])) {
    const value = record[key];
    source[key] = typeof value === "string" ? value : null;
    digests.set(key, await sourceDigest(source[key]));
  }
  const view: TranslationView = { source, translations: {} };
  for (const row of rows) {
    if (!digests.has(row.key)) continue;
    const fields = (view.translations[row.locale] ??= {});
    fields[row.key] = { value: row.value, outdated: row.sourceDigest !== digests.get(row.key) };
  }
  return view;
}
