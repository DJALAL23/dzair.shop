/**
 * What a coupon takes off a basket that offers have already priced.
 *
 * Pure: no database, no clock. Whether the coupon is live, whether this
 * customer may use it and whether uses are left are decided where the order is
 * placed; this decides what it does to these lines. The order engine and the
 * cart quote both call it, so what the shopper is shown is what the order
 * charges.
 *
 * The rules, and why each one is what it is:
 *
 *  1. Eligible lines are the paid lines in the coupon's scope that no offer
 *     applied to — one promotion per product, so a coupon never deepens an
 *     offer the merchant already priced. Rewards are never paid lines.
 *  2. The minimum — an amount or a number of items, never both — is measured
 *     on the eligible lines alone: a coupon for one collection asks that much
 *     of that collection.
 *  3. A percentage is taken of the eligible subtotal, rounded to the dinar,
 *     then capped; a fixed amount is taken once per order. Neither takes more
 *     than the eligible lines cost.
 *  4. The discount is shared across the eligible lines by what each costs, so
 *     every line keeps reading quantity × unit = total and the lines add up to
 *     the order's price — the amount a carrier collects.
 *  5. Free delivery is the whole order's: the coupon needs an eligible line,
 *     and then the delivery fee is zero whatever else the basket holds.
 */
import { allocate } from "../pricing/allocate";
import type { CouponKind } from "./model";

/** A coupon as the engine reads it: its scope already resolved to products. */
export interface EngineCoupon {
  kind: CouponKind;
  value: number;
  maxDiscount: number | null;
  minSubtotal: number | null;
  minQuantity: number | null;
  /** The products the coupon covers; null for the whole store. */
  productIds: ReadonlySet<string> | null;
}

/** A paid line as offers left it. */
export interface CouponLine {
  productId: string;
  quantity: number;
  lineTotal: number;
  /** The offer applied to this line, or null. */
  offerId: string | null;
}

export type CouponPricing =
  | {
      applied: true;
      /** What comes off each input line, in order; zero for a line the coupon does not cover. */
      discounts: number[];
      /** Their sum. */
      discount: number;
      freeShipping: boolean;
    }
  /** `offer_applied`: every line it would cover already has an offer; `no_eligible_products`: nothing it covers is in the basket. */
  | { applied: false; reason: "no_eligible_products" | "offer_applied" }
  /** `shortBy`: the dinars, or the items, the eligible lines still lack. */
  | { applied: false; reason: "below_minimum_subtotal" | "below_minimum_quantity"; shortBy: number };

export function priceCoupon(lines: readonly CouponLine[], coupon: EngineCoupon): CouponPricing {
  const inScope = lines.map((line) => coupon.productIds === null || coupon.productIds.has(line.productId));
  const eligible = lines.map((line, index) => inScope[index]! && line.offerId === null);
  if (!eligible.includes(true)) return { applied: false, reason: inScope.includes(true) ? "offer_applied" : "no_eligible_products" };

  const weights = lines.map((line, index) => (eligible[index] ? line.lineTotal : 0));
  const subtotal = weights.reduce((sum, weight) => sum + weight, 0);
  if (coupon.minSubtotal !== null && subtotal < coupon.minSubtotal) {
    return { applied: false, reason: "below_minimum_subtotal", shortBy: coupon.minSubtotal - subtotal };
  }
  const units = lines.reduce((sum, line, index) => sum + (eligible[index] ? line.quantity : 0), 0);
  if (coupon.minQuantity !== null && units < coupon.minQuantity) {
    return { applied: false, reason: "below_minimum_quantity", shortBy: coupon.minQuantity - units };
  }

  const discount =
    coupon.kind === "percentage"
      ? Math.min(Math.round((subtotal * coupon.value) / 100), coupon.maxDiscount ?? Infinity)
      : coupon.kind === "fixed_amount"
        ? Math.min(coupon.value, subtotal)
        : 0;
  return { applied: true, discounts: allocate(discount, weights), discount, freeShipping: coupon.kind === "free_shipping" };
}
