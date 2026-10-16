/**
 * Reviews as the storefront meets them: who may write one, and what is shown.
 *
 * A shopper has no account. What proves they bought is their order: its
 * number and the phone it was placed with — the number alone is guessable
 * (`ORD-<day>-<4 digits>`), the phone is not. They may review a product once
 * the order reached them (its shipment delivered), once per product of it,
 * and only a product they kept: a line refused in full at the door does not
 * count. A wrong number and a wrong phone answer the same, so nobody can find
 * out which orders exist.
 */
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { orders, reviewMedia, reviews, shipments, stores } from "../db/schema";
import type { AppDb } from "../db/client";
import { samePhone } from "../lib/phone";
import type { ReviewMediaKind, ReviewStatus } from "../reviews/model";
import { DEFAULT_REVIEW_POLICY, reviewPolicy, type ReviewPolicy } from "../reviews/policy";

export interface ReviewableProduct {
  productId: string;
  name: string;
  imageSrc: string | null;
  /** Already reviewed from this order: it cannot be reviewed again. */
  reviewed: boolean;
}

export interface ReviewableOrder {
  id: string;
  orderNumber: string;
  customerId: string;
  customerName: string;
  products: ReviewableProduct[];
}

export type OrderReviewAccess =
  | { ok: true; order: ReviewableOrder }
  | { ok: false; reason: "not_found" | "not_delivered" };

/**
 * The proof a shopper gives. `withoutPhone` exists only for storefronts built
 * on `@wocart/storefront` 1.5, whose review form sends no phone; it still
 * requires a delivered order, and goes once those storefronts are gone.
 */
export type PurchaseProof = { orderNumber: string; phone: string } | { orderNumber: string; withoutPhone: true };

export async function findReviewableOrder(db: AppDb, input: PurchaseProof): Promise<OrderReviewAccess> {
  const orderNumber = input.orderNumber.trim().toUpperCase();
  const [found] = await db
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      customerId: orders.customerId,
      customerName: orders.customerName,
      phone: orders.phone,
      deliveredAt: shipments.deliveredAt,
    })
    .from(orders)
    .leftJoin(shipments, eq(shipments.orderId, orders.id))
    .where(eq(orders.orderNumber, orderNumber))
    .limit(1);
  if (!found || ("phone" in input && !samePhone(found.phone, input.phone))) return { ok: false, reason: "not_found" };
  if (!found.deliveredAt) return { ok: false, reason: "not_delivered" };

  const lines = await db.all<{ productId: string; name: string; kept: number; imageSrc: string | null; reviewed: number }>(sql`
    select op.product_id as productId,
      min(op.product_name) as name,
      sum(op.quantity - op.returned_quantity) as kept,
      (select pi.src from product_images pi where pi.product_id = op.product_id order by pi.position limit 1) as imageSrc,
      exists (select 1 from reviews r where r.order_id = op.order_id and r.product_id = op.product_id) as reviewed
    from order_products op
    where op.order_id = ${found.id} and op.product_id is not null
    group by op.product_id
    order by min(op.created_at), op.product_id`);

  return {
    ok: true,
    order: {
      id: found.id,
      orderNumber: found.orderNumber,
      customerId: found.customerId,
      customerName: found.customerName,
      products: lines
        .filter((line) => Number(line.kept) > 0)
        .map((line) => ({ productId: line.productId, name: line.name, imageSrc: line.imageSrc ?? null, reviewed: Boolean(line.reviewed) })),
    },
  };
}

/** The store's review policy; a store row missing reads as the defaults with reviews off. */
export async function getReviewPolicy(db: AppDb, storeId: string): Promise<ReviewPolicy> {
  const [row] = await db
    .select({
      reviewsEnabled: stores.reviewsEnabled,
      reviewMaxPhotos: stores.reviewMaxPhotos,
      reviewVoiceMaxSeconds: stores.reviewVoiceMaxSeconds,
      reviewAutoPublish: stores.reviewAutoPublish,
    })
    .from(stores)
    .where(eq(stores.id, storeId))
    .limit(1);
  return row ? reviewPolicy(row) : { ...DEFAULT_REVIEW_POLICY, enabled: false };
}

// ─── What the storefront shows ───────────────────────────────────────────────

export interface PublicReviewMedia {
  id: string;
  kind: ReviewMediaKind;
  url: string;
  /** A photo's small version for lists. */
  thumbUrl: string | null;
  width: number | null;
  height: number | null;
  /** A voice note's length. */
  durationMs: number | null;
}

/** A review as anyone may see it: never its order, its customer or who entered it. */
export interface PublicReview {
  id: string;
  customerName: string;
  rating: number;
  title: string | null;
  body: string;
  createdAt: string;
  verified: boolean;
  media: PublicReviewMedia[];
}

/** One page of a product's approved reviews, newest first, with their media — one round trip. */
export async function listApprovedReviews(
  db: AppDb,
  query: { storeId: string; productId: string; limit: number; offset: number; mediaUrl: (key: string) => string },
): Promise<{ rows: PublicReview[]; total: number }> {
  const approved = and(eq(reviews.storeId, query.storeId), eq(reviews.productId, query.productId), eq(reviews.status, "approved"));
  const page = db
    .select({ id: reviews.id })
    .from(reviews)
    .where(approved)
    .orderBy(desc(reviews.createdAt), desc(reviews.id))
    .limit(query.limit)
    .offset(query.offset);
  const [rows, counted, media] = await db.batch([
    db
      .select({
        id: reviews.id,
        customerName: reviews.customerName,
        rating: reviews.rating,
        title: reviews.title,
        body: reviews.body,
        createdAt: reviews.createdAt,
        verified: reviews.verified,
      })
      .from(reviews)
      .where(approved)
      .orderBy(desc(reviews.createdAt), desc(reviews.id))
      .limit(query.limit)
      .offset(query.offset),
    db.select({ count: sql<number>`count(*)` }).from(reviews).where(approved),
    db
      .select({
        id: reviewMedia.id,
        reviewId: reviewMedia.reviewId,
        kind: reviewMedia.kind,
        r2Key: reviewMedia.r2Key,
        thumbKey: reviewMedia.thumbKey,
        width: reviewMedia.width,
        height: reviewMedia.height,
        durationMs: reviewMedia.durationMs,
      })
      .from(reviewMedia)
      .where(inArray(reviewMedia.reviewId, page))
      .orderBy(asc(reviewMedia.reviewId), asc(reviewMedia.position)),
  ]);

  const byReview = new Map<string, PublicReviewMedia[]>();
  for (const item of media) {
    const list = byReview.get(item.reviewId) ?? [];
    list.push({
      id: item.id,
      kind: item.kind,
      url: query.mediaUrl(item.r2Key),
      thumbUrl: item.thumbKey ? query.mediaUrl(item.thumbKey) : null,
      width: item.width,
      height: item.height,
      durationMs: item.durationMs,
    });
    byReview.set(item.reviewId, list);
  }
  return {
    rows: rows.map((row) => ({ ...row, media: byReview.get(row.id) ?? [] })),
    total: Number(counted[0]?.count ?? 0),
  };
}

// ─── Recording a shopper's review ────────────────────────────────────────────

export interface NewShopperReview {
  storeId: string;
  productId: string;
  order: Pick<ReviewableOrder, "id" | "orderNumber" | "customerId" | "customerName">;
  rating: number;
  title: string | null;
  body: string;
  status: Extract<ReviewStatus, "processing" | "pending" | "approved">;
  /** It rests on a delivered order. */
  verified: boolean;
}

/** Records it, or says the order already reviewed this product (even when two submissions race). */
export async function insertShopperReview(db: AppDb, review: NewShopperReview): Promise<{ ok: true; id: string } | { ok: false; reason: "already_reviewed" }> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  try {
    await db.insert(reviews).values({
      id,
      storeId: review.storeId,
      productId: review.productId,
      orderId: review.order.id,
      customerId: review.order.customerId,
      orderNumber: review.order.orderNumber,
      customerName: review.order.customerName,
      rating: review.rating,
      title: review.title,
      body: review.body,
      status: review.status,
      source: "storefront",
      verified: review.verified,
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
