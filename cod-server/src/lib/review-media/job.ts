/**
 * What a review's media job carries from the submission to the workflow
 * (CodReviewMediaWorkflow): R2 keys and facts, never file bytes — workflow
 * parameters are capped at 1 MiB.
 */
import type { ReviewMediaKind } from "../../../../cod-shared/reviews/model";

export interface ReviewMediaUpload {
  key: string;
  kind: ReviewMediaKind;
  contentType: string;
  bytes: number;
  /** A voice note's length as the recorder reported it: shown only when the file does not say, never above the store's limit. */
  declaredDurationMs?: number;
}

export interface ReviewMediaJob {
  reviewId: string;
  uploads: ReviewMediaUpload[];
  /** The longest voice note the store allowed when the review was sent. */
  voiceMaxSeconds: number | null;
  /** Where the review lands once at least one file is kept, and when none is. */
  statusWithMedia: "pending" | "approved";
  statusWithoutMedia: "pending" | "approved";
}

/** One instance per review, forever: a second start for the same review is refused by Workflows. */
export function reviewMediaInstanceId(reviewId: string): string {
  return `review-${reviewId}`;
}
