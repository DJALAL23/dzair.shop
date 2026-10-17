/**
 * A coupon as checkout reads it: found by the code the shopper typed, live,
 * with uses left, open to this shopper, and its scope resolved to the products
 * it covers right now. What it then does to the basket is the pricing path's
 * (`priceCartLines`); the database has the last word on uses when the order is
 * inserted (migration 0052).
 */
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { collectionProducts, couponCollections, couponCustomerGroups, couponCustomers, couponProducts, coupons, customerGroupMembers, customers, orders } from "../db/schema";
import type { AppDb } from "../db/client";
import type { EngineCoupon } from "../coupons/engine";
import { couponState, normalizeCouponCode } from "../coupons/model";
import { toLocalAlgerianMobile } from "../lib/phone";

export interface CheckoutCoupon extends EngineCoupon {
  id: string;
  code: string;
}

/**
 * Why a code does not apply, as the shopper is told:
 *
 *   not_found               no such code, or the merchant switched it off
 *   not_started / expired   outside its schedule
 *   used_up                 every use taken
 *   identify_first          it is for selected customers: the phone decides
 *   not_eligible            this phone is not one of them
 *   already_used            one use per customer, and this one is taken
 *   no_eligible_products    nothing in the basket it covers (offers' lines excluded)
 *   below_minimum_*         `shortBy` dinars or items still missing
 *   delivery_already_free   a free-delivery coupon with nothing to give
 */
export const COUPON_REFUSAL_REASONS = [
  "not_found",
  "not_started",
  "expired",
  "used_up",
  "identify_first",
  "not_eligible",
  "already_used",
  "no_eligible_products",
  "below_minimum_subtotal",
  "below_minimum_quantity",
  "delivery_already_free",
] as const;

type Shortfall = "below_minimum_subtotal" | "below_minimum_quantity";

export type CouponRefusal =
  | { reason: Exclude<(typeof COUPON_REFUSAL_REASONS)[number], "not_started" | Shortfall> }
  | { reason: "not_started"; startsAt: string }
  | { reason: Shortfall; shortBy: number };

export type CouponLookup = { ok: true; coupon: CheckoutCoupon } | { ok: false; refusal: CouponRefusal };

const refuse = (refusal: CouponRefusal): CouponLookup => ({ ok: false, refusal });

/** Orders that used the coupon and are not cancelled, for everyone or for one customer. */
async function usesOf(db: AppDb, couponId: string, customerId?: string): Promise<number> {
  const row = await db
    .select({ n: sql<number>`count(*)` })
    .from(orders)
    .where(and(eq(orders.couponId, couponId), ne(orders.status, "cancelled"), ...(customerId ? [eq(orders.customerId, customerId)] : [])))
    .get();
  return Number(row?.n ?? 0);
}

async function admits(db: AppDb, couponId: string, customerId: string): Promise<boolean> {
  const [picked, member] = await Promise.all([
    db.select({ id: couponCustomers.customerId }).from(couponCustomers).where(and(eq(couponCustomers.couponId, couponId), eq(couponCustomers.customerId, customerId))).get(),
    db
      .select({ id: customerGroupMembers.groupId })
      .from(customerGroupMembers)
      .innerJoin(couponCustomerGroups, eq(couponCustomerGroups.groupId, customerGroupMembers.groupId))
      .where(and(eq(couponCustomerGroups.couponId, couponId), eq(customerGroupMembers.customerId, customerId)))
      .get(),
  ]);
  return picked !== undefined || member !== undefined;
}

async function coveredProducts(db: AppDb, coupon: typeof coupons.$inferSelect): Promise<ReadonlySet<string> | null> {
  if (coupon.scope === "store") return null;
  const rows =
    coupon.scope === "products"
      ? await db.select({ id: couponProducts.productId }).from(couponProducts).where(eq(couponProducts.couponId, coupon.id)).all()
      : await db
          .select({ id: collectionProducts.productId })
          .from(collectionProducts)
          .where(inArray(collectionProducts.collectionId, db.select({ id: couponCollections.collectionId }).from(couponCollections).where(eq(couponCollections.couponId, coupon.id))))
          .all();
  return new Set(rows.map((row) => row.id));
}

/**
 * The coupon a code names, if this shopper may use it now. `phone` is the
 * order's, as typed; null before the shopper has given one — a coupon for
 * selected customers then waits for it, and one use per customer is checked
 * once it is known (and again by the database when the order is placed).
 */
export async function findCheckoutCoupon(db: AppDb, input: { code: string; phone: string | null; now: string }): Promise<CouponLookup> {
  const code = normalizeCouponCode(input.code);
  const row = code ? await db.select().from(coupons).where(eq(coupons.code, code)).get() : undefined;
  if (!row) return refuse({ reason: "not_found" });

  const state = couponState(row, await usesOf(db, row.id), input.now);
  if (state === "inactive") return refuse({ reason: "not_found" });
  if (state === "scheduled") return refuse({ reason: "not_started", startsAt: row.startsAt! });
  if (state !== "live") return refuse({ reason: state });

  const phone = input.phone === null ? null : toLocalAlgerianMobile(input.phone);
  if (row.audience === "selected" && phone === null) return refuse({ reason: "identify_first" });
  const customer = phone ? await db.select({ id: customers.id }).from(customers).where(eq(customers.phone, phone)).get() : undefined;
  if (row.audience === "selected" && !(customer && (await admits(db, row.id, customer.id)))) return refuse({ reason: "not_eligible" });
  if (row.oncePerCustomer && customer && (await usesOf(db, row.id, customer.id)) > 0) return refuse({ reason: "already_used" });

  return {
    ok: true,
    coupon: {
      id: row.id,
      code: row.code,
      kind: row.kind,
      value: row.value,
      maxDiscount: row.maxDiscount,
      minSubtotal: row.minSubtotal,
      minQuantity: row.minQuantity,
      productIds: await coveredProducts(db, row),
    },
  };
}

/** An order carried a code that does not apply to it: the order is refused whole, never placed without it. */
export class CouponNotApplicableError extends Error {
  constructor(readonly refusal: CouponRefusal) {
    super(`The coupon does not apply: ${refusal.reason}`);
    this.name = "CouponNotApplicableError";
  }
}

const RAISED: ReadonlyArray<[RegExp, CouponRefusal]> = [
  [/COUPON_USED_UP/, { reason: "used_up" }],
  [/COUPON_ALREADY_USED/, { reason: "already_used" }],
];

/**
 * The refusal a database trigger raised when the order was inserted (migration
 * 0052) — the use taken by another order since the code was checked — or null
 * for any other failure.
 */
export function raisedCouponRefusal(error: unknown): CouponRefusal | null {
  for (let cause: unknown = error; cause instanceof Error; cause = cause.cause) {
    for (const [pattern, refusal] of RAISED) if (pattern.test(cause.message)) return refusal;
  }
  return null;
}
