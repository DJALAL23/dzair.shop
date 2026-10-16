import { Context } from "hono";
import type { AppContext } from "@/types";
import { getDb } from "@/db";
import * as queries from "./queries";
import * as validation from "./validation";
import { logActivity, ACTIONS } from "@/lib/activity";
import { NotFoundError, ConflictError, SystemError } from "@/lib/errors/classes";
import { ERROR_CODES } from "../../../../cod-shared/errors/codes";
import { removeProduct } from "@/lib/remove-product";

export async function listProducts(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const queryData: any = (c.req as any).valid?.("query");
  const filters = queryData ?? validation.productFiltersSchema.parse({
    categoryId: c.req.query("categoryId"),
    status: c.req.query("status"),
    visibility: c.req.query("visibility"),
    search: c.req.query("search"),
    limit: c.req.query("limit"),
    offset: c.req.query("offset"),
  });
  const data = await queries.getAllProducts(db, filters);
  return c.json({ success: true, data, count: data.length }, 200);
}

export async function getProduct(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const productId = c.req.param("id")!;
  const product = await queries.getProductById(db, productId);
  if (!product) {
    throw new NotFoundError("Product", productId);
  }
  return c.json({ success: true, data: product }, 200);
}

function isProductUniqueViolation(err: unknown): "handle" | "sku" | null {
  const msg = err instanceof Error ? err.message : String(err);
  if (/UNIQUE constraint failed: products\.handle/i.test(msg)) return "handle";
  if (/UNIQUE constraint failed: products\.sku/i.test(msg)) return "sku";
  return null;
}

export async function createProduct(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const jsonData: any = (c.req as any).valid?.("json");
  const validated = jsonData ?? validation.createProductSchema.parse(await c.req.json());

  // Identity pre-check: a 409 naming the field, before the unique index answers.
  const conflict = await queries.findProductIdentityConflict(db, {
    ...(validated.handle !== undefined ? { handle: validated.handle } : {}),
    ...(validated.sku !== undefined ? { sku: validated.sku } : {}),
  });
  if (conflict) {
    if (conflict.field === "sku") {
      throw new ConflictError(
        `Product with SKU "${validated.sku}" already exists`,
        ERROR_CODES.DUPLICATE_SKU,
        { sku: validated.sku, existingProductId: conflict.existingId }
      );
    }
    throw new ConflictError(
      `Product with handle "${validated.handle}" already exists — pick a different handle or leave it empty to auto-generate one`,
      ERROR_CODES.DUPLICATE_ENTITY,
      { handle: validated.handle, existingProductId: conflict.existingId }
    );
  }

  try {
    const product = await queries.createProduct(db, validated);
    if (!product) {
      throw new SystemError("Failed to create product");
    }
    const actor = c.get("user");
    await logActivity(db, actor, ACTIONS.PRODUCT_CREATED, {
      type: "product", id: product.id, label: validated.name,
    });
    return c.json({ success: true, data: product }, 201);
  } catch (err) {
    // Race: a concurrent writer took the handle/SKU between check and insert.
    const field = isProductUniqueViolation(err);
    if (field === "sku") {
      throw new ConflictError(
        `Product with SKU "${validated.sku}" already exists`,
        ERROR_CODES.DUPLICATE_SKU,
        { sku: validated.sku }
      );
    }
    if (field === "handle") {
      throw new ConflictError(
        `Product with handle "${validated.handle}" already exists — pick a different handle or leave it empty to auto-generate one`,
        ERROR_CODES.DUPLICATE_ENTITY,
        { handle: validated.handle }
      );
    }
    throw err;
  }
}

export async function updateProduct(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const productId = c.req.param("id")!;
  const jsonData: any = (c.req as any).valid?.("json");
  const validated = jsonData ?? validation.updateProductSchema.parse(await c.req.json());

  // Renaming onto another product's handle or SKU.
  if (validated.handle !== undefined || validated.sku !== undefined) {
    const conflict = await queries.findProductIdentityConflict(db, {
      ...(validated.handle !== undefined ? { handle: validated.handle } : {}),
      ...(validated.sku !== undefined ? { sku: validated.sku } : {}),
    });
    if (conflict && conflict.existingId !== productId) {
      if (conflict.field === "sku") {
        throw new ConflictError(
          `Product with SKU "${validated.sku}" already exists`,
          ERROR_CODES.DUPLICATE_SKU,
          { sku: validated.sku, existingProductId: conflict.existingId }
        );
      }
      throw new ConflictError(
        `Product with handle "${validated.handle}" already exists`,
        ERROR_CODES.DUPLICATE_ENTITY,
        { handle: validated.handle, existingProductId: conflict.existingId }
      );
    }
  }

  const product = await queries.updateProduct(db, productId, validated);
  if (!product) {
    throw new NotFoundError("Product", productId);
  }
  const actor = c.get("user");
  await logActivity(db, actor, ACTIONS.PRODUCT_UPDATED, {
    type: "product", id: product.id, label: product.name,
  });
  return c.json({ success: true, data: product }, 200);
}

export async function updateProductStatus(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const productId = c.req.param("id")!;
  const jsonData: any = (c.req as any).valid?.("json");
  const { status } = jsonData ?? validation.updateStatusSchema.parse(await c.req.json());
  const product = await queries.updateProduct(db, productId, { status });
  if (!product) {
    throw new NotFoundError("Product", productId);
  }
  const actor = c.get("user");
  await logActivity(db, actor, ACTIONS.PRODUCT_STATUS_CHANGED, {
    type: "product", id: product.id, label: product.name,
  }, { status });
  return c.json({ success: true, data: product }, 200);
}

/**
 * DELETE /products/:id
 * Remove a product for good, even one orders hold: their lines keep what was
 * sold. Its variants, images, reviews, stock history, offers and landing
 * pages go with it, and its image files once nothing else shows them.
 */
export async function deleteProduct(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const id = c.req.param("id")!;
  const removed = await removeProduct(db, c.env.IMAGES, id);
  if (!removed) throw new NotFoundError("Product", id);
  await logActivity(db, c.get("user"), ACTIONS.PRODUCT_DELETED, { type: "product", id, label: removed.name });
  return c.json({ success: true, message: "Product deleted" }, 200);
}

/**
 * GET /products/:id/removal
 * What removing the product takes with it and what stays, for the dashboard
 * to say before asking.
 */
export async function getProductRemoval(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const id = c.req.param("id")!;
  const removal = await queries.productRemoval(db, id);
  if (!removal) throw new NotFoundError("Product", id);
  return c.json({ success: true, data: removal }, 200);
}
