/**
 * Reviews as the merchant works with them: the moderation list, decisions,
 * removal, and the reviews the store enters itself.
 *
 * A review still `processing` (its media job running) is the system's: it is
 * neither listed nor moderated until it lands. Removal returns the R2 keys of
 * the files that went with the rows, for the caller to delete after the
 * commit (cod-server `lib/reviews/removal.ts`).
 */
import { and, asc, desc, eq, inArray, lt, ne, sql, type SQL } from "drizzle-orm";
import { customers, products, reviewMedia, reviews } from "../db/schema";
import type { AppDb } from "../db/client";
import type { ModerationStatus, ReviewMediaKind, ReviewSource } from "../reviews/model";

/** @deprecated Use ModerationStatus from cod-shared/reviews/model. */
export type ReviewStatus = ModerationStatus;

export interface ReviewFilters {
  status?: ModerationStatus;
  productId?: string;
  source?: ReviewSource;
  /** Only reviews with at least one photo or voice note. */
  withMedia?: boolean;
  limit: number;
  offset: number;
}

export interface ReviewMediaRow {
  id: string;
  kind: ReviewMediaKind;
  r2Key: string;
  thumbKey: string | null;
  contentType: string;
  bytes: number;
  width: number | null;
  height: number | null;
  durationMs: number | null;
}

export interface MerchantReview {
  id: string;
  productId: string;
  productName: string | null;
  orderId: string | null;
  orderNumber: string | null;
  customerId: string | null;
  customerName: string;
  rating: number;
  title: string | null;
  body: string;
  status: ModerationStatus;
  source: ReviewSource;
  verified: boolean;
  mediaDropped: number;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  media: ReviewMediaRow[];
}

const landed = ne(reviews.status, "processing");

const reviewFields = {
  id: reviews.id,
  productId: reviews.productId,
  productName: products.name,
  orderId: reviews.orderId,
  orderNumber: reviews.orderNumber,
  customerId: reviews.customerId,
  customerName: reviews.customerName,
  rating: reviews.rating,
  title: reviews.title,
  body: reviews.body,
  status: reviews.status,
  source: reviews.source,
  verified: reviews.verified,
  mediaDropped: reviews.mediaDropped,
  createdBy: reviews.createdBy,
  createdAt: reviews.createdAt,
  updatedAt: reviews.updatedAt,
};

const mediaFields = {
  reviewId: reviewMedia.reviewId,
  id: reviewMedia.id,
  kind: reviewMedia.kind,
  r2Key: reviewMedia.r2Key,
  thumbKey: reviewMedia.thumbKey,
  contentType: reviewMedia.contentType,
  bytes: reviewMedia.bytes,
  width: reviewMedia.width,
  height: reviewMedia.height,
  durationMs: reviewMedia.durationMs,
};

function withMedia<R extends { id: string }>(rows: R[], media: Array<ReviewMediaRow & { reviewId: string }>) {
  const byReview = new Map<string, ReviewMediaRow[]>();
  for (const { reviewId, ...item } of media) byReview.set(reviewId, [...(byReview.get(reviewId) ?? []), item]);
  return rows.map((row) => ({ ...row, media: byReview.get(row.id) ?? [] }));
}

/** One page of reviews, newest first, with their media — one round trip. `pendingCount` ignores the filters (the badge). */
export async function getAllReviews(db: AppDb, filters: ReviewFilters): Promise<{ rows: MerchantReview[]; total: number; pendingCount: number }> {
  const conditions: SQL[] = [landed];
  if (filters.status) conditions.push(eq(reviews.status, filters.status));
  if (filters.productId) conditions.push(eq(reviews.productId, filters.productId));
  if (filters.source) conditions.push(eq(reviews.source, filters.source));
  if (filters.withMedia) conditions.push(sql`exists (select 1 from review_media m where m.review_id = ${reviews.id})`);
  const where = and(...conditions);
  const page = db.select({ id: reviews.id }).from(reviews).where(where).orderBy(desc(reviews.createdAt), desc(reviews.id)).limit(filters.limit).offset(filters.offset);

  const [rows, totalRows, pendingRows, media] = await db.batch([
    db
      .select(reviewFields)
      .from(reviews)
      .leftJoin(products, eq(reviews.productId, products.id))
      .where(where)
      .orderBy(desc(reviews.createdAt), desc(reviews.id))
      .limit(filters.limit)
      .offset(filters.offset),
    db.select({ count: sql<number>`count(*)` }).from(reviews).where(where),
    db.select({ count: sql<number>`count(*)` }).from(reviews).where(eq(reviews.status, "pending")),
    db.select(mediaFields).from(reviewMedia).where(inArray(reviewMedia.reviewId, page)).orderBy(asc(reviewMedia.reviewId), asc(reviewMedia.position)),
  ]);
  return {
    rows: withMedia(rows as Array<Omit<MerchantReview, "media">>, media),
    total: Number(totalRows[0]?.count ?? 0),
    pendingCount: Number(pendingRows[0]?.count ?? 0),
  };
}

/** A landed review with its media, or null (unknown, or still processing). */
export async function getReviewById(db: AppDb, id: string): Promise<MerchantReview | null> {
  const [rows, media] = await db.batch([
    db.select(reviewFields).from(reviews).leftJoin(products, eq(reviews.productId, products.id)).where(and(eq(reviews.id, id), landed)).limit(1),
    db.select(mediaFields).from(reviewMedia).where(eq(reviewMedia.reviewId, id)).orderBy(asc(reviewMedia.position)),
  ]);
  return rows[0] ? withMedia(rows as Array<Omit<MerchantReview, "media">>, media)[0] : null;
}

/** A moderation decision; never touches a review still processing. */
export async function updateReviewStatus(db: AppDb, id: string, status: ModerationStatus): Promise<MerchantReview | null> {
  await db.update(reviews).set({ status, updatedAt: new Date().toISOString() }).where(and(eq(reviews.id, id), landed));
  return getReviewById(db, id);
}

const keysOf = (rows: Array<{ r2Key: string; thumbKey: string | null }>) => rows.flatMap((row) => [row.r2Key, ...(row.thumbKey ? [row.thumbKey] : [])]);

/** Removes a review and its media rows; returns what it was and the R2 keys of its files, or null. */
export async function deleteReview(db: AppDb, id: string): Promise<{ review: MerchantReview; fileKeys: string[] } | null> {
  const review = await getReviewById(db, id);
  if (!review) return null;
  const removed = await db.delete(reviews).where(and(eq(reviews.id, id), landed)).returning({ id: reviews.id });
  if (removed.length === 0) return null;
  return { review, fileKeys: keysOf(review.media) };
}

/** Takes one photo or the voice note off a review; returns its R2 keys, or null when it is not on that review. */
export async function deleteReviewMedia(db: AppDb, reviewId: string, mediaId: string): Promise<{ fileKeys: string[]; kind: ReviewMediaKind } | null> {
  const [removed] = await db
    .delete(reviewMedia)
    .where(and(eq(reviewMedia.id, mediaId), eq(reviewMedia.reviewId, reviewId)))
    .returning({ r2Key: reviewMedia.r2Key, thumbKey: reviewMedia.thumbKey, kind: reviewMedia.kind });
  if (!removed) return null;
  await db.update(reviews).set({ updatedAt: new Date().toISOString() }).where(eq(reviews.id, reviewId));
  return { fileKeys: keysOf([removed]), kind: removed.kind };
}

// ─── Reviews the store enters ────────────────────────────────────────────────

export interface StoreReviewOrder {
  id: string;
  orderNumber: string;
  createdAt: string;
  delivered: boolean;
  /** This product was already reviewed from this order. */
  reviewed: boolean;
}

/**
 * The customer's orders that brought this product (and that they kept): what
 * a store review may rest on. A delivered one makes it a verified purchase.
 */
export async function storeReviewOrders(db: AppDb, input: { customerId: string; productId: string }): Promise<StoreReviewOrder[]> {
  const rows = await db.all<{ id: string; orderNumber: string; createdAt: string; delivered: number; reviewed: number }>(sql`
    select o.id as id, o.order_number as orderNumber, o.created_at as createdAt,
      exists (select 1 from shipments s where s.order_id = o.id and s.delivered_at is not null) as delivered,
      exists (select 1 from reviews r where r.order_id = o.id and r.product_id = ${input.productId}) as reviewed
    from orders o
    where o.customer_id = ${input.customerId}
      and exists (select 1 from order_products op where op.order_id = o.id and op.product_id = ${input.productId} and op.quantity > op.returned_quantity)
    order by o.created_at desc
    limit 50`);
  return rows.map((row) => ({ ...row, delivered: Boolean(row.delivered), reviewed: Boolean(row.reviewed) }));
}

export interface NewStoreReview {
  storeId: string;
  productId: string;
  customerId: string | null;
  customerName: string;
  order: { id: string; orderNumber: string; delivered: boolean } | null;
  rating: number;
  title: string | null;
  body: string;
  status: "processing" | "pending" | "approved";
  createdBy: string;
}

export async function insertStoreReview(db: AppDb, review: NewStoreReview): Promise<{ ok: true; id: string } | { ok: false; reason: "already_reviewed" }> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  try {
    await db.insert(reviews).values({
      id,
      storeId: review.storeId,
      productId: review.productId,
      orderId: review.order?.id ?? null,
      customerId: review.customerId,
      orderNumber: review.order?.orderNumber ?? null,
      customerName: review.customerName,
      rating: review.rating,
      title: review.title,
      body: review.body,
      status: review.status,
      source: "merchant",
      verified: review.order?.delivered ?? false,
      createdBy: review.createdBy,
      createdAt: now,
      updatedAt: now,
    });
  } catch (error) {
    if (/UNIQUE constraint failed: reviews\.order_id/.test(`${(error as Error)?.message} ${(error as { cause?: unknown })?.cause ?? ""}`)) {
      return { ok: false, reason: "already_reviewed" };
    }
    throw error;
  }
  return { ok: true, id };
}

/** The product and customer a store review names, as they are now. */
export async function storeReviewSubjects(db: AppDb, input: { productId: string; customerId: string | null }) {
  const productQuery = db.select({ id: products.id, name: products.name }).from(products).where(eq(products.id, input.productId)).limit(1);
  if (!input.customerId) return { product: (await productQuery)[0] ?? null, customer: null };
  const [product, customer] = await db.batch([
    productQuery,
    db.select({ id: customers.id, name: customers.name }).from(customers).where(eq(customers.id, input.customerId)).limit(1),
  ]);
  return { product: product[0] ?? null, customer: customer[0] ?? null };
}

// ─── The media job's end ─────────────────────────────────────────────────────

/**
 * A review still `processing` lands without its files: the media job could
 * not start, or kept none of them. Leaves any other review untouched.
 */
export async function settleWithoutMedia(db: AppDb, id: string, outcome: { status: "pending" | "approved"; dropped: number }) {
  await db
    .update(reviews)
    .set({ status: outcome.status, mediaDropped: outcome.dropped, updatedAt: new Date().toISOString() })
    .where(and(eq(reviews.id, id), eq(reviews.status, "processing")));
}

/**
 * Reviews still `processing` long after they came in — their media job never
 * finished — go to the merchant's queue without their files, so none is lost.
 * Returns how many.
 */
export async function settleStuckReviews(db: AppDb, receivedBefore: string): Promise<number> {
  const settled = await db
    .update(reviews)
    .set({ status: "pending", mediaDropped: sql`max(${reviews.mediaDropped}, 1)`, updatedAt: new Date().toISOString() })
    .where(and(eq(reviews.status, "processing"), lt(reviews.createdAt, receivedBefore)))
    .returning({ id: reviews.id });
  return settled.length;
}
