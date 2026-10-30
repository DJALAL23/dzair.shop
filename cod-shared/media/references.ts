/**
 * Every place stored data can show a file, in one place: a missed one means
 * a shown file gets deleted, by a release or the sweep. Columns hold Media
 * Keys; rich text holds `media:<key>`; theme data holds keys in JSON — an
 * `image` field's `{ key }` in a page document or a theme setting, live, in a
 * draft not yet published, or in a publication kept as a restore point
 * (ADR 0010). A source is matched as text, so a key is protected wherever in
 * the value it sits. A new column or document that can show a file must be
 * added here.
 */
import { getTableName, sql, type Column } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import type { StoreDb } from "../db/client";
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

export const MEDIA_REFERENCES: ReadonlyArray<{ table: SQLiteTable; column: Column }> = [
  { table: productImages, column: productImages.mediaKey },
  { table: landingPageImages, column: landingPageImages.mediaKey },
  { table: productCategories, column: productCategories.imageKey },
  { table: stores, column: stores.logoKey },
  { table: stores, column: stores.ogImageKey },
  { table: reviewMedia, column: reviewMedia.mediaKey },
  { table: reviewMedia, column: reviewMedia.thumbKey },
  { table: products, column: products.description },
  { table: translations, column: translations.value },
  { table: storePageTranslations, column: storePageTranslations.bodyHtml },
  { table: pageDocuments, column: pageDocuments.document },
  { table: storeContentOverrides, column: storeContentOverrides.value },
  { table: storeThemeSettings, column: storeThemeSettings.values },
  { table: themeDraftParts, column: themeDraftParts.value },
  { table: themePublications, column: themePublications.state },
];

/** The keys, among `keys`, that stored data still shows — one query, whatever their number. What is not returned is safe to delete. */
export async function shownKeys(db: StoreDb, keys: readonly string[]): Promise<Set<string>> {
  if (keys.length === 0) return new Set();
  const shown = sql.join(
    MEDIA_REFERENCES.map(({ table, column }) => {
      const name = sql.identifier(getTableName(table));
      return sql`exists (select 1 from ${name} where instr(${name}.${sql.identifier(column.name)}, k.value) > 0)`;
    }),
    sql` or `,
  );
  const rows = await db.values<[string]>(sql`select k.value from json_each(${JSON.stringify([...new Set(keys)])}) k where ${shown}`);
  return new Set(rows.map(([key]) => key));
}
