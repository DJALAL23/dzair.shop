/**
 * The collections a product write names (`collectionIds`), for every writer
 * of products — the dashboard's routes and the AI agents' tools alike: the
 * ids are checked before the product is written, so an unknown one never
 * leaves a half-made product, and applied after.
 */
import type { AppDb } from "../../../cod-shared/db/client";
import { getStore } from "../../../cod-shared/queries/stores";
import { productCollectionIds, setProductCollections, unknownCollectionIds } from "../../../cod-shared/queries/collections";

export type CollectionsCheck = { ok: true; apply: (productId: string) => Promise<void> } | { ok: false; unknown: string[] };

/** Checks the ids; `apply` puts the product in exactly those collections (nothing when none were named). */
export async function checkProductCollections(db: AppDb, collectionIds: readonly string[] | undefined): Promise<CollectionsCheck> {
  if (collectionIds === undefined) return { ok: true, apply: async () => {} };
  const store = await getStore(db);
  const unknown = store ? await unknownCollectionIds(db, store.id, collectionIds) : [...collectionIds];
  if (!store || unknown.length) return { ok: false, unknown };
  return {
    ok: true,
    apply: async (productId) => {
      await setProductCollections(db, store.id, productId, collectionIds);
    },
  };
}

/** A product as its own page reads it: its fields and the collections it is in. */
export async function withCollections<T extends { id: string }>(db: AppDb, product: T) {
  return { ...product, collectionIds: await productCollectionIds(db, product.id) };
}
