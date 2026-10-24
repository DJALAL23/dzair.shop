/**
 * Where this theme mounts the SDK's same-origin routes (`src/pages/api/…`):
 * the one list the browser scripts read. A guard checks that each path has its
 * route file and each route file its path.
 */
export const API_PATHS = {
  cartValidate: "/api/cart/validate",
  communes: "/api/communes",
  otpSend: "/api/otp/send",
  otpVerify: "/api/otp/verify",
  abandonedUpsert: "/api/abandoned",
  abandonedConvert: "/api/abandoned/convert",
  reviewsList: "/api/product-reviews",
  reviewEligibility: "/api/review-eligibility",
  reviewUpload: "/api/review-upload",
  reviewSubmit: "/api/submit-review",
} as const;
