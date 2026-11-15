/**
 * A customer's review reaching the store (`review.submitted`). It is recorded
 * with the write that lands the review — at once, or once its photos and
 * voice note are ready — so it is told once, when the merchant can read it,
 * and only for a shopper's review of one of their orders.
 */

import { sql, type SQL } from "drizzle-orm";
import type { AppDb } from "../db/client";
import type { Author } from "../events/actor";
import { recordEvent } from "../events/record";
import { orderSnapshot, reviewSnapshot } from "../events/snapshots";

const CUSTOMER: Author = { actor: { kind: "shopper", id: null, name: null }, origin: "storefront" };

/** The statement that records it, after the one that lands the review; with `when`, only while that holds too. */
export function recordReviewSubmitted(db: AppDb, reviewId: string, when?: SQL) {
  const landed = sql`exists (select 1 from reviews r where r.id = ${reviewId} and r.source = 'storefront' and r.order_id is not null and r.status in ('pending', 'approved'))`;
  const orderId = sql`(select r.order_id from reviews r where r.id = ${reviewId})`;
  return recordEvent(
    db,
    {
      type: "review.submitted",
      subjectId: reviewId,
      orderId,
      occurredAt: sql`(select r.created_at from reviews r where r.id = ${reviewId})`,
      ...CUSTOMER,
      data: { review: reviewSnapshot(reviewId), order: orderSnapshot(orderId) },
    },
    when ? sql`${when} and ${landed}` : landed,
  );
}
