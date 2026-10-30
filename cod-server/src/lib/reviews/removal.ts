/**
 * Removing a review, or one of its files, for every caller (the dashboard
 * routes and the AI tools): the rows first, then the files released to the
 * Media Library — after the commit, never before, so a failed delete never
 * leaves a review pointing at missing files.
 */
import type { AppDb } from "@/db";
import { releaseShown } from "@/lib/media";
import type { Env } from "@/types/env";
import { deleteReview, deleteReviewMedia, type MerchantReview } from "../../../../cod-shared/queries/reviews";
import type { ReviewMediaKind } from "../../../../cod-shared/reviews/model";

export async function removeReview(db: AppDb, env: Env, id: string): Promise<MerchantReview | null> {
  const removed = await deleteReview(db, id);
  if (!removed) return null;
  await releaseShown(env, removed.fileKeys, `review ${id}`);
  return removed.review;
}

export async function removeReviewMedia(db: AppDb, env: Env, reviewId: string, mediaId: string): Promise<ReviewMediaKind | null> {
  const removed = await deleteReviewMedia(db, reviewId, mediaId);
  if (!removed) return null;
  await releaseShown(env, removed.fileKeys, `media ${mediaId} of review ${reviewId}`);
  return removed.kind;
}
