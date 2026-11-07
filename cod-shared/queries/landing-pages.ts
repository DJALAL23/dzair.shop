/**
 * Landing Pages Queries
 *
 * Centralized database operations for landing pages: the one-product
 * marketing pages (image stack + COD form). A page reports no analytics of
 * its own: an order remembers the page it was placed from
 * (`orders.landing_page_id`), and reporting reads that, nowhere else.
 */
import type { MediaDelivery } from "../media/delivery";
import { landingImageViews } from "../media/views";
import { storefrontPath } from "../storefront/routes";
import { eq, desc, and, sql, isNull, count, gte } from "drizzle-orm";
import {
  landingPages,
  landingPageImages,
  landingPagePixelConfig,
  pageDocuments,
  storePixelConfig,
  orders,
  products,
  stores,
} from "../db/schema";
import type { AppDb, BatchStoreDb, StoreDb } from "../db/client";
import { insertSelectRow } from "../db/insert-select";
import { landingDocumentSurface } from "./page-document-surface";
import {
  publicTrackingFrom,
  type StoreConfigRow,
  type PageConfigRow,
} from "./tracking-config";

export interface LandingPageListItem {
  id: string;
  slug: string;
  name: string;
  status: "draft" | "published" | "archived";
  productId: string;
  productName: string | null;
  productHandle: string | null;
  imageCount: number;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** The page's own tracking, when it has one. Never carries the token. */
  tracking: {
    pixelId: string;
    conversionEvent: "Lead" | "Purchase" | "Purchase_Confirmed" | "Purchase_Delivered";
    enabled: boolean;
    testMode: boolean;
  } | null;
}

export interface CreateLandingPageData {
  name: string;
  slug?: string;
  productId: string;
  imageGap?: number;
  metaTitle?: string | null;
  metaDescription?: string | null;
}

export interface UpdateLandingPageData {
  name?: string;
  slug?: string;
  imageGap?: number;
  metaTitle?: string | null;
  metaDescription?: string | null;
}

export interface LandingPageImageInput {
  /** A ready Media Key (the caller checks it with the Media Library). */
  mediaKey: string;
  altText?: string | null;
  position?: number;
  /** Intrinsic pixel size — reserved by the storefront to prevent CLS. */
  width?: number | null;
  height?: number | null;
  /** Provenance of the upload — AI agents set "ai", browser uploads default to "upload". */
  source?: "upload" | "ai";
}

/** Opt-in pagination — applied only when provided; omitted means unbounded
 *  (the dashboard list fetches everything). */
export interface LandingPageListPagination {
  limit?: number;
  offset?: number;
}

async function resolveListRow(
  db: AppDb,
  filters: { productId?: string; status?: "draft" | "published" | "archived" } = {},
  pagination: LandingPageListPagination = {},
): Promise<LandingPageListItem[]> {
  // Filters belong in SQL: stat subselects must not run for discarded rows.
  const conditions = [];
  if (filters.productId) conditions.push(eq(landingPages.productId, filters.productId));
  if (filters.status) conditions.push(eq(landingPages.status, filters.status));

  const baseQuery = db
    .select({
      id: landingPages.id,
      slug: landingPages.slug,
      name: landingPages.name,
      status: landingPages.status,
      productId: landingPages.productId,
      productName: products.name,
      productHandle: products.handle,
      imageCount: sql<number>`(
        SELECT COUNT(*) FROM landing_page_images
        WHERE landing_page_images.landing_page_id = landing_pages.id
      )`,
      publishedAt: landingPages.publishedAt,
      createdAt: landingPages.createdAt,
      updatedAt: landingPages.updatedAt,
      // Enough of the tracking override to badge the row — never the token.
      // A join rather than a request per row: a merchant running twenty pages
      // wants to see which are on their own pixel in one look.
      trackingPixelId: landingPagePixelConfig.pixelId,
      trackingConversionEvent: landingPagePixelConfig.conversionEvent,
      trackingEnabled: landingPagePixelConfig.enabled,
      trackingTestMode: landingPagePixelConfig.testMode,
    })
    .from(landingPages)
    .leftJoin(products, eq(landingPages.productId, products.id))
    .leftJoin(
      landingPagePixelConfig,
      eq(landingPagePixelConfig.landingPageId, landingPages.id),
    )
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(landingPages.createdAt));

  // $dynamic() because limit/offset are applied conditionally — drizzle's
  // static builder cannot chain .limit(undefined).
  let query = baseQuery.$dynamic();
  if (pagination.limit !== undefined) query = query.limit(pagination.limit);
  if (pagination.offset !== undefined) query = query.offset(pagination.offset);
  const rows = await query.all();

  return rows.map((row) => {
    const {
      trackingPixelId,
      trackingConversionEvent,
      trackingEnabled,
      trackingTestMode,
      ...rest
    } = row;
    return {
      ...rest,
      imageCount: Number(rest.imageCount),
      tracking: trackingPixelId
        ? {
            pixelId: trackingPixelId,
            conversionEvent: trackingConversionEvent!,
            enabled: Boolean(trackingEnabled),
            testMode: Boolean(trackingTestMode),
          }
        : null,
    };
  });
}

export async function listLandingPages(
  db: AppDb,
  filters: { productId?: string; status?: "draft" | "published" | "archived" } = {},
  pagination: LandingPageListPagination = {},
) {
  return resolveListRow(db, filters, pagination);
}

/** Generate the default slug: lp-<8 lowercase hex chars> — collision-checked by the caller. */
export function generateLandingPageSlug(): string {
  return `lp-${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;
}

/**
 * Full LP detail by id in TWO round trips (mirrors the slug path's shape):
 *   1. the landing page row by id
 *   2. ONE db.batch carrying images + product ref — a single HTTP
 *      call to D1 instead of three parallel-but-separate queries. Used by
 *      every REST detail read and every MCP write tool's post-mutation read.
 */
/** The page's own row, without its images or product: for checks and names. */
export async function getLandingPageRow(db: StoreDb, id: string) {
  return (await db.select().from(landingPages).where(eq(landingPages.id, id)).get()) ?? null;
}

export async function getLandingPageById(db: AppDb, id: string, delivery: MediaDelivery) {
  const row = await db
    .select()
    .from(landingPages)
    .where(eq(landingPages.id, id))
    .get();
  if (!row) return null;

  const results = await db.batch([
    db
      .select()
      .from(landingPageImages)
      .where(eq(landingPageImages.landingPageId, id))
      .orderBy(landingPageImages.position),
    db
      .select({ id: products.id, name: products.name, handle: products.handle, price: products.price })
      .from(products)
      .where(eq(products.id, row.productId)),
  ] as [BatchStatement, ...BatchStatement[]]);

  const images = (results[0] as unknown as typeof landingPageImages.$inferSelect[]) ?? [];
  const productRow = ((results[1] as unknown as Array<Record<string, unknown>>) ?? [])[0];

  return {
    ...row,
    images: landingImageViews(images, delivery),
    product: productRow
      ? (productRow as unknown as { id: string; name: string; handle: string; price: number })
      : null,
  };
}

type BatchStatement = Parameters<AppDb["batch"]>[0][number];

/**
 * Full LP detail by slug in TWO round trips (the public render path):
 *   1. the landing page row by slug
 *   2. ONE db.batch carrying images + product ref — a single HTTP
 *      call to D1 (batched statements), instead of re-selecting the row by
 *      id and issuing four more queries.
 */
export async function getLandingPageDetailBySlug(db: AppDb, slug: string, delivery: MediaDelivery) {
  const row = await db
    .select()
    .from(landingPages)
    .where(eq(landingPages.slug, slug))
    .get();
  if (!row) return null;

  const results = await db.batch([
    db
      .select()
      .from(landingPageImages)
      .where(eq(landingPageImages.landingPageId, row.id))
      .orderBy(landingPageImages.position),
    db
      .select({ id: products.id, name: products.name, handle: products.handle, price: products.price })
      .from(products)
      .where(eq(products.id, row.productId)),
    // Which pixel this page reports to, resolved INSIDE the batch the page
    // already runs. The landing page is where a merchant's ad money lands, so
    // knowing the answer costs it no extra round trip.
    db.select().from(storePixelConfig).limit(1),
    db
      .select()
      .from(landingPagePixelConfig)
      .where(eq(landingPagePixelConfig.landingPageId, row.id)),
  ] as [BatchStatement, ...BatchStatement[]]);

  const images = (results[0] as unknown as typeof landingPageImages.$inferSelect[]) ?? [];
  const productRow = ((results[1] as unknown as Array<Record<string, unknown>>) ?? [])[0];
  const storeTrackingRow = ((results[2] as unknown as StoreConfigRow[]) ?? [])[0];
  const pageTrackingRow = ((results[3] as unknown as PageConfigRow[]) ?? [])[0];

  return {
    ...row,
    images: landingImageViews(images, delivery),
    product: productRow
      ? (productRow as unknown as { id: string; name: string; handle: string; price: number })
      : null,
    // Safe by construction: publicTrackingFrom cannot return the token.
    tracking: publicTrackingFrom(storeTrackingRow, pageTrackingRow),
  };
}

export async function getLandingPageBySlug(db: AppDb, slug: string, delivery: MediaDelivery) {
  const row = await db
    .select()
    .from(landingPages)
    .where(eq(landingPages.slug, slug))
    .get();
  if (!row) return null;
  return getLandingPageById(db, row.id, delivery);
}

export async function createLandingPage(
  db: AppDb,
  data: CreateLandingPageData,
): Promise<{ id: string; slug: string }> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const slug = data.slug ?? generateLandingPageSlug();

  await db.insert(landingPages).values({
    id,
    slug,
    name: data.name,
    productId: data.productId,
    status: "draft",
    imageGap: data.imageGap ?? 0,
    metaTitle: data.metaTitle ?? null,
    metaDescription: data.metaDescription ?? null,
    createdAt: now,
    updatedAt: now,
  });

  return { id, slug };
}

export async function updateLandingPage(
  db: StoreDb,
  id: string,
  data: UpdateLandingPageData,
) {
  const now = new Date().toISOString();
  await db
    .update(landingPages)
    .set({
      ...(data.name !== undefined && { name: data.name }),
      ...(data.slug !== undefined && { slug: data.slug }),
      ...(data.imageGap !== undefined && { imageGap: data.imageGap }),
      ...(data.metaTitle !== undefined && { metaTitle: data.metaTitle ?? null }),
      ...(data.metaDescription !== undefined && { metaDescription: data.metaDescription ?? null }),
      updatedAt: now,
    })
    .where(eq(landingPages.id, id));
}

export async function publishLandingPage(db: AppDb, id: string) {
  const now = new Date().toISOString();
  await db
    .update(landingPages)
    .set({ status: "published", publishedAt: now, updatedAt: now })
    .where(eq(landingPages.id, id));
}

export async function unpublishLandingPage(db: AppDb, id: string) {
  const now = new Date().toISOString();
  await db
    .update(landingPages)
    .set({ status: "draft", updatedAt: now })
    .where(eq(landingPages.id, id));
}

export async function archiveLandingPage(db: AppDb, id: string) {
  const now = new Date().toISOString();
  await db
    .update(landingPages)
    .set({ status: "archived", updatedAt: now })
    .where(eq(landingPages.id, id));
}

/** Count orders attributed to a landing page — powers the delete guard. */
export async function countLandingPageOrders(db: AppDb, id: string): Promise<number> {
  const row = await db
    .select({ c: count() })
    .from(orders)
    .where(eq(orders.landingPageId, id))
    .get();
  return Number(row?.c ?? 0);
}

export async function deleteLandingPage(db: AppDb, id: string) {
  // Images cascade at the DB level; orders must be absent (guarded by the caller).
  await db.delete(landingPages).where(eq(landingPages.id, id));
}

/** Why a new order of a landing page's images is refused: each of its images, once, and no other. */
export type LandingImageOrderProblem =
  | { reason: "duplicate"; received: number }
  | { reason: "foreign"; imageId: string }
  | { reason: "incomplete"; expected: number; received: number };

/** The problem with ordering a page's images as `imageIds`, or null when it names each of `existingIds` once. */
export function landingImageOrderProblem(existingIds: readonly string[], imageIds: readonly string[]): LandingImageOrderProblem | null {
  if (new Set(imageIds).size !== imageIds.length) return { reason: "duplicate", received: imageIds.length };
  const existing = new Set(existingIds);
  const foreign = imageIds.find((imageId) => !existing.has(imageId));
  if (foreign !== undefined) return { reason: "foreign", imageId: foreign };
  if (imageIds.length !== existingIds.length) return { reason: "incomplete", expected: existingIds.length, received: imageIds.length };
  return null;
}

/**
 * Adds an image to the stack: at the end, or at `position` — the images from
 * there move down one. A position past the end is the end.
 */
export async function addLandingPageImage(
  db: BatchStoreDb,
  landingPageId: string,
  image: LandingPageImageInput,
  delivery: MediaDelivery,
) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const lastRow = await db
    .select({ maxPos: sql<number>`MAX(${landingPageImages.position})` })
    .from(landingPageImages)
    .where(eq(landingPageImages.landingPageId, landingPageId))
    .get();
  const end = Number(lastRow?.maxPos ?? 0) + 1;
  const position = Math.min(image.position ?? end, end);

  await db.batch([
    db
      .update(landingPageImages)
      .set({ position: sql`${landingPageImages.position} + 1` })
      .where(and(eq(landingPageImages.landingPageId, landingPageId), gte(landingPageImages.position, position))),
    db.insert(landingPageImages).values({
      id,
      landingPageId,
      mediaKey: image.mediaKey,
      altText: image.altText ?? null,
      source: image.source ?? "upload",
      position,
      width: image.width ?? null,
      height: image.height ?? null,
      createdAt: now,
    }),
  ]);

  return getLandingPageImages(db, landingPageId, delivery);
}

export async function getLandingPageImages(db: StoreDb, landingPageId: string, delivery: MediaDelivery) {
  const rows = await db.select().from(landingPageImages).where(eq(landingPageImages.landingPageId, landingPageId)).orderBy(landingPageImages.position).all();
  return landingImageViews(rows, delivery);
}

export async function getLandingPageImage(
  db: StoreDb,
  landingPageId: string,
  imageId: string,
) {
  return db
    .select()
    .from(landingPageImages)
    .where(
      and(
        eq(landingPageImages.id, imageId),
        eq(landingPageImages.landingPageId, landingPageId),
      ),
    )
    .get();
}

export async function reorderLandingPageImages(
  db: BatchStoreDb,
  landingPageId: string,
  imageIds: string[],
  delivery: MediaDelivery,
) {
  const now = new Date().toISOString();
  // One atomic batch: every position update + the parent touch in a SINGLE
  // round trip — the per-image await loop was N+1 sequential D1 calls.
  const statements: BatchStatement[] = imageIds.map((imageId, index) =>
    db
      .update(landingPageImages)
      .set({ position: index + 1 })
      .where(
        and(
          eq(landingPageImages.id, imageId),
          eq(landingPageImages.landingPageId, landingPageId),
        ),
      ),
  );
  // Touch the parent's updatedAt so the studio knows the stack changed.
  statements.push(
    db
      .update(landingPages)
      .set({ updatedAt: now })
      .where(eq(landingPages.id, landingPageId)),
  );
  await db.batch(statements as [BatchStatement, ...BatchStatement[]]);
  return getLandingPageImages(db, landingPageId, delivery);
}

export async function deleteLandingPageImage(
  db: StoreDb,
  landingPageId: string,
  imageId: string,
) {
  await db
    .delete(landingPageImages)
    .where(
      and(
        eq(landingPageImages.id, imageId),
        eq(landingPageImages.landingPageId, landingPageId),
      ),
    );
}

/** Landing pages that still exist and are published — the attribution-resolvable set. */
export async function findPublishedLandingPageIdBySlug(
  db: AppDb,
  slug: string,
): Promise<string | null> {
  const row = await db
    .select({ id: landingPages.id })
    .from(landingPages)
    .where(and(eq(landingPages.slug, slug), eq(landingPages.status, "published")))
    .get();
  return row?.id ?? null;
}

/**
 * Duplicate a landing page: new row (draft, fresh slug) plus
 * copies of every image row. Image rows SHARE the original R2 keys — R2
 * objects are immutable, so references are safe and cache-friendly; the
 * image-delete path reference-counts keys so a shared object is only
 * removed from R2 when the last row referencing it goes away.
 * Attributed orders and published state are NEVER copied — a duplicate is
 * a fresh creative test. The page's own documents (its
 * composition, one per theme) are copied, addressed to the new page.
 */
export async function duplicateLandingPage(db: AppDb, id: string): Promise<string | null> {
  const source = await db
    .select()
    .from(landingPages)
    .where(eq(landingPages.id, id))
    .get();
  if (!source) return null;

  const images = await db
    .select()
    .from(landingPageImages)
    .where(eq(landingPageImages.landingPageId, id))
    .orderBy(landingPageImages.position)
    .all();

  // A duplicate is a fresh creative test of the same product for the same
  // campaign, so it inherits the same pixel — like every other setting here,
  // and unlike its orders. The Studio shows it, so changing it is one
  // click; silently putting the copy on a different pixel would be the
  // surprising behaviour.
  const sourceTracking = await db
    .select()
    .from(landingPagePixelConfig)
    .where(eq(landingPagePixelConfig.landingPageId, id))
    .get();

  const newId = crypto.randomUUID();
  const now = new Date().toISOString();
  const slug = generateLandingPageSlug();

  const statements: BatchStatement[] = [
    db.insert(landingPages).values({
      id: newId,
      slug,
      name: `${source.name} (copy)`,
      productId: source.productId,
      status: "draft",
      imageGap: source.imageGap,
      metaTitle: source.metaTitle,
      metaDescription: source.metaDescription,
      createdAt: now,
      updatedAt: now,
    }),
  ];
  for (const image of images) {
    statements.push(
      db.insert(landingPageImages).values({
        id: crypto.randomUUID(),
        landingPageId: newId,
        mediaKey: image.mediaKey,
        altText: image.altText,
        source: image.source,
        position: image.position,
        width: image.width,
        height: image.height,
        createdAt: now,
      }),
    );
  }
  const copySurface = landingDocumentSurface(newId);
  statements.push(
    db.insert(pageDocuments).select(
      db
        .select(
          insertSelectRow(pageDocuments, {
            id: sql`lower(hex(randomblob(16)))`,
            storeId: pageDocuments.storeId,
            themeKey: pageDocuments.themeKey,
            surface: sql`${copySurface}`,
            document: sql`json_set(${pageDocuments.document}, '$.surface', ${copySurface})`,
            createdAt: sql`${now}`,
            updatedAt: sql`${now}`,
          }),
        )
        .from(pageDocuments)
        .where(eq(pageDocuments.surface, landingDocumentSurface(id))),
    ),
  );
  if (sourceTracking) {
    statements.push(
      db.insert(landingPagePixelConfig).values({
        ...sourceTracking,
        id: crypto.randomUUID(),
        landingPageId: newId,
        createdAt: now,
        updatedAt: now,
      }),
    );
  }
  await db.batch(statements as [BatchStatement, ...BatchStatement[]]);

  return newId;
}

export async function slugExists(db: AppDb, slug: string): Promise<boolean> {
  const row = await db
    .select({ id: landingPages.id })
    .from(landingPages)
    .where(eq(landingPages.slug, slug))
    .get();
  return row !== undefined;
}

/**
 * The storefront's public base URL — where landing page links point.
 *
 * Resolution order (single source of truth, zero hardcoding):
 *   1. The store's own domain (stores.domain, set by the merchant in Store
 *      Settings — each deployment connects its own custom domain).
 *   2. The caller's fallback (cod-server's optional STOREFRONT_URL var —
 *      for deployments without a custom domain yet).
 *   3. null — the caller renders a relative path.
 *
 * https is always assumed; the domain is stored as a bare hostname.
 */
export async function resolveStorefrontBaseUrl(
  db: AppDb,
  fallbackUrl?: string,
): Promise<string | null> {
  const store = await db
    .select({ domain: stores.domain })
    .from(stores)
    .limit(1)
    .get();
  if (store?.domain) return `https://${store.domain}`;
  const fallback = (fallbackUrl ?? "").replace(/\/+$/, "");
  return fallback || null;
}

/** Build the public landing page URL against a resolved base (null → relative). */
export function buildLandingPagePublicUrl(
  baseUrl: string | null,
  slug: string,
): string {
  const path = storefrontPath("landing", { slug });
  return baseUrl ? `${baseUrl}${path}` : path;
}
