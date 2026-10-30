/**
 * Writing a product group, for every caller (the dashboard routes and the AI
 * tools): an image is attached by a ready Media Key, and the image a change
 * stops showing is released once the change stands.
 */
import type { AppDb } from "@/db";
import { mediaDeliveryOf, mediaOf, releaseShown } from "@/lib/media";
import type { Env } from "@/types/env";
import { productCategories } from "../../../cod-shared/db/schema";
import * as groups from "../../../cod-shared/queries/product-groups";
import { eq } from "drizzle-orm";

async function assertReady(env: Env, key: string | null | undefined) {
  if (key) await mediaOf(env).ready(key);
}

async function imageKeyOf(db: AppDb, id: string) {
  return (await db.select({ imageKey: productCategories.imageKey }).from(productCategories).where(eq(productCategories.id, id)).get())?.imageKey ?? null;
}

export async function createProductGroup(env: Env, db: AppDb, data: groups.CreateGroupData) {
  await assertReady(env, data.imageKey);
  return groups.createGroup(db, data, mediaDeliveryOf(env));
}

export async function updateProductGroup(env: Env, db: AppDb, id: string, data: groups.UpdateGroupData) {
  await assertReady(env, data.imageKey);
  const before = data.imageKey !== undefined ? await imageKeyOf(db, id) : null;
  const group = await groups.updateGroup(db, id, data, mediaDeliveryOf(env));
  if (group && before && before !== data.imageKey) await releaseShown(env, [before], `product group ${id}`);
  return group;
}

export async function deleteProductGroup(env: Env, db: AppDb, id: string) {
  const imageKey = await imageKeyOf(db, id);
  await groups.deleteGroup(db, id);
  if (imageKey) await releaseShown(env, [imageKey], `product group ${id}`);
}
