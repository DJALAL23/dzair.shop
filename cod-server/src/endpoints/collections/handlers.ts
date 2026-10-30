import type { Context } from "hono";
import type { z } from "@hono/zod-openapi";
import type { AppContext } from "@/types";
import { getDb } from "@/db";
import { mediaDeliveryOf } from "@/lib/media";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors/classes";
import { logActivity, ACTIONS } from "@/lib/activity";
import { ERROR_CODES } from "../../../../cod-shared/errors/codes";
import { getStore } from "../../../../cod-shared/queries/stores";
import {
  createCollection,
  deleteCollection,
  getCollection,
  listCollections,
  setCollectionProducts,
  updateCollection,
} from "../../../../cod-shared/queries/collections";
import type { CreateCollectionSchema, SaveCollectionProductsSchema, UpdateCollectionSchema } from "@/openapi/schemas/collections";

async function requireStore(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const store = await getStore(db);
  if (!store) throw new NotFoundError("Store");
  return { db, store };
}

const body = <T>(c: Context<AppContext>) => (c.req as unknown as { valid: (target: "json") => T }).valid("json");

async function detailOrThrow(c: Context<AppContext>, db: ReturnType<typeof getDb>, storeId: string, id: string) {
  const collection = await getCollection(db, storeId, id, mediaDeliveryOf(c.env));
  if (!collection) throw new NotFoundError("Collection", id);
  return collection;
}

const handleTaken = (handle: string) =>
  new ConflictError(`Another collection already has the handle "${handle}"`, ERROR_CODES.DUPLICATE_COLLECTION_HANDLE, { handle });

export async function list(c: Context<AppContext>) {
  const { db, store } = await requireStore(c);
  const data = await listCollections(db, store.id);
  return c.json({ success: true, data, count: data.length }, 200);
}

export async function get(c: Context<AppContext>) {
  const { db, store } = await requireStore(c);
  return c.json({ success: true, data: await detailOrThrow(c, db, store.id, c.req.param("id")!) }, 200);
}

export async function create(c: Context<AppContext>) {
  const { db, store } = await requireStore(c);
  const input = body<z.infer<typeof CreateCollectionSchema>>(c);
  const result = await createCollection(db, store.id, input);
  if (!result.ok) throw handleTaken(input.handle);
  await logActivity(db, c.get("user"), ACTIONS.COLLECTION_CREATED, { type: "collection", id: result.id, label: input.title }, { handle: input.handle });
  return c.json({ success: true, data: await detailOrThrow(c, db, store.id, result.id) }, 201);
}

export async function update(c: Context<AppContext>) {
  const { db, store } = await requireStore(c);
  const id = c.req.param("id")!;
  const input = body<z.infer<typeof UpdateCollectionSchema>>(c);
  const result = await updateCollection(db, store.id, id, input);
  if (!result.ok && result.reason === "not_found") throw new NotFoundError("Collection", id);
  if (!result.ok) throw handleTaken(input.handle!);
  const collection = await detailOrThrow(c, db, store.id, id);
  await logActivity(db, c.get("user"), ACTIONS.COLLECTION_UPDATED, { type: "collection", id, label: collection.title }, input);
  return c.json({ success: true, data: collection }, 200);
}

export async function saveProducts(c: Context<AppContext>) {
  const { db, store } = await requireStore(c);
  const id = c.req.param("id")!;
  const { productIds } = body<z.infer<typeof SaveCollectionProductsSchema>>(c);
  const result = await setCollectionProducts(db, store.id, id, productIds);
  if (!result.ok && result.reason === "not_found") throw new NotFoundError("Collection", id);
  if (!result.ok) {
    const { ok: _ok, ...problem } = result;
    throw new ValidationError("The collection's products cannot be saved as sent", ERROR_CODES.INVALID_COLLECTION_PRODUCTS, problem);
  }
  const collection = await detailOrThrow(c, db, store.id, id);
  await logActivity(db, c.get("user"), ACTIONS.COLLECTION_PRODUCTS_SAVED, { type: "collection", id, label: collection.title }, { count: productIds.length });
  return c.json({ success: true, data: collection }, 200);
}

export async function remove(c: Context<AppContext>) {
  const { db, store } = await requireStore(c);
  const id = c.req.param("id")!;
  const collection = await detailOrThrow(c, db, store.id, id);
  await deleteCollection(db, store.id, id);
  await logActivity(db, c.get("user"), ACTIONS.COLLECTION_DELETED, { type: "collection", id, label: collection.title }, { handle: collection.handle });
  return c.json({ success: true, data: { id } }, 200);
}
