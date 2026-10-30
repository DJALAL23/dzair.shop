/**
 * A product's gallery (ADR 0021): an image is attached by the Media Key of a
 * completed upload, ordered, and removed — the file released once nothing
 * else shows it.
 */
import type { Context } from "hono";
import { and, asc, eq } from "drizzle-orm";
import type { AppContext } from "@/types";
import { getDb } from "@/db";
import { NotFoundError, ValidationError } from "@/lib/errors/classes";
import { mediaDeliveryOf, mediaOf, releaseShown } from "@/lib/media";
import { productImages, productVariants, products } from "../../../../cod-shared/db/schema";
import { ERROR_CODES } from "../../../../cod-shared/errors/codes";
import { productImageView, productImageViews } from "../../../../cod-shared/media/views";

const body = <T>(c: Context<AppContext>) => (c.req as unknown as { valid: (target: "json") => T }).valid("json");

async function gallery(c: Context<AppContext>, productId: string) {
  const rows = await getDb(c.env.DB).select().from(productImages).where(eq(productImages.productId, productId)).orderBy(asc(productImages.position)).all();
  return productImageViews(rows, mediaDeliveryOf(c.env));
}

/** GET /api/products/:id/images */
export async function listProductImages(c: Context<AppContext>) {
  return c.json({ success: true, data: await gallery(c, c.req.param("id")!) }, 200);
}

/** POST /api/products/:id/images — attach a ready image, last unless a position is given. */
export async function attachProductImage(c: Context<AppContext>) {
  const productId = c.req.param("id")!;
  const db = getDb(c.env.DB);
  const { mediaKey, altText, position } = body<{ mediaKey: string; altText?: string | null; position?: number }>(c);

  const product = await db.select({ id: products.id }).from(products).where(eq(products.id, productId)).get();
  if (!product) throw new NotFoundError("Product", productId);
  const file = await mediaOf(c.env).ready(mediaKey);

  const last = await db.select({ position: productImages.position }).from(productImages).where(eq(productImages.productId, productId)).orderBy(asc(productImages.position)).all();
  const now = new Date().toISOString();
  const [row] = await db
    .insert(productImages)
    .values({
      id: crypto.randomUUID(),
      productId,
      mediaKey: file.key,
      altText: altText ?? null,
      width: file.width,
      height: file.height,
      position: position ?? (last.length > 0 ? Math.max(...last.map((image) => image.position)) + 1 : 1),
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return c.json({ success: true, data: productImageView(row!, mediaDeliveryOf(c.env)) }, 201);
}

/** PATCH /api/products/:id/images/reorder — every image of the product, once each, in their new order. */
export async function reorderProductImages(c: Context<AppContext>) {
  const productId = c.req.param("id")!;
  const db = getDb(c.env.DB);
  const { imageIds } = body<{ imageIds: string[] }>(c);

  if (new Set(imageIds).size !== imageIds.length) {
    throw new ValidationError("imageIds must not contain duplicate IDs", ERROR_CODES.VALIDATION_FAILED, { field: "imageIds" });
  }
  const existing = await db.select({ id: productImages.id }).from(productImages).where(eq(productImages.productId, productId)).all();
  const existingIds = new Set(existing.map((image) => image.id));
  for (const id of imageIds) {
    if (!existingIds.has(id)) throw new ValidationError(`Image ${id} does not belong to product ${productId}`, ERROR_CODES.VALIDATION_FAILED, { imageId: id, productId });
  }
  if (imageIds.length !== existing.length) {
    throw new ValidationError("imageIds must include all images for this product", ERROR_CODES.VALIDATION_FAILED, { expected: existing.length, received: imageIds.length });
  }

  await db.batch(imageIds.map((id, i) => db.update(productImages).set({ position: i + 1 }).where(eq(productImages.id, id))) as [never, ...never[]]);
  return c.json({ success: true, data: await gallery(c, productId) }, 200);
}

/** DELETE /api/products/:id/images/:imageId — the variants that showed it are left without one. */
export async function removeProductImage(c: Context<AppContext>) {
  const productId = c.req.param("id")!;
  const imageId = c.req.param("imageId")!;
  const db = getDb(c.env.DB);

  const image = await db.select().from(productImages).where(and(eq(productImages.id, imageId), eq(productImages.productId, productId))).get();
  if (!image) throw new NotFoundError("Image", imageId);

  await db.batch([
    db.update(productVariants).set({ imageId: null }).where(and(eq(productVariants.productId, productId), eq(productVariants.imageId, imageId))),
    db.delete(productImages).where(eq(productImages.id, imageId)),
  ]);
  if (image.mediaKey) await releaseShown(c.env, [image.mediaKey], `image ${imageId} of product ${productId}`);
  return c.json({ success: true }, 200);
}
