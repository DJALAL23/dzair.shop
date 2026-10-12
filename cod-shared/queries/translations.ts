/**
 * Translations of merchant data — reads and writes (`i18n/translations.ts`).
 */
import { and, eq, inArray } from "drizzle-orm";
import { translations } from "../db/schema";
import type { AppDb } from "../db/client";
import type { StoreLocale } from "../i18n/locales";
import type { TranslatableResource, TranslationRow } from "../i18n/translations";
import { chunkIds } from "./d1-limits";

type BatchStatement = Parameters<AppDb["batch"]>[0][number];

/** One language's translations of many resources of one type — the storefront read. */
export async function listTranslations(
  db: AppDb,
  resource: TranslatableResource,
  resourceIds: readonly string[],
  locale: StoreLocale,
): Promise<TranslationRow[]> {
  const ids = [...new Set(resourceIds)];
  if (ids.length === 0) return [];
  const chunks = await Promise.all(
    chunkIds(ids).map((chunk) =>
      db
        .select({ resourceId: translations.resourceId, key: translations.key, value: translations.value })
        .from(translations)
        .where(
          and(
            eq(translations.resourceType, resource),
            eq(translations.locale, locale),
            inArray(translations.resourceId, chunk),
          ),
        )
        .all(),
    ),
  );
  return chunks.flat();
}

/** Every translation of one resource, every language — the editor read. */
export async function listResourceTranslations(db: AppDb, resource: TranslatableResource, resourceId: string) {
  return db
    .select({
      locale: translations.locale,
      key: translations.key,
      value: translations.value,
      sourceDigest: translations.sourceDigest,
    })
    .from(translations)
    .where(and(eq(translations.resourceType, resource), eq(translations.resourceId, resourceId)))
    .orderBy(translations.locale, translations.key)
    .all();
}

/** Write and remove one language's translations of one resource, in one batch. */
export async function writeTranslations(
  db: AppDb,
  scope: { resource: TranslatableResource; resourceId: string; locale: StoreLocale },
  change: {
    set: readonly { key: string; value: string; sourceDigest: string }[];
    remove: readonly string[];
  },
) {
  const now = new Date().toISOString();
  const where = and(
    eq(translations.resourceType, scope.resource),
    eq(translations.resourceId, scope.resourceId),
    eq(translations.locale, scope.locale),
  );
  const statements: BatchStatement[] = change.set.map(({ key, value, sourceDigest }) =>
    db
      .insert(translations)
      .values({
        resourceType: scope.resource,
        resourceId: scope.resourceId,
        locale: scope.locale,
        key,
        value,
        sourceDigest,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [translations.resourceType, translations.resourceId, translations.locale, translations.key],
        set: { value, sourceDigest, updatedAt: now },
      }),
  );
  if (change.remove.length > 0) {
    statements.push(db.delete(translations).where(and(where, inArray(translations.key, [...change.remove]))));
  }
  if (statements.length > 0) await db.batch(statements as [BatchStatement, ...BatchStatement[]]);
}
