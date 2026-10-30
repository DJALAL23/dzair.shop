/**
 * Removing a product, for every caller (the dashboard route and the AI
 * tools): the database row and everything that goes with it, then the files
 * nothing else still shows, released to the Media Library.
 *
 * Files are released after the delete committed, never before: a failed
 * delete must not leave products pointing at missing files.
 */
import type { AppDb } from "@/db";
import { releaseShown } from "@/lib/media";
import type { Env } from "@/types/env";
import { deleteProduct } from "../../../cod-shared/queries/products";

export async function removeProduct(db: AppDb, env: Env, productId: string): Promise<{ name: string; removedImages: number } | null> {
  const deleted = await deleteProduct(db, productId);
  if (!deleted) return null;
  const released = await releaseShown(env, deleted.imageKeys, `product ${productId}`);
  return { name: deleted.name, removedImages: released };
}
