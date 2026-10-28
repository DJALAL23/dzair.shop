import { getTableName, like, sql, type Column } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import type { AppDb, StoreDb } from "../db/client";
import {
  landingPageImages,
  pageDocuments,
  productCategories,
  productImages,
  products,
  reviewMedia,
  storeContentOverrides,
  storePageTranslations,
  storeThemeSettings,
  stores,
  themeDraftParts,
  themePublications,
  translations,
} from "../db/schema";
import { imageKeysInText } from "../lib/orphan-images";

type BatchStatement = Parameters<AppDb["batch"]>[0][number];

/**
 * Every column that can show a stored image, in one place: a missed source
 * means live merchant media gets deleted, by the orphan sweep or when a
 * product is removed. Theme data holds images as media keys in JSON — an
 * `image` field's `{ key }` in a page document or a theme setting, live, in a
 * draft not yet published, or in a publication kept as a restore point
 * (ADR 0010). Uploads share the `products/` namespace whatever they
 * are for (gallery, inline description images, category images, logos), and
 * landing pages keep theirs under `landing/`, shared by duplicated pages.
 *
 * A source is matched as text, so a key is protected whether it is stored
 * bare or inside a URL or an HTML or JSON document. A new uploader, or a new
 * column that can hold an image, must be added here.
 */
export const IMAGE_REFERENCE_SOURCES: ReadonlyArray<{ table: SQLiteTable; column: Column }> = [
  { table: productImages, column: productImages.r2Key },
  { table: productImages, column: productImages.src },
  { table: products, column: products.description },
  { table: productCategories, column: productCategories.imageUrl },
  { table: translations, column: translations.value },
  { table: storePageTranslations, column: storePageTranslations.bodyHtml },
  { table: pageDocuments, column: pageDocuments.document },
  { table: storeContentOverrides, column: storeContentOverrides.value },
  { table: storeThemeSettings, column: storeThemeSettings.values },
  { table: themeDraftParts, column: themeDraftParts.value },
  { table: themePublications, column: themePublications.state },
  { table: stores, column: stores.logoUrl },
  { table: stores, column: stores.ogImage },
  { table: landingPageImages, column: landingPageImages.r2Key },
  { table: landingPageImages, column: landingPageImages.src },
  { table: productImages, column: productImages.mediaKey },
  { table: landingPageImages, column: landingPageImages.mediaKey },
  { table: productCategories, column: productCategories.imageKey },
  { table: stores, column: stores.logoKey },
  { table: stores, column: stores.ogImageKey },
  { table: reviewMedia, column: reviewMedia.mediaKey },
  { table: reviewMedia, column: reviewMedia.thumbKey },
  { table: reviewMedia, column: reviewMedia.r2Key },
];

/**
 * Every `products/` key still referenced by stored data — the orphan sweep's
 * keep-list. One read per source in a single batch: D1 caps how many terms a
 * compound SELECT may have, so they are not one UNION.
 */
export async function collectReferencedImageKeys(db: AppDb): Promise<Set<string>> {
  const reads = IMAGE_REFERENCE_SOURCES.map(({ table, column }) =>
    db.select({ v: sql<string | null>`${column}` }).from(table).where(like(column, "%products/%")),
  );
  const results = (await db.batch(reads as unknown as [BatchStatement, ...BatchStatement[]])) as unknown as Array<Array<{ v: string | null }>>;
  const keys = new Set<string>();
  for (const rows of results) for (const row of rows) for (const key of imageKeysInText(row.v)) keys.add(key);
  return keys;
}

/**
 * The keys, among `keys`, that stored data still shows somewhere — one query,
 * whatever the number of keys. What is not returned is safe to delete.
 */
export async function stillReferencedImageKeys(db: StoreDb, keys: readonly string[]): Promise<Set<string>> {
  if (keys.length === 0) return new Set();
  const used = sql.join(
    IMAGE_REFERENCE_SOURCES.map(({ table, column }) => {
      const name = sql.identifier(getTableName(table));
      return sql`exists (select 1 from ${name} where instr(${name}.${sql.identifier(column.name)}, k.value) > 0)`;
    }),
    sql` or `,
  );
  const rows = await db.values<[string]>(sql`select k.value from json_each(${JSON.stringify([...new Set(keys)])}) k where ${used}`);
  return new Set(rows.map(([key]) => key));
}
