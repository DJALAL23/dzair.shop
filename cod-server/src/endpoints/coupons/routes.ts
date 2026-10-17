/**
 * Coupons Routes
 *
 * The dashboard's coupons: codes a shopper enters at checkout, applied after
 * offers to the lines no offer applied to (ADR 0007).
 * Built with defineRoute() — the standard route-builder pattern.
 */

import { OpenAPIHono, z } from "@hono/zod-openapi";
import type { AppContext } from "@/types";
import { defineRoute } from "@/lib/route-builder";
import { SCOPES } from "../../../../cod-shared/rbac/scopes";
import { ListResponseSchema, SuccessResponseSchema } from "@/openapi/schemas";
import { CouponSchema, CouponSummarySchema, CreateCouponSchema, UpdateCouponSchema } from "@/openapi/schemas/coupons";
import * as h from "./handlers";

const jsonContent = <T extends z.ZodType>(schema: T) => ({
  "application/json": { schema },
});

const idParams = z.object({
  id: z.string().openapi({ description: "Coupon UUID" }),
});

const listCouponsRoute = defineRoute({
  method: "get",
  path: "/",
  auth: { scope: SCOPES.COUPONS_READ },
  tags: ["Coupons"],
  summary: "List coupons",
  description: "Every coupon, newest first, with where it stands, its uses and the discount it gave.",
  operationId: "listCoupons",
  responses: {
    200: { description: "List of coupons", content: jsonContent(ListResponseSchema(CouponSummarySchema)) },
  },
  handler: h.listCoupons,
});

const getCouponRoute = defineRoute({
  method: "get",
  path: "/{id}",
  auth: { scope: SCOPES.COUPONS_READ },
  tags: ["Coupons"],
  summary: "Get coupon",
  description: "A coupon with the products, collections, customers and groups it names.",
  operationId: "getCoupon",
  params: idParams,
  responses: {
    200: { description: "Coupon details", content: jsonContent(SuccessResponseSchema(CouponSchema)) },
  },
  handler: h.getCoupon,
});

const createCouponRoute = defineRoute({
  method: "post",
  path: "/",
  auth: { scope: SCOPES.COUPONS_MANAGE },
  tags: ["Coupons"],
  summary: "Create coupon",
  description: `Create a coupon.

**How it applies (at checkout, not here):** after offers, to the paid lines in its scope that no offer applied to.
Its discount is shared across those lines, so the order's price stays the sum of its lines.
A use is an order with the coupon that is not cancelled; the usage limit and one use per customer are enforced by the database when the order is placed.

Refused with \`INVALID_COUPON\` (\`reason\` says why) or \`COUPON_CODE_TAKEN\`.`,
  operationId: "createCoupon",
  body: CreateCouponSchema,
  responses: {
    201: { description: "Coupon created", content: jsonContent(SuccessResponseSchema(CouponSchema)) },
  },
  handler: h.createCoupon,
});

const updateCouponRoute = defineRoute({
  method: "patch",
  path: "/{id}",
  auth: { scope: SCOPES.COUPONS_MANAGE },
  tags: ["Coupons"],
  summary: "Update coupon",
  description:
    "Partially update a coupon; the coupon it leaves is judged whole. A change of kind starts its value afresh, a change of scope or audience its picks. Orders already placed keep what they were given.",
  operationId: "updateCoupon",
  params: idParams,
  body: UpdateCouponSchema,
  responses: {
    200: { description: "Updated coupon", content: jsonContent(SuccessResponseSchema(CouponSchema)) },
  },
  handler: h.updateCoupon,
});

const deleteCouponRoute = defineRoute({
  method: "delete",
  path: "/{id}",
  auth: { scope: SCOPES.COUPONS_MANAGE },
  tags: ["Coupons"],
  summary: "Delete coupon",
  description: "Permanently delete a coupon. Orders that used it keep its code and the discount they were given.",
  operationId: "deleteCoupon",
  params: idParams,
  responses: {
    200: { description: "Coupon deleted", content: jsonContent(z.object({ success: z.boolean().openapi({ example: true }) })) },
  },
  handler: h.deleteCoupon,
});

const router = new OpenAPIHono<AppContext>();

router.openapi(listCouponsRoute.route, listCouponsRoute.handler);
router.openapi(getCouponRoute.route, getCouponRoute.handler);
router.openapi(createCouponRoute.route, createCouponRoute.handler);
router.openapi(updateCouponRoute.route, updateCouponRoute.handler);
router.openapi(deleteCouponRoute.route, deleteCouponRoute.handler);

export default router;
