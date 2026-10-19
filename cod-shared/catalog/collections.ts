/**
 * Collections — lists of products the merchant curates by hand ("Featured",
 * "Best sellers", "New arrivals", "Ramadan picks"), like Shopify's manual
 * collections. A theme section names one by handle (`@wocart/theme`'s
 * `collection` setting kind, whose pattern mirrors this one under
 * `scripts/check-platform-parity.mjs`) and shows its products in order.
 *
 * Every store starts with the three collections of `DEFAULT_COLLECTIONS`,
 * empty but for `featured`, which holds what the old `storeFeatured` flag
 * marked (migration 0049). `featured` also answers the deprecated
 * `storeFeatured` field of published SDKs.
 */
import { STORE_LOCALES, type StoreLocale } from "../i18n/locales";
import { sourceDigest } from "../i18n/translations";

export const COLLECTION_HANDLE_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** At most this many products in one collection. */
export const COLLECTION_MAX_PRODUCTS = 500;

/** The collection whose members published SDKs read as `storeFeatured`. */
export const FEATURED_COLLECTION = "featured";

type Localized = Record<StoreLocale, string>;

export const DEFAULT_COLLECTIONS: readonly { handle: string; title: Localized }[] = [
  { handle: FEATURED_COLLECTION, title: { ar: "منتجات مميزة", fr: "En vedette", en: "Featured" } },
  { handle: "best-sellers", title: { ar: "الأكثر مبيعاً", fr: "Meilleures ventes", en: "Best sellers" } },
  { handle: "new-arrivals", title: { ar: "وصل حديثاً", fr: "Nouveautés", en: "New arrivals" } },
];

const q = (value: string) => `'${value.replace(/'/g, "''")}'`;

/**
 * The statements that give a store its default collections, titles in its
 * primary language and translated into every other one. A collection the
 * store already has under the handle is left as it is; translations are
 * written only for a collection this run (`now`) created.
 */
export async function defaultCollectionsSql(store: { id: string; lang: StoreLocale }, now: string): Promise<string[]> {
  const others = STORE_LOCALES.filter((locale) => locale !== store.lang);
  const statements: string[] = [];
  for (const collection of DEFAULT_COLLECTIONS) {
    const id = `${store.id}:collection:${collection.handle}`;
    const source = collection.title[store.lang];
    statements.push(
      `INSERT OR IGNORE INTO collections (id, store_id, handle, title, created_at, updated_at) VALUES (${q(id)}, ${q(store.id)}, ${q(collection.handle)}, ${q(source)}, ${q(now)}, ${q(now)})`,
    );
    const digest = await sourceDigest(source);
    for (const locale of others) {
      statements.push(
        `INSERT OR IGNORE INTO translations (resource_type, resource_id, locale, key, value, source_digest, updated_at) SELECT 'collection', ${q(id)}, ${q(locale)}, 'title', ${q(collection.title[locale])}, ${q(digest)}, ${q(now)} WHERE (SELECT created_at FROM collections WHERE id = ${q(id)}) = ${q(now)}`,
      );
    }
  }
  return statements;
}
