/**
 * Collections: the dashboard's reads and writes, and a product's memberships.
 * The storefront reads a collection through the product list
 * (`getStoreProducts({ collection })`), so it gets the same products, gates,
 * translations and review figures as every other listing.
 *
 * A collection's order is the merchant's: `setCollectionProducts` saves the
 * whole ordered list at once, and a product added from its own page
 * (`setProductCollections`) goes to the end of each collection it joins.
 */
import type { MediaDelivery } from "../media/delivery";
import type { MediaImage } from "../media/model";
import { firstImage } from "../media/views";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { collectionProducts, collections, products } from "../db/schema";
import type { AppDb } from "../db/client";
import { COLLECTION_MAX_PRODUCTS, FEATURED_COLLECTION } from "../catalog/collections";
import { chunkIds } from "./d1-limits";
import { listTranslations } from "./translations";
import type { StoreLocale } from "../i18n/locales";

export interface CollectionSummary {
  id: string;
  handle: string;
  title: string;
  productCount: number;
  updatedAt: string;
}

export interface CollectionProduct {
  id: string;
  name: string;
  handle: string;
  /** Its gallery's first image. */
  image: MediaImage | null;
  /** Whether shoppers see it now: active, visible and listed in the store. */
  visible: boolean;
}

export interface CollectionDetail {
  id: string;
  handle: string;
  title: string;
  description: string | null;
  updatedAt: string;
  products: CollectionProduct[];
}

type BatchStatement = Parameters<AppDb["batch"]>[0][number];

export async function listCollections(db: AppDb, storeId: string): Promise<CollectionSummary[]> {
  return db
    .select({
      id: collections.id,
      handle: collections.handle,
      title: collections.title,
      updatedAt: collections.updatedAt,
      productCount: sql<number>`(SELECT COUNT(*) FROM collection_products cp WHERE cp.collection_id = ${collections.id})`,
    })
    .from(collections)
    .where(eq(collections.storeId, storeId))
    .orderBy(asc(collections.createdAt), sql`${collections}.rowid`)
    .all();
}

export async function getCollection(db: AppDb, storeId: string, id: string, delivery: MediaDelivery): Promise<CollectionDetail | null> {
  const collection = await db.select().from(collections).where(and(eq(collections.id, id), eq(collections.storeId, storeId))).get();
  if (!collection) return null;
  const rows = await db
    .select({
      id: products.id,
      name: products.name,
      handle: products.handle,
      status: products.status,
      visibility: products.visibility,
      showInStore: products.showInStore,
      imageJson: sql<string | null>`(SELECT json_object('key', pi.media_key, 'width', pi.width, 'height', pi.height) FROM product_images pi WHERE pi.product_id = ${products.id} AND pi.media_key IS NOT NULL ORDER BY pi.position LIMIT 1)`,
    })
    .from(collectionProducts)
    .innerJoin(products, eq(products.id, collectionProducts.productId))
    .where(eq(collectionProducts.collectionId, id))
    .orderBy(asc(collectionProducts.position), asc(products.id))
    .all();
  return {
    id: collection.id,
    handle: collection.handle,
    title: collection.title,
    description: collection.description,
    updatedAt: collection.updatedAt,
    products: rows.map((row) => ({
      id: row.id,
      name: row.name,
      handle: row.handle,
      image: firstImage(row.imageJson, delivery),
      visible: row.status === "ACTIVE" && row.visibility && row.showInStore,
    })),
  };
}

async function handleTaken(db: AppDb, storeId: string, handle: string, except?: string) {
  const row = await db.select({ id: collections.id }).from(collections).where(and(eq(collections.storeId, storeId), eq(collections.handle, handle))).get();
  return !!row && row.id !== except;
}

export async function createCollection(
  db: AppDb,
  storeId: string,
  input: { handle: string; title: string; description?: string | null },
): Promise<{ ok: true; id: string } | { ok: false; reason: "handle_taken" }> {
  if (await handleTaken(db, storeId, input.handle)) return { ok: false, reason: "handle_taken" };
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.insert(collections).values({ id, storeId, handle: input.handle, title: input.title, description: input.description ?? null, createdAt: now, updatedAt: now });
  return { ok: true, id };
}

export async function updateCollection(
  db: AppDb,
  storeId: string,
  id: string,
  input: { handle?: string; title?: string; description?: string | null },
): Promise<{ ok: true } | { ok: false; reason: "not_found" | "handle_taken" }> {
  if (input.handle !== undefined && (await handleTaken(db, storeId, input.handle, id))) return { ok: false, reason: "handle_taken" };
  const updated = await db
    .update(collections)
    .set({ ...input, updatedAt: new Date().toISOString() })
    .where(and(eq(collections.id, id), eq(collections.storeId, storeId)))
    .returning({ id: collections.id });
  return updated.length ? { ok: true } : { ok: false, reason: "not_found" };
}

export async function deleteCollection(db: AppDb, storeId: string, id: string): Promise<boolean> {
  const deleted = await db.delete(collections).where(and(eq(collections.id, id), eq(collections.storeId, storeId))).returning({ id: collections.id });
  return deleted.length > 0;
}

async function existingProductIds(db: AppDb, ids: readonly string[]): Promise<Set<string>> {
  const found = new Set<string>();
  for (const chunk of chunkIds([...ids])) {
    for (const row of await db.select({ id: products.id }).from(products).where(inArray(products.id, chunk)).all()) found.add(row.id);
  }
  return found;
}

/**
 * Replaces a collection's products with this ordered list, at once. Every id
 * must name a product, once; at most `COLLECTION_MAX_PRODUCTS`.
 */
export async function setCollectionProducts(
  db: AppDb,
  storeId: string,
  id: string,
  productIds: readonly string[],
): Promise<{ ok: true } | { ok: false; reason: "not_found" | "too_many" | "duplicate_product" } | { ok: false; reason: "unknown_products"; ids: string[] }> {
  const collection = await db.select({ id: collections.id }).from(collections).where(and(eq(collections.id, id), eq(collections.storeId, storeId))).get();
  if (!collection) return { ok: false, reason: "not_found" };
  if (productIds.length > COLLECTION_MAX_PRODUCTS) return { ok: false, reason: "too_many" };
  if (new Set(productIds).size !== productIds.length) return { ok: false, reason: "duplicate_product" };
  const found = await existingProductIds(db, productIds);
  const unknown = productIds.filter((productId) => !found.has(productId));
  if (unknown.length) return { ok: false, reason: "unknown_products", ids: unknown };

  const now = new Date().toISOString();
  const kept = new Map(
    (await db.select({ productId: collectionProducts.productId, addedAt: collectionProducts.addedAt }).from(collectionProducts).where(eq(collectionProducts.collectionId, id)).all()).map(
      (row) => [row.productId, row.addedAt],
    ),
  );
  const statements: BatchStatement[] = [
    db.delete(collectionProducts).where(eq(collectionProducts.collectionId, id)),
    ...productIds.map((productId, position) =>
      db.insert(collectionProducts).values({ collectionId: id, productId, position, addedAt: kept.get(productId) ?? now }),
    ),
    db.update(collections).set({ updatedAt: now }).where(eq(collections.id, id)),
  ];
  await db.batch(statements as [BatchStatement, ...BatchStatement[]]);
  return { ok: true };
}

/** The collections a product is in, by id. */
export async function productCollectionIds(db: AppDb, productId: string): Promise<string[]> {
  const rows = await db
    .select({ id: collectionProducts.collectionId })
    .from(collectionProducts)
    .innerJoin(collections, eq(collections.id, collectionProducts.collectionId))
    .where(eq(collectionProducts.productId, productId))
    .orderBy(asc(collections.createdAt))
    .all();
  return rows.map((row) => row.id);
}

/** The ids among these that name no collection of the store. */
export async function unknownCollectionIds(db: AppDb, storeId: string, ids: readonly string[]): Promise<string[]> {
  const wanted = [...new Set(ids)];
  if (wanted.length === 0) return [];
  const owned = new Set(
    (await db.select({ id: collections.id }).from(collections).where(and(eq(collections.storeId, storeId), inArray(collections.id, wanted))).all()).map((row) => row.id),
  );
  return wanted.filter((id) => !owned.has(id));
}

/**
 * Puts a product in exactly these collections, from its own page: it joins
 * the end of each one it was not in, keeps its place in those it stays in,
 * and leaves the others.
 */
export async function setProductCollections(
  db: AppDb,
  storeId: string,
  productId: string,
  collectionIds: readonly string[],
): Promise<{ ok: true } | { ok: false; reason: "unknown_collections"; ids: string[] }> {
  const wanted = [...new Set(collectionIds)];
  const unknown = await unknownCollectionIds(db, storeId, wanted);
  if (unknown.length) return { ok: false, reason: "unknown_collections", ids: unknown };

  const current = new Set(await productCollectionIds(db, productId));
  const now = new Date().toISOString();
  const joining = wanted.filter((id) => !current.has(id));
  const leaving = [...current].filter((id) => !wanted.includes(id));
  const statements: BatchStatement[] = [
    ...joining.map((collectionId) =>
      db.insert(collectionProducts).values({
        collectionId,
        productId,
        position: sql`(SELECT COALESCE(MAX(position) + 1, 0) FROM collection_products WHERE collection_id = ${collectionId})`,
        addedAt: now,
      }),
    ),
    ...(leaving.length
      ? [db.delete(collectionProducts).where(and(eq(collectionProducts.productId, productId), inArray(collectionProducts.collectionId, leaving)))]
      : []),
    ...[...joining, ...leaving].map((collectionId) => db.update(collections).set({ updatedAt: now }).where(eq(collections.id, collectionId))),
  ];
  if (statements.length) await db.batch(statements as [BatchStatement, ...BatchStatement[]]);
  return { ok: true };
}

export interface StorefrontCollection {
  handle: string;
  title: string;
  description: string | null;
}

/**
 * A collection as a storefront names it — its page's title and description,
 * in `locale` when the store translated them (`null` = the primary). Its
 * products are read through the product list (`collection`). Null when the
 * store has no collection with this handle.
 */
export async function getStorefrontCollection(db: AppDb, storeId: string, handle: string, locale: StoreLocale | null): Promise<StorefrontCollection | null> {
  const row = await db
    .select({ id: collections.id, handle: collections.handle, title: collections.title, description: collections.description })
    .from(collections)
    .where(and(eq(collections.storeId, storeId), eq(collections.handle, handle)))
    .get();
  if (!row) return null;
  const translated = locale ? await listTranslations(db, "collection", [row.id], locale) : [];
  const text = (key: "title" | "description") => translated.find((entry) => entry.key === key && entry.value.trim())?.value;
  return { handle: row.handle, title: text("title") ?? row.title, description: text("description") ?? row.description };
}
