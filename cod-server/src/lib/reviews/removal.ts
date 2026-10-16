/**
 * Removing a review, or one of its files, for every caller (the dashboard
 * routes and the AI tools): the rows first, then the R2 files — after the
 * commit, never before, so a failed delete never leaves a review pointing at
 * missing files. A file that cannot be removed now is logged and left.
 */
import type { AppDb } from "@/db";
import { deleteReview, deleteReviewMedia, type MerchantReview } from "../../../../cod-shared/queries/reviews";
import type { ReviewMediaKind } from "../../../../cod-shared/reviews/model";

async function deleteFiles(bucket: Pick<R2Bucket, "delete"> | undefined, keys: string[], what: string) {
  if (!bucket || keys.length === 0) return;
  try {
    await bucket.delete(keys);
  } catch (error) {
    console.error(`[reviews] ${what} removed; ${keys.length} file(s) left in storage`, error);
  }
}

export async function removeReview(db: AppDb, bucket: Pick<R2Bucket, "delete"> | undefined, id: string): Promise<MerchantReview | null> {
  const removed = await deleteReview(db, id);
  if (!removed) return null;
  await deleteFiles(bucket, removed.fileKeys, `review ${id}`);
  return removed.review;
}

export async function removeReviewMedia(
  db: AppDb,
  bucket: Pick<R2Bucket, "delete"> | undefined,
  reviewId: string,
  mediaId: string,
): Promise<ReviewMediaKind | null> {
  const removed = await deleteReviewMedia(db, reviewId, mediaId);
  if (!removed) return null;
  await deleteFiles(bucket, removed.fileKeys, `media ${mediaId} of review ${reviewId}`);
  return removed.kind;
}
