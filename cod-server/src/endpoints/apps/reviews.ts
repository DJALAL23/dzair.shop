/**
 * The Reviews App: the store's rules for its customers' reviews — whether it
 * takes them, what a shopper may send with one, and what goes live without
 * the merchant checking it (a Storefront Add-on: the storefront reads them as
 * the review policy). The reviews themselves are moderated under `/api/reviews`.
 */

import { OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { AppContext } from "@/types";
import { defineRoute } from "@/lib/route-builder";
import { SCOPES } from "../../../../cod-shared/rbac/scopes";
import { REVIEW_AUTO_PUBLISH, REVIEW_MAX_PHOTOS, REVIEW_VOICE_LENGTHS } from "../../../../cod-shared/reviews/model";
import { getReviewPolicy, saveReviewPolicy } from "../../../../cod-shared/queries/store-reviews";
import { bodyOf, jsonContent, storeOf } from "./shared";

const voiceLength = z.union([z.literal(30), z.literal(60), z.literal(90), z.literal(120)]);

const ReviewRulesSchema = z
  .object({
    enabled: z.boolean().openapi({ description: "When false, reviews are hidden on the storefront and shoppers cannot send one", example: true }),
    maxPhotos: z.number().int().min(0).max(REVIEW_MAX_PHOTOS).openapi({ description: `Photos a shopper may add to a review, 0 (none) to ${REVIEW_MAX_PHOTOS}`, example: 3 }),
    voiceMaxSeconds: voiceLength.nullable().openapi({
      description: `Longest voice note a shopper may add, in seconds (${REVIEW_VOICE_LENGTHS.join(", ")}); null = no voice notes`,
      example: 60,
    }),
    autoPublish: z.enum(REVIEW_AUTO_PUBLISH).openapi({
      description: "Which shopper reviews publish without checking: none (off), text-only ones (text_only: anything with a photo or voice note waits), or all",
      example: "text_only",
    }),
  })
  .openapi("ReviewRules");

const reviewRulesInputSchema = ReviewRulesSchema.partial();

const RulesResponseSchema = z.object({ success: z.boolean(), data: ReviewRulesSchema });

async function getReviews(c: Context<AppContext>) {
  const { db, store } = await storeOf(c);
  return c.json({ success: true, data: await getReviewPolicy(db, store.id) }, 200);
}

async function saveReviews(c: Context<AppContext>) {
  const { db, store } = await storeOf(c);
  const rules = bodyOf<typeof reviewRulesInputSchema>(c);
  return c.json({ success: true, data: await saveReviewPolicy(db, store.id, rules) }, 200);
}

const getRoute = defineRoute({
  method: "get",
  path: "/reviews",
  auth: { scope: SCOPES.REVIEWS_READ },
  tags: ["Apps"],
  summary: "Get the Reviews App",
  description: "The store's rules for its customers' reviews: whether it takes them, what a shopper may send, and what publishes without checking.",
  operationId: "getReviewsApp",
  responses: { 200: { description: "The review rules", content: jsonContent(RulesResponseSchema) } },
  handler: getReviews,
});

const saveRoute = defineRoute({
  method: "put",
  path: "/reviews",
  auth: { scope: SCOPES.REVIEWS_MANAGE },
  tags: ["Apps"],
  summary: "Set the Reviews App's rules",
  description: "Changes the rules given and keeps the others. Reviews already received keep the status they have.",
  operationId: "saveReviewsApp",
  body: reviewRulesInputSchema,
  responses: {
    200: { description: "The review rules now in force", content: jsonContent(RulesResponseSchema) },
    400: { description: "A rule outside its choices (VALIDATION_FAILED)" },
  },
  handler: saveReviews,
});

const router = new OpenAPIHono<AppContext>();
router.openapi(getRoute.route, getRoute.handler);
router.openapi(saveRoute.route, saveRoute.handler);

export default router;
