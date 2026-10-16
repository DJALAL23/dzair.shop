import { z } from "@hono/zod-openapi";
import { MODERATION_STATUSES, REVIEW_SOURCES } from "../../../../cod-shared/reviews/model";
import { REVIEW_TEXT } from "../../../../cod-shared/reviews/policy";

export const listQuerySchema = z.object({
  status: z.enum(MODERATION_STATUSES).optional().openapi({ description: "Filter by moderation status" }),
  productId: z.string().optional().openapi({ description: "Filter by product ID" }),
  source: z.enum(REVIEW_SOURCES).optional().openapi({ description: "Sent by a shopper (storefront) or entered by the store (merchant)" }),
  withMedia: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional()
    .openapi({ description: "Only reviews with a photo or a voice note" }),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export const updateBodySchema = z.object({
  status: z.enum(MODERATION_STATUSES).openapi({ description: "New moderation status" }),
});

const optional = <T extends z.ZodTypeAny>(schema: T) => z.preprocess((v) => (v === "" ? undefined : v), schema.nullable().optional());

export const createReviewSchema = z.object({
  productId: z.string().min(1),
  customerId: optional(z.string().min(1)).openapi({ description: "A customer of the list; their name is shown unless customerName is given" }),
  customerName: optional(z.string().trim().max(REVIEW_TEXT.nameMax)).openapi({ description: "The name shown; required without a customer" }),
  orderId: optional(z.string().min(1)).openapi({ description: "One of the customer's orders that brought the product — a delivered one makes it a verified purchase" }),
  rating: z.number().int().min(1).max(5),
  title: optional(z.string().trim().max(REVIEW_TEXT.titleMax)),
  body: z.string().trim().max(REVIEW_TEXT.bodyMax).default("").openapi({ description: `At least ${REVIEW_TEXT.bodyMin} characters, unless a voice note says it` }),
  uploads: z.array(z.string().regex(/^[a-f0-9]{32}$/)).max(8).optional().openapi({ description: "Upload IDs from POST /api/reviews/uploads" }),
  publish: z.boolean().default(true).openapi({ description: "Publish at once (default), or keep it pending" }),
});

export const orderOptionsQuerySchema = z.object({
  customerId: z.string().min(1),
  productId: z.string().min(1),
});
