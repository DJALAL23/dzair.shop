/**
 * Reviews on the storefront: show a product's approved reviews, and take a
 * shopper's — find the order, send photos and a voice note, submit.
 * Mounted under /store/reviews (store API key). Built with defineRoute().
 */
import { MediaImageSchema } from "@/openapi/schemas";
import { OpenAPIHono, z } from "@hono/zod-openapi";
import type { AppContext } from "@/types";
import { defineRoute } from "@/lib/route-builder";
import * as h from "./handlers";
import { reviewEligibilitySchema, reviewsQuerySchema, reviewSubmissionSchema } from "./validation";
import { REVIEW_MEDIA_KINDS, REVIEW_VOICE_LENGTHS } from "../../../../../cod-shared/reviews/model";

const jsonContent = <T extends z.ZodType>(schema: T) => ({ "application/json": { schema } });
const envelope = <T extends z.ZodType>(data: T) => jsonContent(z.object({ success: z.boolean().openapi({ example: true }), data }));

const reviewMediaSchema = z.object({
  id: z.string(),
  kind: z.enum(REVIEW_MEDIA_KINDS),
  url: z.string().url().openapi({ description: "A photo at 1600 px at most, or the voice note as recorded" }),
  thumbUrl: z.string().url().nullable().openapi({ description: "A photo's small version for lists" }),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  durationMs: z.number().int().nullable().openapi({ description: "A voice note's length" }),
});

const reviewItemSchema = z.object({
  id: z.string(),
  customerName: z.string(),
  rating: z.number().int().min(1).max(5),
  title: z.string().nullable(),
  body: z.string(),
  createdAt: z.string(),
  verified: z.boolean().openapi({ description: "Rests on an order that reached its customer (a verified purchase)" }),
  media: z.array(reviewMediaSchema),
});

const listRoute = defineRoute({
  method: "get",
  path: "/",
  auth: "store",
  tags: ["Store API"],
  summary: "List a product's approved reviews",
  description: "A product's approved reviews, newest first, with their photos and voice note. Empty when the store turned reviews off.",
  operationId: "listStoreReviews",
  query: reviewsQuerySchema,
  responses: {
    200: {
      description: "One page of approved reviews",
      content: jsonContent(
        z.object({
          success: z.boolean(),
          data: z.array(reviewItemSchema),
          count: z.number().int(),
          total: z.number().int().openapi({ description: "Approved reviews of this product" }),
        }),
      ),
    },
  },
  handler: h.listReviews,
});

const eligibilityRoute = defineRoute({
  method: "post",
  path: "/eligibility",
  auth: "store",
  tags: ["Store API"],
  summary: "Find an order to review",
  description: `Proves the purchase with the order number **and the phone it was placed with**, and answers what can be reviewed: the order's products the shopper kept (each once), and — when the store takes photos or a voice note — what may be attached and an **upload grant** for \`PUT /store/reviews/uploads\` (30 minutes).

A wrong number and a wrong phone both answer **404 ORDER_NOT_FOUND**. An order not delivered yet answers **422 REVIEW_ORDER_NOT_DELIVERED**. Attempts are limited per order number (**422 REVIEW_RATE_LIMITED**). Turnstile is not asked here: it guards checkout.`,
  operationId: "checkStoreReviewEligibility",
  body: reviewEligibilitySchema,
  responses: {
    200: {
      description: "The order can be reviewed",
      content: envelope(
        z.object({
          orderNumber: z.string(),
          customerName: z.string(),
          products: z.array(
            z.object({
              productId: z.string(),
              name: z.string(),
              image: MediaImageSchema.nullable().openapi({ description: "The product's first image" }),
              reviewed: z.boolean().openapi({ description: "Already reviewed from this order" }),
            }),
          ),
          media: z
            .object({
              maxPhotos: z.number().int().min(0),
              voiceMaxSeconds: z.number().int().nullable().openapi({ description: `The longest voice note, in seconds (${REVIEW_VOICE_LENGTHS.join(", ")}); null: no voice note` }),
              grant: z.string().openapi({ description: "Send as the X-Review-Grant header of each upload, and as `grant` on submit" }),
              expiresAt: z.number().int().openapi({ description: "Unix seconds" }),
            })
            .nullable()
            .openapi({ description: "null: text only" }),
        }),
      ),
    },
    404: { description: "No order with this number and phone (ORDER_NOT_FOUND)" },
    422: { description: "Not delivered yet, reviews off, or too many attempts (REVIEW_ORDER_NOT_DELIVERED / REVIEWS_DISABLED / REVIEW_RATE_LIMITED)" },
  },
  handler: h.checkEligibility,
});

const uploadRoute = defineRoute({
  method: "put",
  path: "/uploads",
  auth: "store",
  tags: ["Store API"],
  summary: "Send a review photo or voice note",
  description: `The file itself as the request body, with the grant from \`/store/reviews/eligibility\` in the **X-Review-Grant** header (and, for a voice note, its length as the recorder reported it in **X-Media-Duration-Ms** — shown only when the file does not say). Send each file as soon as it is picked; submit the review with the returned \`uploadId\`s.

Its kind is read from the file's bytes: a photo (JPEG, PNG, WebP, GIF — shrink it in the browser first, 8 MB at most) or a voice note (WebM, Ogg, M4A, MP3 — as long as the store allows).`,
  operationId: "uploadStoreReviewMedia",
  bodyContent: {
    "application/octet-stream": { schema: z.any().openapi({ type: "string", format: "binary" }) },
  },
  responses: {
    201: {
      description: "Received; kept until the review is submitted (a day at most)",
      content: envelope(z.object({ uploadId: z.string(), kind: z.enum(REVIEW_MEDIA_KINDS), bytes: z.number().int() })),
    },
    400: { description: "No file, an empty one, too large, or not a photo or voice note (REQUIRED_FIELD_MISSING / FILE_TOO_LARGE / INVALID_FILE_TYPE)" },
    422: { description: "Grant missing or expired, or a kind or number of files the store does not take (REVIEW_UPLOAD_GRANT_INVALID / REVIEW_MEDIA_LIMIT)" },
  },
  handler: h.uploadMedia,
});

const submitRoute = defineRoute({
  method: "post",
  path: "/",
  auth: "store",
  tags: ["Store API"],
  summary: "Submit a review",
  description: `Proves the purchase again, records the review and answers at once. Its photos and voice note are prepared afterwards (resized, location data removed); \`visibility\` says whether it is public now or after the store checks it — the store's choice.

One review per product of an order (**409 ORDER_ALREADY_REVIEWED**). Without \`phone\` (storefronts on \`@wocart/storefront\` 1.5) a review is text only, still for a delivered order — deprecated.`,
  operationId: "submitStoreReview",
  body: reviewSubmissionSchema,
  responses: {
    201: {
      description: "Review received",
      content: envelope(z.object({ id: z.string(), visibility: z.enum(["published", "after_review"]) })),
    },
    404: { description: "No order with this number and phone (ORDER_NOT_FOUND)" },
    409: { description: "This product was already reviewed from this order (ORDER_ALREADY_REVIEWED)" },
    422: { description: "Not delivered yet, not a product of the order, reviews off, too many attempts, or a file problem (REVIEW_* / PRODUCT_NOT_IN_ORDER)" },
  },
  handler: h.submit,
});

const router = new OpenAPIHono<AppContext>();
router.openapi(listRoute.route, listRoute.handler);
router.openapi(eligibilityRoute.route, eligibilityRoute.handler);
router.openapi(uploadRoute.route, uploadRoute.handler);
router.openapi(submitRoute.route, submitRoute.handler);

export default router;
