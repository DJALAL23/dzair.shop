import { eq, and, like, or, sum, sql, inArray, getTableColumns } from "drizzle-orm";
import { products, productCategories, productVariants, productImages, reviews, reviewMedia, stockMovements, landingPages, landingPageImages } from "../db/schema";
import type { AppDb } from "../db/client";
import { sanitizeRichText, toPlainText } from "../lib/rich-text";
import { safeLikeTerm } from "./search";
import { imageKeysInText } from "../lib/orphan-images";
import type { VariantOption } from "../i18n/translations";
import { pruneOptionTranslations } from "./translations";

type BatchStatement = Parameters<AppDb["batch"]>[0][number];

export type DescriptionFormat = "text" | "html";

export type { VariantOption } from "../i18n/translations";

export interface ProductFilters {
  categoryId?: string;
  status?: "DRAFT" | "ACTIVE" | "ARCHIVED";
  visibility?: boolean;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface CreateProductData {
  name: string;
  description?: string | null;
  descriptionFormat?: DescriptionFormat;
  handle?: string;
  price: number;
  compareAtPrice?: number | null;
  costPrice?: number | null;
  type: "PHYSICAL" | "DIGITAL";
  hasVariants: boolean;
  variantOptions?: VariantOption[] | null;
  sku?: string | null;
  inventory: number;
  lowStockThreshold?: number;
  trackInventory: boolean;
  categoryId?: string | null;
  tags?: string[];
  visibility: boolean;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  showInStore: boolean;
  shippingProfileId?: string | null;
}

export interface UpdateProductData {
  name?: string;
  description?: string | null;
  descriptionFormat?: DescriptionFormat;
  handle?: string;
  price?: number;
  compareAtPrice?: number | null;
  costPrice?: number | null;
  type?: "PHYSICAL" | "DIGITAL";
  hasVariants?: boolean;
  variantOptions?: VariantOption[] | null;
  sku?: string | null;
  inventory?: number;
  lowStockThreshold?: number;
  trackInventory?: boolean;
  categoryId?: string | null;
  tags?: string[];
  visibility?: boolean;
  status?: "DRAFT" | "ACTIVE" | "ARCHIVED";
  showInStore?: boolean;
  shippingProfileId?: string | null;
}

function toHandle(name: string, id: string) {
  return name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").replace(/-+/g, "-") + "-" + id.slice(0, 8);
}

function normaliseFormat(value: unknown): DescriptionFormat {
  return value === "html" ? "html" : "text";
}

/**
 * Sanitise at the write chokepoint: an `html` description never reaches D1
 * unsanitised. `text` descriptions pass through untouched — legacy rows and
 * text-mode merchants keep rendering exactly as before.
 */
async function sanitiseForFormat(
  description: string | null,
  format: DescriptionFormat,
): Promise<string | null> {
  if (description === null || format !== "html") return description;
  return (await sanitizeRichText(description)).html;
}

/**
 * Tag-free rendering handed to clients for <meta name=description> and
 * JSON-LD. For `text` rows it is the raw column (meta output is unchanged
 * from today); for `html` rows it strips tags, drops images and decodes
 * entities. Runs in workerd — HTMLRewriter does not exist outside Workers.
 */
export async function deriveDescriptionPlain(
  description: string | null,
  format: DescriptionFormat | null | undefined,
): Promise<string | null> {
  if (description === null) return null;
  if (format === "html") return toPlainText(description);
  return description;
}

async function buildProductDetail(db: AppDb, productId: string) {
  const product = await db.select().from(products).where(eq(products.id, productId)).get();
  if (!product) return null;

  const [category, variants, images, totalInventoryRow] = await Promise.all([
    product.categoryId
      ? db.select().from(productCategories).where(eq(productCategories.id, product.categoryId)).get()
      : Promise.resolve(null),
    db.select().from(productVariants).where(eq(productVariants.productId, productId)).orderBy(productVariants.position).all(),
    db.select().from(productImages).where(eq(productImages.productId, productId)).orderBy(productImages.position).all(),
    db.select({ total: sum(productVariants.inventory) }).from(productVariants).where(eq(productVariants.productId, productId)).get(),
  ]);

  const variantOptions = product.variantOptions ? JSON.parse(product.variantOptions) : null;
  const tags = product.tags ? JSON.parse(product.tags) : [];

  const parsedVariants = variants.map((v) => ({
    ...v,
    variations: JSON.parse(v.variations),
  }));

  const totalInventory = product.hasVariants
    ? Number(totalInventoryRow?.total ?? 0)
    : product.inventory;

  return {
    ...product,
    variantOptions,
    tags,
    descriptionPlain: await deriveDescriptionPlain(product.description, product.descriptionFormat),
    category,
    variants: parsedVariants,
    images,
    variantsCount: parsedVariants.length,
    totalInventory,
  };
}

const MAX_IN_ARRAY_IDS = 90;

function chunkIds(ids: string[]): string[][] {
  if (ids.length === 0) return [];
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += MAX_IN_ARRAY_IDS) {
    chunks.push(ids.slice(i, i + MAX_IN_ARRAY_IDS));
  }
  return chunks;
}

export async function getAllProducts(db: AppDb, filters?: ProductFilters) {
  const conditions: ReturnType<typeof eq>[] = [];

  if (filters?.categoryId) conditions.push(eq(products.categoryId, filters.categoryId) as any);
  if (filters?.status) conditions.push(eq(products.status, filters.status) as any);
  if (filters?.visibility !== undefined) conditions.push(eq(products.visibility, filters.visibility) as any);
  if (filters?.search) {
    const term = `%${safeLikeTerm(filters.search)}%`;
    conditions.push(or(
      like(products.name, term),
      like(products.handle, term),
    ) as any);
  }

  const rows = await db
    .select({
      ...getTableColumns(products),
      reviewCount: sql<number>`(SELECT COUNT(*) FROM reviews WHERE reviews.product_id = products.id AND reviews.status = 'approved')`,
      avgRating: sql<number | null>`(SELECT ROUND(AVG(r.rating), 1) FROM reviews r WHERE r.product_id = products.id AND r.status = 'approved')`,
      primaryImageSrc: sql<string | null>`(SELECT src FROM product_images WHERE product_images.product_id = products.id ORDER BY product_images.position LIMIT 1)`,
    })
    .from(products)
    .where(conditions.length ? and(...conditions) : undefined)
    .limit(filters?.limit ?? 50)
    .offset(filters?.offset ?? 0)
    .all();

  if (rows.length === 0) return [];

  const variantRows: (typeof productVariants.$inferSelect)[] = [];
  for (const chunk of chunkIds(rows.map((p) => p.id))) {
    const chunkRows = await db
      .select()
      .from(productVariants)
      .where(inArray(productVariants.productId, chunk))
      .orderBy(productVariants.productId, productVariants.position)
      .all();
    variantRows.push(...chunkRows);
  }

  const variantsByProduct = new Map<string, (typeof productVariants.$inferSelect)[]>();
  for (const v of variantRows) {
    const list = variantsByProduct.get(v.productId);
    if (list) {
      list.push(v);
    } else {
      variantsByProduct.set(v.productId, [v]);
    }
  }

  return Promise.all(rows.map(async (p) => {
    const { reviewCount, avgRating, primaryImageSrc, ...productData } = p;
    const variants = variantsByProduct.get(p.id) ?? [];
    const totalInventory =
      variants.length > 0
        ? variants.reduce((sumTotal, v) => sumTotal + v.inventory, 0)
        : p.inventory;

    return {
      ...productData,
      variantOptions: p.variantOptions ? JSON.parse(p.variantOptions) : null,
      tags: p.tags ? JSON.parse(p.tags) : [],
      descriptionPlain: await deriveDescriptionPlain(p.description, p.descriptionFormat),
      variantsCount: variants.length,
      totalInventory,
      primaryImageSrc,
      variants: variants.map((v) => ({ ...v, variations: JSON.parse(v.variations) as Record<string, string> })),
      reviewCount,
      avgRating,
    };
  }));
}

export async function getProductById(db: AppDb, productId: string) {
  return buildProductDetail(db, productId);
}

export async function createProduct(db: AppDb, data: CreateProductData) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const handle = data.handle || toHandle(data.name, id);

  const descriptionFormat = normaliseFormat(data.descriptionFormat);
  const description = await sanitiseForFormat(data.description ?? null, descriptionFormat);

  await db.insert(products).values({
    id,
    name: data.name,
    description,
    descriptionFormat,
    handle,
    currency: "DZD",
    price: data.price,
    compareAtPrice: data.compareAtPrice ?? null,
    costPrice: data.costPrice ?? null,
    type: data.type,
    hasVariants: data.hasVariants,
    variantOptions: data.variantOptions ? JSON.stringify(data.variantOptions) : null,
    sku: data.sku ?? null,
    inventory: data.inventory,
    lowStockThreshold: data.lowStockThreshold ?? 5,
    trackInventory: data.trackInventory,
    categoryId: data.categoryId ?? null,
    tags: data.tags ? JSON.stringify(data.tags) : null,
    visibility: data.visibility,
    status: data.status,
    showInStore: data.showInStore,
    shippingProfileId: data.shippingProfileId ?? null,
    publishedAt: data.status === "ACTIVE" ? now : null,
    createdAt: now,
    updatedAt: now,
  });

  return buildProductDetail(db, id);
}

export async function updateProduct(db: AppDb, productId: string, data: UpdateProductData) {
  const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };

  if (data.name !== undefined) updates.name = data.name;
  if (data.description !== undefined || data.descriptionFormat !== undefined) {
    // The effective format governs how the final description is stored. When
    // the format flips to 'html' the STORED value is re-sanitised even if the
    // description itself did not change — a legacy text row must never start
    // rendering its raw content as live markup.
    const current = await db
      .select({ description: products.description, descriptionFormat: products.descriptionFormat })
      .from(products)
      .where(eq(products.id, productId))
      .get();
    const format = data.descriptionFormat !== undefined
      ? normaliseFormat(data.descriptionFormat)
      : normaliseFormat(current?.descriptionFormat);
    const description = await sanitiseForFormat(
      data.description !== undefined ? data.description ?? null : current?.description ?? null,
      format,
    );
    updates.description = description;
    updates.descriptionFormat = format;
  }
  if (data.handle !== undefined) updates.handle = data.handle;
  if (data.price !== undefined) updates.price = data.price;
  if (data.compareAtPrice !== undefined) updates.compareAtPrice = data.compareAtPrice ?? null;
  if (data.costPrice !== undefined) updates.costPrice = data.costPrice ?? null;
  if (data.type !== undefined) updates.type = data.type;
  if (data.hasVariants !== undefined) updates.hasVariants = data.hasVariants;
  if (data.variantOptions !== undefined) updates.variantOptions = data.variantOptions ? JSON.stringify(data.variantOptions) : null;
  if (data.sku !== undefined) updates.sku = data.sku ?? null;
  if (data.inventory !== undefined) updates.inventory = data.inventory;
  if (data.lowStockThreshold !== undefined) updates.lowStockThreshold = data.lowStockThreshold;
  if (data.trackInventory !== undefined) updates.trackInventory = data.trackInventory;
  if (data.categoryId !== undefined) updates.categoryId = data.categoryId ?? null;
  if (data.tags !== undefined) updates.tags = data.tags ? JSON.stringify(data.tags) : null;
  if (data.visibility !== undefined) updates.visibility = data.visibility;
  if (data.status !== undefined) {
    updates.status = data.status;
    if (data.status === "ACTIVE") updates.publishedAt = new Date().toISOString();
  }
  if (data.showInStore !== undefined) updates.showInStore = data.showInStore;
  if (data.shippingProfileId !== undefined) updates.shippingProfileId = data.shippingProfileId ?? null;

  const statements: BatchStatement[] = [
    db.update(products).set(updates).where(eq(products.id, productId)),
  ];
  if (data.variantOptions !== undefined) {
    statements.push(...(await pruneOptionTranslations(db, productId, data.variantOptions)));
  }

  // Simple-product inventory edits are manual adjustments — log them so the
  // movement ledger keeps reconciling to real stock. Variant products keep
  // their stock on variants; parent inventory is not ledger material.
  if (data.inventory !== undefined) {
    const current = await db
      .select({ inventory: products.inventory, hasVariants: products.hasVariants, trackInventory: products.trackInventory })
      .from(products)
      .where(eq(products.id, productId))
      .get();
    if (current?.trackInventory && !current.hasVariants) {
      const delta = data.inventory - current.inventory;
      if (delta !== 0) {
        statements.push(
          db.insert(stockMovements).values({
            id: crypto.randomUUID(),
            productId,
            variantId: null,
            type: delta > 0 ? "ADJUSTMENT_ADD" : "ADJUSTMENT_REMOVE",
            delta,
            qtyBefore: current.inventory,
            qtyAfter: data.inventory,
            reason: "Product inventory edited",
            reference: null,
            createdBy: "system",
            createdByName: "النظام",
            createdAt: new Date().toISOString(),
          }),
        );
      }
    }
  }

  await db.batch(statements as [BatchStatement, ...BatchStatement[]]);
  return buildProductDetail(db, productId);
}

/** What removing a product takes with it, and what stays. */
export interface ProductRemoval {
  id: string;
  name: string;
  variants: number;
  images: number;
  reviews: number;
  /** Offers it triggers or rewards: they go with it. */
  offers: number;
  /** Its landing pages, with their images and pixel settings. */
  landingPages: number;
  /** Orders those landing pages brought: kept, without the landing page link. */
  landingPageOrders: number;
  /** Order lines that sold it: kept as they were sold, without the product link. */
  orderLines: number;
  /** Orders holding it that are not handed to delivery yet: they keep the line, and it is never put back in stock. */
  ordersToShip: number;
}

/** What `deleteProduct` would remove, read in one statement. Null when the product does not exist. */
export async function productRemoval(db: AppDb, productId: string): Promise<ProductRemoval | null> {
  const row = await db.get<ProductRemoval>(sql`
    select p.id as id, p.name as name,
      (select count(*) from product_variants v where v.product_id = p.id) as variants,
      (select count(*) from product_images i where i.product_id = p.id) as images,
      (select count(*) from reviews r where r.product_id = p.id) as reviews,
      (select count(*) from offers f where f.trigger_product_id = p.id or f.reward_product_id = p.id) as offers,
      (select count(*) from landing_pages lp where lp.product_id = p.id) as landingPages,
      (select count(*) from orders o join landing_pages lp on lp.id = o.landing_page_id where lp.product_id = p.id) as landingPageOrders,
      (select count(*) from order_products op where op.product_id = p.id) as orderLines,
      (select count(distinct op.order_id) from order_products op join orders o on o.id = op.order_id
        where op.product_id = p.id and o.status <> 'cancelled' and not exists (select 1 from shipments s where s.order_id = o.id)) as ordersToShip
    from products p
    where p.id = ${productId}`);
  return row ?? null;
}

/**
 * Remove a product, for good. The database takes the rest with it: variants,
 * images, reviews, stock history, offers and translations by cascade, its
 * landing pages by trigger; order lines and abandoned checkouts keep what was
 * sold and lose only the link (migration 0042).
 *
 * Returns the stored file keys it showed — gallery, inline description
 * images, landing page images, its reviews' photos and voice notes — for the
 * caller to remove from storage once
 * nothing else shows them (`stillReferencedImageKeys`). Null when there was no
 * such product.
 */
export async function deleteProduct(db: AppDb, productId: string): Promise<{ name: string; imageKeys: string[] } | null> {
  const [gallery, own, landing, reviewFiles] = await db.batch([
    db.select({ r2Key: productImages.r2Key, src: productImages.src }).from(productImages).where(eq(productImages.productId, productId)),
    db.select({ description: products.description }).from(products).where(eq(products.id, productId)),
    db
      .select({ r2Key: landingPageImages.r2Key })
      .from(landingPageImages)
      .innerJoin(landingPages, eq(landingPages.id, landingPageImages.landingPageId))
      .where(eq(landingPages.productId, productId)),
    db
      .select({ r2Key: reviewMedia.r2Key, thumbKey: reviewMedia.thumbKey })
      .from(reviewMedia)
      .innerJoin(reviews, eq(reviews.id, reviewMedia.reviewId))
      .where(eq(reviews.productId, productId)),
  ]);
  const deleted = await db.delete(products).where(eq(products.id, productId)).returning({ name: products.name });
  if (deleted.length === 0) return null;

  const imageKeys = new Set<string>();
  for (const image of gallery) {
    if (image.r2Key) imageKeys.add(image.r2Key);
    for (const key of imageKeysInText(image.src)) imageKeys.add(key);
  }
  for (const key of imageKeysInText(own[0]?.description)) imageKeys.add(key);
  for (const image of landing) imageKeys.add(image.r2Key);
  for (const file of reviewFiles) {
    imageKeys.add(file.r2Key);
    if (file.thumbKey) imageKeys.add(file.thumbKey);
  }
  return { name: deleted[0].name, imageKeys: [...imageKeys] };
}

/**
 * Identity conflict finder for create/update: does another product already
 * hold this handle or SKU? Answers before the unique index would, so the
 * merchant gets a 409 that names the field instead of a raw constraint error.
 */
export async function findProductIdentityConflict(
  db: AppDb,
  identity: { handle?: string; sku?: string },
): Promise<{ field: "handle" | "sku"; existingId: string } | null> {
  const conditions = [];
  if (identity.handle !== undefined) conditions.push(eq(products.handle, identity.handle));
  if (identity.sku !== undefined) conditions.push(eq(products.sku, identity.sku));
  if (conditions.length === 0) return null;

  const row = await db
    .select({
      id: products.id,
      handle: products.handle,
      sku: products.sku,
    })
    .from(products)
    .where(or(...conditions))
    .get();
  if (!row) return null;

  const field =
    identity.handle !== undefined && row.handle === identity.handle ? "handle" : "sku";
  return { field, existingId: row.id };
}

export async function getProductImages(db: AppDb, productId: string) {
  return db
    .select()
    .from(productImages)
    .where(eq(productImages.productId, productId))
    .orderBy(productImages.position)
    .all();
}
