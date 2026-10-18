/**
 * A store's saved page document — the read side (migrations 0033, 0054).
 *
 * The document is written by CodFlow Cloud's editor, one per theme and
 * surface; this repository only reads it. A store that has never saved one,
 * or whose saved row is not a document for this surface, has none: the theme
 * then renders its own default.
 */
import { and, desc, eq } from "drizzle-orm";
import { pageDocuments } from "../db/schema";
import type { AppDb } from "../db/client";

/** The PageData envelope, kept verbatim: sections are the theme SDK's to interpret. */
export interface StoredPageDocument {
  version: number;
  surface: string;
  sections: unknown[];
  [key: string]: unknown;
}

function isDocumentFor(value: unknown, surface: string): value is StoredPageDocument {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const doc = value as Record<string, unknown>;
  return Number.isInteger(doc.version) && doc.surface === surface && Array.isArray(doc.sections);
}

/**
 * The document `themeKey` saved for `surface`. A reader that does not name its
 * theme (`@wocart/storefront` before 1.16) gets the most recently saved one for
 * the surface, whichever theme wrote it — the theme's own provenance check
 * then sends another theme's document to its default.
 */
export async function getPageDocument(
  db: AppDb,
  storeId: string,
  surface: string,
  themeKey?: string,
): Promise<StoredPageDocument | null> {
  const row = await db
    .select({ document: pageDocuments.document })
    .from(pageDocuments)
    .where(
      and(
        eq(pageDocuments.storeId, storeId),
        eq(pageDocuments.surface, surface),
        themeKey === undefined ? undefined : eq(pageDocuments.themeKey, themeKey),
      ),
    )
    .orderBy(desc(pageDocuments.updatedAt))
    .limit(1)
    .get();
  if (!row) return null;

  try {
    const parsed: unknown = JSON.parse(row.document);
    return isDocumentFor(parsed, surface) ? parsed : null;
  } catch {
    return null;
  }
}
