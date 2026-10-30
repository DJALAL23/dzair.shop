import { eq, and, like, count, getTableColumns } from "drizzle-orm";
import { productCategories, products } from "../db/schema";
import type { AppDb } from "../db/client";
import type { MediaDelivery } from "../media/delivery";
import { categoryView } from "../media/views";

export interface GroupFilters {
  search?: string;
  parentId?: string;
}

export interface CreateGroupData {
  name: string;
  slug?: string;
  description?: string | null;
  parentId?: string | null;
  imageKey?: string | null;
  metaTitle?: string | null;
  metaDescription?: string | null;
  metaKeywords?: string | null;
  position: number;
}

export interface UpdateGroupData {
  name?: string;
  slug?: string;
  description?: string | null;
  parentId?: string | null;
  imageKey?: string | null;
  metaTitle?: string | null;
  metaDescription?: string | null;
  metaKeywords?: string | null;
  position?: number;
}

function toSlug(name: string, id: string) {
  return name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").replace(/-+/g, "-") + "-" + id.slice(0, 8);
}

export async function getAllGroups(db: AppDb, delivery: MediaDelivery, filters?: GroupFilters) {
  const conditions = [];
  if (filters?.search) conditions.push(like(productCategories.name, `%${filters.search}%`));
  if (filters?.parentId) conditions.push(eq(productCategories.parentId, filters.parentId));

  const rows = await db
    .select({ ...getTableColumns(productCategories), productsCount: count(products.id) })
    .from(productCategories)
    .leftJoin(products, eq(products.categoryId, productCategories.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .groupBy(productCategories.id)
    .orderBy(productCategories.position)
    .all();
  return rows.map((row) => categoryView(row, delivery));
}

export async function getGroupById(db: AppDb, id: string, delivery: MediaDelivery) {
  const cat = await db.select().from(productCategories).where(eq(productCategories.id, id)).get();
  if (!cat) return null;
  const [childrenRows, productsCountRow] = await Promise.all([
    db.select().from(productCategories).where(eq(productCategories.parentId, id)).all(),
    db
      .select({ count: count() })
      .from(products)
      .where(eq(products.categoryId, id))
      .get(),
  ]);
  return { ...categoryView(cat, delivery), children: childrenRows.map((row) => categoryView(row, delivery)), productsCount: productsCountRow?.count ?? 0 };
}

export async function createGroup(db: AppDb, data: CreateGroupData, delivery: MediaDelivery) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const slug = data.slug || toSlug(data.name, id);

  await db.insert(productCategories).values({
    id,
    name: data.name,
    slug,
    description: data.description ?? null,
    parentId: data.parentId ?? null,
    imageKey: data.imageKey ?? null,
    metaTitle: data.metaTitle ?? null,
    metaDescription: data.metaDescription ?? null,
    metaKeywords: data.metaKeywords ?? null,
    position: data.position,
    createdAt: now,
    updatedAt: now,
  });

  return getGroupById(db, id, delivery);
}

export async function updateGroup(db: AppDb, id: string, data: UpdateGroupData, delivery: MediaDelivery) {
  const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (data.name !== undefined) updates.name = data.name;
  if (data.slug !== undefined) updates.slug = data.slug;
  if (data.description !== undefined) updates.description = data.description ?? null;
  if (data.parentId !== undefined) updates.parentId = data.parentId ?? null;
  if (data.imageKey !== undefined) updates.imageKey = data.imageKey ?? null;
  if (data.metaTitle !== undefined) updates.metaTitle = data.metaTitle ?? null;
  if (data.metaDescription !== undefined) updates.metaDescription = data.metaDescription ?? null;
  if (data.metaKeywords !== undefined) updates.metaKeywords = data.metaKeywords ?? null;
  if (data.position !== undefined) updates.position = data.position;

  await db.update(productCategories).set(updates).where(eq(productCategories.id, id));
  return getGroupById(db, id, delivery);
}

export async function deleteGroup(db: AppDb, id: string) {
  await db.delete(productCategories).where(eq(productCategories.id, id));
  return { success: true };
}
