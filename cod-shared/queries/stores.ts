import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import { storeContentOverrides, storeLocales, stores } from "../db/schema";
import type { AppDb } from "../db/client";
import type { StoreLocale } from "../i18n/locales";
import type { LocaleRow } from "../stores/settings";

type StoreUpdate = Partial<typeof stores.$inferInsert>;
type BatchStatement = Parameters<AppDb["batch"]>[0][number];

/** One theme's edits in one language of one store. */
export interface OverrideScope {
  storeId: string;
  themeKey: string;
  locale: StoreLocale;
}

/** Single-tenant: returns the one store in this D1 database. */
export async function getStore(db: AppDb) {
  return db.select().from(stores).get();
}

export async function listStoreLocales(db: AppDb, storeId: string) {
  return db
    .select({ locale: storeLocales.locale, published: storeLocales.published })
    .from(storeLocales)
    .where(eq(storeLocales.storeId, storeId))
    .all();
}

/**
 * Save the store's columns and, when `locales` is given, replace its language
 * list — in one batch, so `stores.lang` and its published row never disagree.
 * A removed language takes its theme text edits with it (FK cascade).
 */
export async function updateStore(
  db: AppDb,
  storeId: string,
  data: StoreUpdate,
  locales: readonly LocaleRow[] | null = null,
) {
  const now = new Date().toISOString();
  const statements: BatchStatement[] = [
    db.update(stores).set({ ...data, updatedAt: now }).where(eq(stores.id, storeId)),
  ];
  if (locales !== null) {
    statements.push(
      db.delete(storeLocales).where(
        and(
          eq(storeLocales.storeId, storeId),
          notInArray(storeLocales.locale, locales.map((row) => row.locale)),
        ),
      ),
      ...locales.map((row) =>
        db
          .insert(storeLocales)
          .values({ storeId, locale: row.locale, published: row.published, createdAt: now })
          .onConflictDoUpdate({
            target: [storeLocales.storeId, storeLocales.locale],
            set: { published: row.published },
          }),
      ),
    );
  }
  await db.batch(statements as [BatchStatement, ...BatchStatement[]]);
  return db.select().from(stores).where(eq(stores.id, storeId)).get();
}

/** Every edit a store made to one theme's text, across its languages. */
export async function listContentOverrides(db: AppDb, storeId: string, themeKey: string) {
  return db
    .select({ locale: storeContentOverrides.locale, key: storeContentOverrides.key, value: storeContentOverrides.value })
    .from(storeContentOverrides)
    .where(and(eq(storeContentOverrides.storeId, storeId), eq(storeContentOverrides.themeKey, themeKey)))
    .orderBy(storeContentOverrides.locale, storeContentOverrides.key)
    .all();
}

/** The keys one language already has edits for. */
export async function listContentOverrideKeys(db: AppDb, scope: OverrideScope) {
  const rows = await db
    .select({ key: storeContentOverrides.key })
    .from(storeContentOverrides)
    .where(scopeOf(scope))
    .all();
  return rows.map((row) => row.key);
}

/**
 * Write and remove one language's edits in one batch. The batch first makes
 * sure the language has its `store_locales` row: only the primary can lack
 * one (a store a seed created after migration 0036), and callers admit no
 * other missing language, so the row it creates is the published primary.
 */
export async function writeContentOverrides(
  db: AppDb,
  scope: OverrideScope,
  change: { set: readonly [string, string][]; remove: readonly string[] },
) {
  const now = new Date().toISOString();
  const statements: BatchStatement[] = [
    db
      .insert(storeLocales)
      .values({ storeId: scope.storeId, locale: scope.locale, published: true, createdAt: now })
      .onConflictDoNothing(),
  ];
  statements.push(...change.set.map(([key, value]) =>
    db
      .insert(storeContentOverrides)
      .values({ ...scope, key, value, updatedAt: now })
      .onConflictDoUpdate({
        target: [
          storeContentOverrides.storeId,
          storeContentOverrides.themeKey,
          storeContentOverrides.locale,
          storeContentOverrides.key,
        ],
        set: { value: sql`excluded.value`, updatedAt: now },
      }),
  ));
  if (change.remove.length > 0) {
    statements.push(
      db.delete(storeContentOverrides).where(and(scopeOf(scope), inArray(storeContentOverrides.key, [...change.remove]))),
    );
  }
  await db.batch(statements as [BatchStatement, ...BatchStatement[]]);
}

const scopeOf = (scope: OverrideScope) =>
  and(
    eq(storeContentOverrides.storeId, scope.storeId),
    eq(storeContentOverrides.themeKey, scope.themeKey),
    eq(storeContentOverrides.locale, scope.locale),
  );
