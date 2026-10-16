/**
 * Reviews Routes — the merchant's side: moderate what shoppers send, remove a
 * review or one of its files, and enter a review a customer gave the store.
 * Built with defineRoute() — the standard route-builder pattern.
 */
import { OpenAPIHono, z } from "@hono/zod-openapi";
import type { AppContext } from "@/types";
import { defineRoute } from "@/lib/route-builder";
import { SCOPES } from "../../../../cod-shared/rbac/scopes";
import { REVIEW_MEDIA_KINDS } from "../../../../cod-shared/reviews/model";
import * as h from "./handlers";
import { ReviewSchema, SuccessResponseSchema } from "@/openapi/schemas";
import { createReviewSchema, listQuerySchema, orderOptionsQuerySchema, updateBodySchema } from "./validation";

const jsonContent = <T extends z.ZodType>(schema: T) => ({ "application/json": { schema } });
const idParams = z.object({ id: z.string().openapi({ description: "Review ID" }) });

const listReviewsRoute = defineRoute({
  method: "get",
  path: "/",
  auth: { scope: SCOPES.REVIEWS_READ },
  tags: ["Reviews"],
  summary: "List reviews",
  description: "Reviews newest first, with their photos and voice note, filtered by status, product, who entered them, or having media. A review whose files are still being prepared is not listed yet.",
  operationId: "listReviews",
  query: listQuerySchema,
  responses: {
    200: {
      description: "One page of reviews",
      content: jsonContent(
        z.object({
          success: z.boolean(),
          data: z.array(ReviewSchema),
          count: z.number().int(),
          total: z.number().int().openapi({ description: "Matching reviews across all pages" }),
          pendingCount: z.number().int().openapi({ description: "Reviews waiting for a decision, whatever the filters (the badge)" }),
        }),
      ),
    },
  },
  handler: h.listReviews,
});

const getReviewRoute = defineRoute({
  method: "get",
  path: "/{id}",
  auth: { scope: SCOPES.REVIEWS_READ },
  tags: ["Reviews"],
  summary: "Get a review",
  description: "One review with its photos and voice note.",
  operationId: "getReview",
  params: idParams,
  responses: { 200: { description: "The review", content: jsonContent(SuccessResponseSchema(ReviewSchema)) }, 404: { description: "No such review (REVIEW_NOT_FOUND)" } },
  handler: h.getReview,
});

const updateReviewRoute = defineRoute({
  method: "patch",
  path: "/{id}",
  auth: { scope: SCOPES.REVIEWS_MANAGE },
  tags: ["Reviews"],
  summary: "Approve, reject, or re-queue a review",
  description: "approved shows it on the storefront and counts it in the product's rating; rejected hides it; pending puts it back in the queue.",
  operationId: "updateReview",
  params: idParams,
  body: updateBodySchema,
  responses: { 200: { description: "The review with its new status", content: jsonContent(SuccessResponseSchema(ReviewSchema)) }, 404: { description: "No such review (REVIEW_NOT_FOUND)" } },
  handler: h.updateReview,
});

const deleteReviewRoute = defineRoute({
  method: "delete",
  path: "/{id}",
  auth: { scope: SCOPES.REVIEWS_MANAGE },
  tags: ["Reviews"],
  summary: "Delete a review",
  description: "Removes the review for good, its photos and voice note with it.",
  operationId: "deleteReview",
  params: idParams,
  responses: { 200: { description: "Review deleted", content: jsonContent(z.object({ success: z.boolean() })) }, 404: { description: "No such review (REVIEW_NOT_FOUND)" } },
  handler: h.deleteReview,
});

const deleteMediaRoute = defineRoute({
  method: "delete",
  path: "/{id}/media/{mediaId}",
  auth: { scope: SCOPES.REVIEWS_MANAGE },
  tags: ["Reviews"],
  summary: "Remove a review's photo or voice note",
  description: "Takes one file off the review — a face, a phone number — and keeps the review.",
  operationId: "deleteReviewMedia",
  params: z.object({ id: z.string(), mediaId: z.string() }),
  responses: { 200: { description: "The review without that file", content: jsonContent(SuccessResponseSchema(ReviewSchema)) }, 404: { description: "No such review or file" } },
  handler: h.deleteMedia,
});

const createReviewRoute = defineRoute({
  method: "post",
  path: "/",
  auth: { scope: SCOPES.REVIEWS_CREATE },
  tags: ["Reviews"],
  summary: "Enter a review a customer gave the store",
  description: `For a review received by WhatsApp, phone or in person. It names the product and a customer (from the list, or a typed name) and may rest on one of the customer's orders that brought the product — **only a delivered one makes it a verified purchase**. It carries today's date. Photos and a voice note are sent first to \`POST /api/reviews/uploads\`; with them the review is prepared in the background (\`status: processing\`, then published or pending).`,
  operationId: "createReview",
  body: createReviewSchema,
  responses: {
    201: {
      description: "Review entered",
      content: jsonContent(
        z.object({
          success: z.boolean(),
          data: z.object({
            id: z.string(),
            status: z.enum(["processing", "pending", "approved"]),
            verified: z.boolean(),
            review: ReviewSchema.nullable().openapi({ description: "null while its files are being prepared" }),
          }),
        }),
      ),
    },
    404: { description: "Unknown product or customer" },
    409: { description: "This product was already reviewed from this order (ORDER_ALREADY_REVIEWED)" },
    422: { description: "The order did not bring this product, or a file problem (PRODUCT_NOT_IN_ORDER / REVIEW_UPLOAD_NOT_FOUND / REVIEW_MEDIA_LIMIT)" },
  },
  handler: h.createReview,
});

const uploadRoute = defineRoute({
  method: "post",
  path: "/uploads",
  auth: { scope: SCOPES.REVIEWS_CREATE },
  tags: ["Reviews"],
  summary: "Send a photo or voice note for a review being entered",
  description: "The file itself as the request body (a photo, or a voice note up to 120 s; its length as recorded in **X-Media-Duration-Ms** when known). Name the returned `uploadId`s when creating the review.",
  operationId: "uploadReviewMedia",
  bodyContent: { "application/octet-stream": { schema: z.any().openapi({ type: "string", format: "binary" }) } },
  responses: {
    201: { description: "Received", content: jsonContent(z.object({ success: z.boolean(), data: z.object({ uploadId: z.string(), kind: z.enum(REVIEW_MEDIA_KINDS), bytes: z.number().int() }) })) },
    400: { description: "No file, too large, or not a photo or voice note" },
  },
  handler: h.uploadMedia,
});

const orderOptionsRoute = defineRoute({
  method: "get",
  path: "/order-options",
  auth: { scope: SCOPES.REVIEWS_CREATE },
  tags: ["Reviews"],
  summary: "A customer's orders that brought a product",
  description: "What a store review may rest on: the customer's orders that brought this product and that they kept, newest first, each saying whether it was delivered and already reviewed.",
  operationId: "listReviewOrderOptions",
  query: orderOptionsQuerySchema,
  responses: {
    200: {
      description: "The orders",
      content: jsonContent(
        z.object({
          success: z.boolean(),
          data: z.array(z.object({ id: z.string(), orderNumber: z.string(), createdAt: z.string(), delivered: z.boolean(), reviewed: z.boolean() })),
        }),
      ),
    },
  },
  handler: h.orderOptions,
});

const router = new OpenAPIHono<AppContext>();
router.openapi(listReviewsRoute.route, listReviewsRoute.handler);
router.openapi(orderOptionsRoute.route, orderOptionsRoute.handler);
router.openapi(createReviewRoute.route, createReviewRoute.handler);
router.openapi(uploadRoute.route, uploadRoute.handler);
router.openapi(getReviewRoute.route, getReviewRoute.handler);
router.openapi(updateReviewRoute.route, updateReviewRoute.handler);
router.openapi(deleteReviewRoute.route, deleteReviewRoute.handler);
router.openapi(deleteMediaRoute.route, deleteMediaRoute.handler);

export default router;
