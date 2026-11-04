import { tool } from "ai";
import { z } from "zod";
import { getDb } from "@/db";
import { toolOutput, timestampSchema } from "@/lib/tool-output-schema";
import { CreateCouponSchema, UpdateCouponSchema } from "@/openapi/schemas/coupons";
import * as queries from "../../../../cod-shared/queries/coupons";
import { couponWriteError } from "./handlers";
import { toolId } from "@/lib/tool-input";

/**
 * Layer-2 validation schemas, exported so the MCP layer (src/mcp/schemas.ts)
 * advertises exactly what execute() validates.
 */
export const listCouponsSchema = z.object({});
export const getCouponDetailsSchema = z.object({
  couponId: toolId().describe("The ID of the coupon"),
});
export const createCouponToolSchema = CreateCouponSchema;
export const updateCouponToolSchema = z.object({
  couponId: toolId().describe("The ID of the coupon to update"),
  updates: UpdateCouponSchema,
});
export const deleteCouponSchema = z.object({
  couponId: toolId().describe("The ID of the coupon to delete"),
});

export const COUPON_TOOL_SCHEMAS: Record<string, z.ZodRawShape> = {
  listCoupons: listCouponsSchema.shape,
  getCouponDetails: getCouponDetailsSchema.shape,
  createCoupon: createCouponToolSchema.shape,
  updateCoupon: updateCouponToolSchema.shape,
  deleteCoupon: deleteCouponSchema.shape,
};

const couponRowSchema = z.looseObject({
  id: z.string().describe("Coupon ID"),
  code: z.string(),
  kind: z.string().describe("percentage | fixed_amount | free_shipping"),
  state: z.string().describe("live | inactive | scheduled | expired | used_up"),
  uses: z.number().int().describe("Orders that used it and are not cancelled"),
});

export const COUPON_TOOL_OUTPUT_SCHEMAS: Record<string, z.ZodType> = {
  listCoupons: toolOutput({
    count: z.number().int(),
    coupons: z.array(
      couponRowSchema.extend({
        discountGiven: z.number().int().describe("Dinars taken off by orders not cancelled"),
        createdAt: timestampSchema,
      }),
    ).describe("Coupons, newest first"),
  }),
  getCouponDetails: toolOutput({ coupon: couponRowSchema.describe("The coupon with the products, collections, customers and groups it names") }),
  createCoupon: toolOutput({ coupon: couponRowSchema.describe("The created coupon"), message: z.string() }),
  updateCoupon: toolOutput({ coupon: couponRowSchema.describe("The updated coupon"), message: z.string() }),
  deleteCoupon: toolOutput({ message: z.string() }),
};

const invalid = (error: z.ZodError, expected: string) => ({
  success: false as const,
  error: `Invalid arguments: ${error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}. ${expected}`,
});

const failure = (what: string, error: unknown) => ({
  success: false as const,
  error: `${what}: ${error instanceof Error ? error.message : String(error)}`,
});

const SHAPE =
  "Fields: code (3-32 chars, Latin letters, digits, - and _; stored upper case), " +
  'kind ("percentage" with value 1-100 and optional maxDiscount | "fixed_amount" with value in DZD | "free_shipping" with no value), ' +
  "optional minSubtotal (DZD) OR minQuantity (items), measured on the lines the coupon covers; " +
  'scope ("store" | "products" with productIds | "collections" with collectionIds); ' +
  'audience ("everyone" | "selected" with customerIds and/or groupIds); ' +
  'usageLimit (orders, across customers), oncePerCustomer (boolean), startsAt / endsAt (ISO-8601), status ("active" | "inactive").';

/**
 * AI Tools for Coupon Management
 *
 * A coupon is a code the shopper enters at checkout. It applies after offers,
 * only to the paid lines in its scope that no offer applied to; its discount
 * is shared across those lines. A use is an order that used it and is not
 * cancelled; the usage limit and one use per customer are enforced by the
 * database when the order is placed.
 *
 * Two-Layer Validation Pattern:
 * - Layer 1 (LLM-level): Permissive input schema accepts any object to prevent SDK crashes
 * - Layer 2 (App-level): Strict validation inside execute() with graceful error handling
 */
export const getCouponTools = (db: ReturnType<typeof getDb>) => ({
  listCoupons: tool({
    description:
      "List every coupon, newest first: code, kind, value, where it stands (live, inactive, scheduled, expired, used_up), " +
      "its uses (orders not cancelled), the discount it gave, and how many products, collections, customers and groups it names.",
    inputSchema: z.object({}).passthrough(),
    execute: async () => {
      try {
        const coupons = await queries.listCoupons(db);
        return { success: true, count: coupons.length, coupons };
      } catch (error) {
        return failure("Database error", error);
      }
    },
  }),

  getCouponDetails: tool({
    description: "Fetch one coupon by ID, with the products, collections, customers and customer groups it names. Use it before updating a coupon.",
    inputSchema: z.object({}).passthrough(),
    execute: async (args) => {
      const parsed = getCouponDetailsSchema.safeParse(args);
      if (!parsed.success) return invalid(parsed.error, "Expected: couponId (ID string)");
      try {
        const coupon = await queries.getCouponById(db, parsed.data.couponId);
        return coupon ? { success: true, coupon } : { success: false, error: `Coupon not found with ID: ${parsed.data.couponId}` };
      } catch (error) {
        return failure("Database error", error);
      }
    },
  }),

  createCoupon: tool({
    description:
      "Creates a coupon a shopper enters at checkout. It applies after offers, only to the paid lines in its scope that no offer applied to. " +
      SHAPE,
    inputSchema: z.object({}).passthrough(),
    execute: async (args) => {
      const parsed = createCouponToolSchema.safeParse(args);
      if (!parsed.success) return invalid(parsed.error, SHAPE);
      try {
        const created = await queries.createCoupon(db, parsed.data);
        if (!created.ok) return { success: false, error: `${couponWriteError(created).message} (${created.reason})` };
        const coupon = await queries.getCouponById(db, created.id);
        return { success: true, coupon, message: `Coupon ${coupon?.code} created` };
      } catch (error) {
        return failure("Failed to create coupon", error);
      }
    },
  }),

  updateCoupon: tool({
    description:
      "Partially updates a coupon; only include what changes. The whole coupon must stay coherent. " +
      "Changing kind starts its value and cap afresh; changing scope or audience clears the old picks. Orders already placed keep their discount. " +
      SHAPE,
    inputSchema: z.object({}).passthrough(),
    execute: async (args) => {
      const parsed = updateCouponToolSchema.safeParse(args);
      if (!parsed.success) return invalid(parsed.error, `Expected: couponId (ID), updates object. ${SHAPE}`);
      try {
        const updated = await queries.updateCoupon(db, parsed.data.couponId, parsed.data.updates);
        if (!updated.ok && updated.reason === "not_found") return { success: false, error: `Coupon not found with ID: ${parsed.data.couponId}` };
        if (!updated.ok) return { success: false, error: `${couponWriteError(updated as queries.CouponWriteProblem).message} (${updated.reason})` };
        const coupon = await queries.getCouponById(db, parsed.data.couponId);
        return { success: true, coupon, message: "Coupon updated" };
      } catch (error) {
        return failure("Failed to update coupon", error);
      }
    },
  }),

  deleteCoupon: tool({
    description:
      "Permanently deletes a coupon. Orders that used it keep its code and the discount they were given. " +
      "Irreversible — set status to 'inactive' instead to stop it while keeping it.",
    inputSchema: z.object({}).passthrough(),
    execute: async (args) => {
      const parsed = deleteCouponSchema.safeParse(args);
      if (!parsed.success) return invalid(parsed.error, "Expected: couponId (ID string)");
      try {
        const existing = await queries.getCouponById(db, parsed.data.couponId);
        if (!existing) return { success: false, error: `Coupon not found with ID: ${parsed.data.couponId}` };
        await queries.deleteCoupon(db, parsed.data.couponId);
        return { success: true, message: `Coupon ${existing.code} deleted` };
      } catch (error) {
        return failure("Failed to delete coupon", error);
      }
    },
  }),
});
