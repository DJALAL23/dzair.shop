import { Context } from "hono";
import type { AppContext } from "@/types";
import { getDb } from "@/db";
import { ConflictError, NotFoundError, SystemError, ValidationError } from "@/lib/errors/classes";
import { ERROR_CODES } from "../../../../cod-shared/errors/codes";
import * as queries from "../../../../cod-shared/queries/coupons";
import type { CreateCouponInput, UpdateCouponInput } from "@/openapi/schemas/coupons";

const body = <T>(c: Context<AppContext>) => (c.req as unknown as { valid: (target: "json") => T }).valid("json");

/** A write the rules refused, as the error the merchant reads. */
export function couponWriteError(problem: queries.CouponWriteProblem) {
  return problem.reason === "code_taken"
    ? new ConflictError("Another coupon already has this code", ERROR_CODES.COUPON_CODE_TAKEN, { couponId: problem.couponId })
    : new ValidationError("The coupon is not coherent", ERROR_CODES.INVALID_COUPON, { reason: problem.reason });
}

export async function listCoupons(c: Context<AppContext>) {
  const data = await queries.listCoupons(getDb(c.env.DB));
  return c.json({ success: true, data, count: data.length }, 200);
}

export async function getCoupon(c: Context<AppContext>) {
  const id = c.req.param("id")!;
  const data = await queries.getCouponById(getDb(c.env.DB), id);
  if (!data) throw new NotFoundError("Coupon", id);
  return c.json({ success: true, data }, 200);
}

export async function createCoupon(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const result = await queries.createCoupon(db, body<CreateCouponInput>(c));
  if (!result.ok) throw couponWriteError(result);
  const data = await queries.getCouponById(db, result.id);
  if (!data) throw new SystemError("Failed to load created coupon");
  return c.json({ success: true, data }, 201);
}

export async function updateCoupon(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const id = c.req.param("id")!;
  const result = await queries.updateCoupon(db, id, body<UpdateCouponInput>(c));
  if (!result.ok && result.reason === "not_found") throw new NotFoundError("Coupon", id);
  if (!result.ok) throw couponWriteError(result as queries.CouponWriteProblem);
  const data = await queries.getCouponById(db, id);
  if (!data) throw new SystemError("Failed to load updated coupon");
  return c.json({ success: true, data }, 200);
}

export async function deleteCoupon(c: Context<AppContext>) {
  const id = c.req.param("id")!;
  if (!(await queries.deleteCoupon(getDb(c.env.DB), id))) throw new NotFoundError("Coupon", id);
  return c.json({ success: true }, 200);
}
