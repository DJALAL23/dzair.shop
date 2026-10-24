/**
 * What a review refusal says: the review form's copy key for every code the
 * platform names, so a code without words fails the type check rather than
 * reaching a shopper as the general sentence.
 */
import type { ReviewRefusalCode } from "@wocart/storefront";

/** The step a refusal came from: `VALIDATION_FAILED` is a malformed order number when finding, a review too short when submitting. */
export type ReviewStep = "find" | "upload" | "submit";

export const REVIEW_REFUSAL_COPY: Record<ReviewRefusalCode, string> = {
  VALIDATION_FAILED: "errorOrderFormat",
  ORDER_NOT_FOUND: "errorInvalidOrder",
  REVIEWS_DISABLED: "errorDisabled",
  REVIEW_ORDER_NOT_DELIVERED: "errorNotDelivered",
  REVIEW_RATE_LIMITED: "errorRateLimited",
  ORDER_ALREADY_REVIEWED: "errorDuplicate",
  PRODUCT_NOT_IN_ORDER: "errorProduct",
  REVIEW_UPLOAD_GRANT_INVALID: "errorGrant",
  REVIEW_UPLOAD_NOT_FOUND: "errorUploadMissing",
  REVIEW_MEDIA_LIMIT: "errorMediaLimit",
  INVALID_FILE_TYPE: "errorFileType",
  FILE_TOO_LARGE: "errorFileTooLarge",
};

/** The copy key for a refusal: `minLength` for a review too short, `errorGeneric` for a code this theme does not know or no answer at all. */
export function reviewRefusalKey(code: string | null, step: ReviewStep): string {
  if (code === "VALIDATION_FAILED" && step === "submit") return "minLength";
  return code !== null && Object.hasOwn(REVIEW_REFUSAL_COPY, code) ? REVIEW_REFUSAL_COPY[code as ReviewRefusalCode] : "errorGeneric";
}
