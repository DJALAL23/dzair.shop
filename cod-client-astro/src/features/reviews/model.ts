import type { Translate } from "@/i18n/core";
import { MODERATION_STATUSES, REVIEW_SOURCES } from "../../../../cod-shared/reviews/model";
import type { Review, ReviewMedia, ReviewSource, ReviewStatus } from "./types";

export const REVIEW_STATUSES: readonly ReviewStatus[] = MODERATION_STATUSES;

export function parseReviewStatus(value: string | undefined | null): ReviewStatus | undefined {
  return REVIEW_STATUSES.includes(value as ReviewStatus) ? (value as ReviewStatus) : undefined;
}

/** What narrows the moderation list, as kept in the page's address. */
export interface ReviewView {
  status: ReviewStatus | "all";
  source: ReviewSource | "all";
  withMedia: boolean;
  page: number;
}

export function readReviewView(search: string): ReviewView {
  const params = new URLSearchParams(search);
  const source = params.get("source");
  return {
    status: parseReviewStatus(params.get("status")) ?? "all",
    source: (REVIEW_SOURCES as readonly string[]).includes(source ?? "") ? (source as ReviewSource) : "all",
    withMedia: params.get("media") === "1",
    page: Math.max(1, parseInt(params.get("page") ?? "1", 10) || 1),
  };
}

export function buildReviewsUrl(view: ReviewView) {
  const params = new URLSearchParams();
  if (view.status !== "all") params.set("status", view.status);
  if (view.source !== "all") params.set("source", view.source);
  if (view.withMedia) params.set("media", "1");
  if (view.page > 1) params.set("page", String(view.page));
  const qs = params.toString();
  return qs ? `/reviews?${qs}` : "/reviews";
}

/** Why a review action was refused, in the merchant's words. */
export function reviewErrorMessage(cause: unknown, t: Translate) {
  const error = cause && typeof cause === "object" ? (cause as { code?: unknown; context?: Record<string, unknown> }) : {};
  switch (error.code) {
    case "REVIEW_NOT_FOUND":
      return t("error_not_found");
    case "ORDER_ALREADY_REVIEWED":
      return t("error_already_reviewed");
    case "PRODUCT_NOT_IN_ORDER":
      return t("error_not_in_order");
    case "FILE_TOO_LARGE":
      return t("error_file_too_large");
    case "INVALID_FILE_TYPE":
      return t("error_file_type");
    case "REVIEW_MEDIA_LIMIT":
      return error.context?.kind === "audio" ? t("error_one_voice") : t("error_too_many_photos", { count: Number(error.context?.max ?? 0) });
    case "REVIEW_UPLOAD_NOT_FOUND":
      return t("error_upload_missing");
    case "VALIDATION_FAILED":
      return error.context?.field === "body" ? t("error_body_short", { count: Number(error.context?.min ?? 10) }) : t("error_generic");
    case "REQUIRED_FIELD_MISSING":
      return error.context?.field === "customerName" ? t("error_customer_required") : t("error_generic");
    default:
      return t("error_generic");
  }
}

export function formatReviewDate(value: string, locale: "ar" | "en" | "fr") {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-DZ" : `${locale}-DZ`, {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

/** A voice note's length as a player shows it: 0:07, 1:30. */
export function formatDuration(ms: number | null): string | null {
  if (ms === null || !Number.isFinite(ms) || ms <= 0) return null;
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function photosOf(review: Pick<Review, "media">): ReviewMedia[] {
  return review.media.filter((item) => item.kind === "image");
}

export function voiceOf(review: Pick<Review, "media">): ReviewMedia | null {
  return review.media.find((item) => item.kind === "audio") ?? null;
}
