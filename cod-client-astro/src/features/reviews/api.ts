import { apiFetch } from "@/lib/api";
import type { NewStoreReview, Review, ReviewListResult, ReviewOrderOption, ReviewSource, ReviewStatus, UploadedReviewFile } from "./types";

interface ReviewListEnvelope {
  success: boolean;
  data: Review[];
  count?: number;
  total: number;
  pendingCount: number;
}

interface DataEnvelope<T> {
  success: boolean;
  data: T;
  message?: string;
}

function json(init: RequestInit = {}): RequestInit {
  return {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  };
}

export interface ReviewListParams {
  status?: ReviewStatus;
  productId?: string;
  source?: ReviewSource;
  withMedia?: boolean;
  limit?: number;
  offset?: number;
}

export async function listReviews(params: ReviewListParams = {}) {
  const query = new URLSearchParams({
    limit: String(params.limit ?? 20),
    offset: String(params.offset ?? 0),
  });
  for (const key of ["status", "productId", "source"] as const) {
    const value = params[key];
    if (value) query.set(key, value);
  }
  if (params.withMedia) query.set("withMedia", "true");
  const envelope = await apiFetch<ReviewListEnvelope>(`/api/reviews?${query}`);
  return { rows: envelope.data, total: envelope.total, pendingCount: envelope.pendingCount } satisfies ReviewListResult;
}

export function updateReviewStatus(id: string, status: ReviewStatus) {
  return apiFetch<DataEnvelope<Review>>(`/api/reviews/${encodeURIComponent(id)}`, json({ method: "PATCH", body: JSON.stringify({ status }) }));
}

export function deleteReview(id: string) {
  return apiFetch<DataEnvelope<null>>(`/api/reviews/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/** Takes one photo or the voice note off a review; answers the review as it now is. */
export async function deleteReviewMedia(reviewId: string, mediaId: string) {
  return (await apiFetch<DataEnvelope<Review>>(`/api/reviews/${encodeURIComponent(reviewId)}/media/${encodeURIComponent(mediaId)}`, { method: "DELETE" })).data;
}

/** Sends one photo or voice note for a review being entered; name its uploadId when creating it. */
export async function uploadReviewFile(file: Blob, durationMs?: number) {
  return (
    await apiFetch<DataEnvelope<UploadedReviewFile>>("/api/reviews/uploads", {
      method: "POST",
      body: file,
      headers: { "Content-Type": "application/octet-stream", ...(durationMs ? { "X-Media-Duration-Ms": String(Math.round(durationMs)) } : {}) },
    })
  ).data;
}

export async function createStoreReview(review: NewStoreReview) {
  return (
    await apiFetch<DataEnvelope<{ id: string; status: "processing" | "pending" | "approved"; verified: boolean; review: Review | null }>>(
      "/api/reviews",
      json({ method: "POST", body: JSON.stringify(review) }),
    )
  ).data;
}

/** The customer's orders that brought the product: what a store review may rest on. */
export async function listReviewOrderOptions(customerId: string, productId: string) {
  const query = new URLSearchParams({ customerId, productId });
  return (await apiFetch<DataEnvelope<ReviewOrderOption[]>>(`/api/reviews/order-options?${query}`)).data;
}
