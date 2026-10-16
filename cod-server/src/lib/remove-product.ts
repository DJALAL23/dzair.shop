/**
 * Removing a product, for every caller (the dashboard route and the AI
 * tools): the database row and everything that goes with it, then the
 * stored images nothing else still shows.
 *
 * Storage is cleaned after the delete committed, never before: a failed
 * delete must not leave products pointing at missing files. A file that
 * cannot be removed now is left for the orphan sweep.
 */
import type { AppDb } from "@/db";
import { deleteProduct } from "../../../cod-shared/queries/products";
import { stillReferencedImageKeys } from "../../../cod-shared/queries/image-references";

/** R2 accepts at most 1000 keys per delete call. */
const R2_DELETE_BATCH = 1000;

export async function removeProduct(
  db: AppDb,
  bucket: Pick<R2Bucket, "delete"> | undefined,
  productId: string,
): Promise<{ name: string; removedImages: number } | null> {
  const deleted = await deleteProduct(db, productId);
  if (!deleted) return null;

  const referenced = await stillReferencedImageKeys(db, deleted.imageKeys);
  const unused = deleted.imageKeys.filter((key) => !referenced.has(key));
  if (!bucket || unused.length === 0) return { name: deleted.name, removedImages: 0 };
  try {
    for (let i = 0; i < unused.length; i += R2_DELETE_BATCH) await bucket.delete(unused.slice(i, i + R2_DELETE_BATCH));
    return { name: deleted.name, removedImages: unused.length };
  } catch (error) {
    console.error(`[products] product ${productId} removed; ${unused.length} image file(s) left for the orphan sweep`, error);
    return { name: deleted.name, removedImages: 0 };
  }
}
