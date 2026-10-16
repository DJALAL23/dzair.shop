import type { ModerationStatus, ReviewMediaKind, ReviewSource } from "../../../../cod-shared/reviews/model";

export type ReviewStatus = ModerationStatus;
export type { ReviewMediaKind, ReviewSource };

/** A photo or the voice note of a review. */
export interface ReviewMedia {
  id: string;
  kind: ReviewMediaKind;
  url: string;
  /** A photo's small version for lists. */
  thumbUrl: string | null;
  contentType: string;
  bytes: number;
  width: number | null;
  height: number | null;
  /** A voice note's length. */
  durationMs: number | null;
}

export interface Review {
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
  status: ReviewStatus;
  source: ReviewSource;
  /** Rests on a delivered order: shown as a verified purchase. */
  verified: boolean;
  /** Photos or voice notes received but not kept. */
  mediaDropped: number;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  media: ReviewMedia[];
}

export interface ReviewListResult {
  rows: Review[];
  total: number;
  pendingCount: number;
}

/** One of a customer's orders a store review may rest on. */
export interface ReviewOrderOption {
  id: string;
  orderNumber: string;
  createdAt: string;
  delivered: boolean;
  reviewed: boolean;
}

export interface NewStoreReview {
  productId: string;
  customerId?: string | null;
  customerName?: string | null;
  orderId?: string | null;
  rating: number;
  title?: string | null;
  body: string;
  uploads?: string[];
  publish: boolean;
}

export interface UploadedReviewFile {
  uploadId: string;
  kind: ReviewMediaKind;
  bytes: number;
}
