/**
 * Coupon schemas: codes a shopper enters at checkout (`/api/coupons`).
 *
 * The request schemas check shapes only. Whether the whole coupon is coherent
 * — a percentage within 1–100, a scope that names what it picks — is judged
 * on the coupon a write leaves (`couponProblem` in cod-shared), so an edit is
 * judged with the fields it does not touch.
 */

import { z } from "@hono/zod-openapi";
import { COUPON_AUDIENCES, COUPON_KINDS, COUPON_PICK_LIMITS, COUPON_SCOPES } from "../../../../cod-shared/coupons/model";

const ids = (max: number, description: string) => z.array(z.string().min(1)).max(max).openapi({ description: `${description} At most ${max}.` });
const dinars = z.number().int().min(1);

export const CreateCouponSchema = z.object({
  code: z.string().min(1).max(64).openapi({
    description: "What the shopper types. Stored upper case without spaces; Latin letters, digits, - and _, 3 to 32 long; Arabic-Indic digits are read as 0–9.",
    example: "RAMADAN10",
  }),
  kind: z.enum(COUPON_KINDS),
  value: z.number().int().min(0).optional().openapi({ description: "Percent (1–100) for `percentage`, dinars for `fixed_amount`; none for `free_shipping`." }),
  maxDiscount: dinars.nullish().openapi({ description: "The most a `percentage` coupon takes off one order." }),
  minSubtotal: dinars.nullish().openapi({ description: "What the eligible products must cost together. Never beside `minQuantity`." }),
  minQuantity: z.number().int().min(1).nullish().openapi({ description: "How many eligible items the order must hold. Never beside `minSubtotal`." }),
  scope: z.enum(COUPON_SCOPES).default("store"),
  productIds: ids(COUPON_PICK_LIMITS.productIds, "The products a `products` coupon covers.").optional(),
  collectionIds: ids(COUPON_PICK_LIMITS.collectionIds, "The collections a `collections` coupon covers.").optional(),
  audience: z.enum(COUPON_AUDIENCES).default("everyone"),
  customerIds: ids(COUPON_PICK_LIMITS.customerIds, "Customers a `selected` coupon admits.").optional(),
  groupIds: ids(COUPON_PICK_LIMITS.groupIds, "Customer groups whose members a `selected` coupon admits.").optional(),
  usageLimit: z.number().int().min(1).nullish().openapi({ description: "Orders that may use it, across all customers; cancelled orders do not count." }),
  oncePerCustomer: z.boolean().optional(),
  startsAt: z.string().datetime({ offset: true }).nullish(),
  endsAt: z.string().datetime({ offset: true }).nullish(),
  status: z.enum(["active", "inactive"]).default("active"),
});

/** Any field; a field left out keeps its value, null clears one that may be empty. */
export const UpdateCouponSchema = CreateCouponSchema.partial().extend({
  scope: z.enum(COUPON_SCOPES).optional(),
  audience: z.enum(COUPON_AUDIENCES).optional(),
  status: z.enum(["active", "inactive"]).optional(),
});

export type CreateCouponInput = z.infer<typeof CreateCouponSchema>;
export type UpdateCouponInput = z.infer<typeof UpdateCouponSchema>;

const couponFields = {
  id: z.string(),
  code: z.string().openapi({ example: "RAMADAN10" }),
  kind: z.enum(COUPON_KINDS),
  value: z.number().int(),
  maxDiscount: z.number().int().nullable(),
  minSubtotal: z.number().int().nullable(),
  minQuantity: z.number().int().nullable(),
  scope: z.enum(COUPON_SCOPES),
  audience: z.enum(COUPON_AUDIENCES),
  usageLimit: z.number().int().nullable(),
  oncePerCustomer: z.boolean(),
  startsAt: z.string().nullable(),
  endsAt: z.string().nullable(),
  status: z.enum(["active", "inactive"]),
  state: z.enum(["inactive", "scheduled", "expired", "used_up", "live"]).openapi({ description: "Where the coupon stands now." }),
  uses: z.number().int().openapi({ description: "Orders that used it and are not cancelled." }),
  discountGiven: z.number().int().openapi({ description: "What those orders were given off, in dinars." }),
  createdAt: z.string(),
  updatedAt: z.string(),
};

export const CouponSummarySchema = z
  .object({
    ...couponFields,
    counts: z.object({ products: z.number().int(), collections: z.number().int(), customers: z.number().int(), groups: z.number().int() }),
  })
  .openapi("CouponSummary");

export const CouponSchema = z
  .object({
    ...couponFields,
    products: z.array(z.object({ id: z.string(), name: z.string(), handle: z.string() })),
    collections: z.array(z.object({ id: z.string(), title: z.string(), handle: z.string() })),
    customers: z.array(z.object({ id: z.string(), name: z.string(), phone: z.string() })),
    groups: z.array(z.object({ id: z.string(), name: z.string() })),
  })
  .openapi("Coupon");
