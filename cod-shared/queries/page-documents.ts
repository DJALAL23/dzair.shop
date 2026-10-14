/**
 * A store's saved page document — the read side (migration 0033).
 *
 * The document is written by CodFlow Cloud's editor; this repository only reads
 * it. A store that has never saved one, or whose saved row is not a document
 * for this surface, has none: the theme then renders its own default.
 */
import { and, eq } from "drizzle-orm";
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

export async function getPageDocument(
  db: AppDb,
  storeId: string,
  surface: string,
): Promise<StoredPageDocument | null> {
  const row = await db
    .select({ document: pageDocuments.document })
    .from(pageDocuments)
    .where(and(eq(pageDocuments.storeId, storeId), eq(pageDocuments.surface, surface)))
    .get();
  if (!row) return null;

  try {
    const parsed: unknown = JSON.parse(row.document);
    return isDocumentFor(parsed, surface) ? parsed : null;
  } catch {
    return null;
  }
}
