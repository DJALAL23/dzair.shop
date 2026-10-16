/**
 * What the storefront sends about reviews. Lengths and ranges come from the
 * review policy module, so the dashboard, the SDK and these checks agree.
 */
import { z } from "@hono/zod-openapi";
import { REVIEW_TEXT } from "../../../../../cod-shared/reviews/policy";

const optional = <T extends z.ZodTypeAny>(schema: T) => z.preprocess((v) => (v === "" || v == null ? undefined : v), schema.optional());

const orderNumber = z
  .string()
  .trim()
  .regex(/^ORD-\d{8}-\d+$/i, "Invalid order number format (expected ORD-YYYYMMDD-NNNN)")
  .openapi({ description: "The customer-facing order number, as on the thank-you page and the SMS", example: "ORD-20261016-1234" });

const phone = z.string().trim().min(6).max(32).openapi({ description: "The phone the order was placed with, however it is typed", example: "0551 23 45 67" });

export const reviewsQuerySchema = z.object({
  productId: z.string().min(1).openapi({ description: "Product ID to fetch reviews for." }),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export const reviewEligibilitySchema = z.object({
  orderNumber,
  phone,
  turnstileToken: optional(z.string().min(1).max(2048)).openapi({ description: "Required when the store has Turnstile on" }),
});

export const reviewSubmissionSchema = z.object({
  orderNumber,
  phone: optional(phone).openapi({
    description: "The phone the order was placed with. Storefronts on @wocart/storefront 1.5 send none: their reviews are text only, still for a delivered order. Deprecated without it.",
  }),
  productId: z.string().min(1).max(200),
  rating: z.number().int().min(1).max(5),
  title: optional(z.string().trim().max(REVIEW_TEXT.titleMax)),
  body: z.string().trim().max(REVIEW_TEXT.bodyMax).default("").openapi({ description: `At least ${REVIEW_TEXT.bodyMin} characters, unless a voice note says it` }),
  grant: optional(z.string().min(1).max(2048)).openapi({ description: "The upload grant from /store/reviews/eligibility, when files are sent" }),
  uploads: z.array(z.string().regex(/^[a-f0-9]{32}$/)).max(8).optional().openapi({ description: "Upload IDs from /store/reviews/uploads" }),
});

export type ReviewSubmissionInput = z.infer<typeof reviewSubmissionSchema>;
