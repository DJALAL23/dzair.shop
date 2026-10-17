/**
 * Coupons — codes a shopper enters at checkout, after offers have priced the
 * basket. Three kinds:
 *
 *   percentage      a share of what the eligible products cost, optionally
 *                   capped at a most-off amount.
 *   fixed_amount    an amount off the eligible products, once per order.
 *   free_shipping   the order's delivery fee becomes zero.
 *
 * A coupon covers only lines no offer applied to: one promotion per product.
 * `engine.ts` prices a coupon against a basket; who may use it and how often
 * is decided where the order is placed, in the same statement that records the
 * use.
 */

export const COUPON_KINDS = ["percentage", "fixed_amount", "free_shipping"] as const;
export type CouponKind = (typeof COUPON_KINDS)[number];

/** What a coupon covers: the whole store, picked products, or the products of picked collections. */
export const COUPON_SCOPES = ["store", "products", "collections"] as const;
export type CouponScope = (typeof COUPON_SCOPES)[number];

/** Who may use a coupon: everyone, or the picked customers and the members of the picked groups. */
export const COUPON_AUDIENCES = ["everyone", "selected"] as const;
export type CouponAudience = (typeof COUPON_AUDIENCES)[number];

/** At most this many of each pick on one coupon; a larger audience is a customer group. */
export const COUPON_PICK_LIMITS = { productIds: 500, collectionIds: 100, customerIds: 1000, groupIds: 50 } as const;

export const COUPON_CODE_PATTERN = /^[A-Z0-9_-]{3,32}$/;

const ARABIC_INDIC_ZERO = 0x0660;
const EXTENDED_ARABIC_INDIC_ZERO = 0x06f0;

/**
 * A code as typed, in the one form codes are stored and compared in: spaces
 * dropped, Latin letters upper-cased, Arabic-Indic digits read as 0–9 — so a
 * shopper on an Arabic keyboard types the same code. Null when what remains is
 * not a code.
 */
export function normalizeCouponCode(raw: string): string | null {
  const code = raw
    .replace(/\s+/g, "")
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - ARABIC_INDIC_ZERO))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - EXTENDED_ARABIC_INDIC_ZERO))
    .toUpperCase();
  return COUPON_CODE_PATTERN.test(code) ? code : null;
}

/** A coupon as written, whole: what `couponProblem` judges after every create or edit. */
export interface CouponShape {
  code: string;
  kind: CouponKind;
  /** Percent for `percentage` (1–100), dinars for `fixed_amount` (≥ 1), 0 for `free_shipping`. */
  value: number;
  /** The most a `percentage` coupon takes off; null for no cap and for the other kinds. */
  maxDiscount: number | null;
  /** What the eligible products must cost together, offers applied, for the coupon to apply; null for none. */
  minSubtotal: number | null;
  /** How many items the eligible products must count together; null for none. Never beside a `minSubtotal`. */
  minQuantity: number | null;
  scope: CouponScope;
  productIds: readonly string[];
  collectionIds: readonly string[];
  audience: CouponAudience;
  customerIds: readonly string[];
  groupIds: readonly string[];
  /** Uses across all customers; null for no limit. */
  usageLimit: number | null;
  oncePerCustomer: boolean;
  startsAt: string | null;
  endsAt: string | null;
}

export type CouponProblem =
  | "invalid_code"
  | "invalid_value"
  | "max_discount_not_allowed"
  | "invalid_amount"
  | "minimum_conflict"
  | "scope_empty"
  | "scope_mismatch"
  | "audience_empty"
  | "audience_mismatch"
  | "too_many_picks"
  | "invalid_usage_limit"
  | "schedule_ends_before_start";

const wholeAtLeast = (value: number, min: number) => Number.isInteger(value) && value >= min;

function valueFits(coupon: Pick<CouponShape, "kind" | "value">): boolean {
  if (coupon.kind === "percentage") return wholeAtLeast(coupon.value, 1) && coupon.value <= 100;
  if (coupon.kind === "fixed_amount") return wholeAtLeast(coupon.value, 1);
  return coupon.value === 0;
}

/**
 * What makes a coupon incoherent, or null. A percentage is 1–100, an amount
 * at least one dinar, free delivery carries no value; only a percentage has a
 * cap; a minimum is an amount or a number of items, not both. A scope or audience that picks names at least one, and only what it
 * picks. A schedule ends after it starts.
 */
export function couponProblem(coupon: CouponShape): CouponProblem | null {
  if (!COUPON_CODE_PATTERN.test(coupon.code)) return "invalid_code";
  if (!valueFits(coupon)) return "invalid_value";
  if (coupon.maxDiscount !== null && coupon.kind !== "percentage") return "max_discount_not_allowed";
  for (const amount of [coupon.maxDiscount, coupon.minSubtotal, coupon.minQuantity]) if (amount !== null && !wholeAtLeast(amount, 1)) return "invalid_amount";
  if (coupon.minSubtotal !== null && coupon.minQuantity !== null) return "minimum_conflict";

  const picks = { products: coupon.productIds.length, collections: coupon.collectionIds.length };
  if ((["products", "collections"] as const).some((scope) => scope !== coupon.scope && picks[scope] > 0)) return "scope_mismatch";
  if (coupon.scope !== "store" && picks[coupon.scope] === 0) return "scope_empty";

  const selected = coupon.customerIds.length + coupon.groupIds.length;
  if (coupon.audience === "everyone" && selected > 0) return "audience_mismatch";
  if (coupon.audience === "selected" && selected === 0) return "audience_empty";

  if ((Object.keys(COUPON_PICK_LIMITS) as Array<keyof typeof COUPON_PICK_LIMITS>).some((pick) => coupon[pick].length > COUPON_PICK_LIMITS[pick])) {
    return "too_many_picks";
  }

  if (coupon.usageLimit !== null && !wholeAtLeast(coupon.usageLimit, 1)) return "invalid_usage_limit";
  if (coupon.startsAt && coupon.endsAt && coupon.endsAt <= coupon.startsAt) return "schedule_ends_before_start";
  return null;
}

/**
 * Where a coupon stands at `now`, as the merchant reads it: switched off,
 * not started, ended, every use taken, or live. `uses` counts the orders that
 * used it and are not cancelled.
 */
export type CouponState = "inactive" | "scheduled" | "expired" | "used_up" | "live";

export function couponState(
  coupon: Pick<CouponShape, "startsAt" | "endsAt" | "usageLimit"> & { status: "active" | "inactive" },
  uses: number,
  now: string,
): CouponState {
  if (coupon.status === "inactive") return "inactive";
  if (coupon.startsAt && now < coupon.startsAt) return "scheduled";
  if (coupon.endsAt && now >= coupon.endsAt) return "expired";
  if (coupon.usageLimit !== null && uses >= coupon.usageLimit) return "used_up";
  return "live";
}
