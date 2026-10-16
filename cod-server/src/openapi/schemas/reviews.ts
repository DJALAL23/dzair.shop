/**
 * Review Schemas — reviews as the merchant works with them.
 */
import { z } from "@hono/zod-openapi";
import { MODERATION_STATUSES, REVIEW_MEDIA_KINDS, REVIEW_SOURCES } from "../../../../cod-shared/reviews/model";

export const ReviewMediaSchema = z
  .object({
    id: z.string(),
    kind: z.enum(REVIEW_MEDIA_KINDS),
    url: z.string().url().openapi({ description: "A photo at 1600 px at most (WebP), or the voice note as recorded" }),
    thumbUrl: z.string().url().nullable().openapi({ description: "A photo's 480 px version for lists" }),
    contentType: z.string(),
    bytes: z.number().int(),
    width: z.number().int().nullable(),
    height: z.number().int().nullable(),
    durationMs: z.number().int().nullable().openapi({ description: "A voice note's length" }),
  })
  .openapi("ReviewMedia", { description: "A photo or the voice note of a review" });

export const ReviewSchema = z
  .object({
    id: z.string().openapi({ example: "6f0c9b8e-3d2a-4e5f-8a7b-9c1d2e3f4a5b" }),
    productId: z.string(),
    productName: z.string().nullable(),
    orderId: z.string().nullable().openapi({ description: "The order it rests on; null for a store review without one" }),
    orderNumber: z.string().nullable().openapi({ example: "ORD-20261016-0042" }),
    customerId: z.string().nullable(),
    customerName: z.string().openapi({ example: "أحمد بن علي" }),
    rating: z.number().int().min(1).max(5).openapi({ example: 5 }),
    title: z.string().nullable().openapi({ example: "منتج ممتاز" }),
    body: z.string().openapi({ example: "جودة عالية وسعر مناسب" }),
    status: z.enum(MODERATION_STATUSES).openapi({ example: "pending" }),
    source: z.enum(REVIEW_SOURCES).openapi({ description: "Sent by a shopper (storefront) or entered by the store (merchant)" }),
    verified: z.boolean().openapi({ description: "Rests on a delivered order: the storefront shows it as a verified purchase" }),
    mediaDropped: z.number().int().openapi({ description: "Photos or voice notes received but not kept (unreadable, too long)" }),
    createdBy: z.string().nullable().openapi({ description: "The staff member who entered a store review" }),
    createdAt: z.string(),
    updatedAt: z.string(),
    media: z.array(ReviewMediaSchema),
  })
  .openapi("Review", { description: "A product review, as the merchant moderates it" });
