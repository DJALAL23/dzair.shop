import type { CouponAudience, CouponKind, CouponScope, CouponState } from "../../../../cod-shared/coupons/model";
import type { PickerOption } from "@/components/ui";

export type { CouponAudience, CouponKind, CouponScope, CouponState };
export type CouponStatus = "active" | "inactive";

interface CouponFields {
  id: string;
  code: string;
  kind: CouponKind;
  /** Percent for `percentage`, dinars for `fixed_amount`, 0 for `free_shipping`. */
  value: number;
  maxDiscount: number | null;
  minSubtotal: number | null;
  minQuantity: number | null;
  scope: CouponScope;
  audience: CouponAudience;
  usageLimit: number | null;
  oncePerCustomer: boolean;
  startsAt: string | null;
  endsAt: string | null;
  status: CouponStatus;
  /** Where the coupon stands now. */
  state: CouponState;
  /** Orders that used it and are not cancelled. */
  uses: number;
  /** What those orders were given off, in dinars. */
  discountGiven: number;
  createdAt: string;
  updatedAt: string;
}

/** A coupon as the list reads it: how many of each pick, not which. */
export interface CouponSummary extends CouponFields {
  counts: { products: number; collections: number; customers: number; groups: number };
}

/** A coupon with what it covers and who may use it. */
export interface Coupon extends CouponFields {
  products: Array<{ id: string; name: string; handle: string }>;
  collections: Array<{ id: string; title: string; handle: string }>;
  customers: Array<{ id: string; name: string; phone: string }>;
  groups: Array<{ id: string; name: string }>;
}

/** The minimum a coupon asks of the lines it covers: none, an amount, or a number of items. */
export type CouponMinimum = "none" | "subtotal" | "quantity";

export interface CouponFormValues {
  code: string;
  kind: CouponKind;
  value: string;
  maxDiscount: string;
  minimum: CouponMinimum;
  minimumValue: string;
  scope: CouponScope;
  products: PickerOption[];
  collections: PickerOption[];
  audience: CouponAudience;
  customers: PickerOption[];
  groups: PickerOption[];
  usageLimit: string;
  oncePerCustomer: boolean;
  startsAt: string;
  endsAt: string;
  status: CouponStatus;
}

/** The body a create or an update sends; on an update `null` clears a value and a missing key keeps it. */
export interface CouponBody {
  code: string;
  kind: CouponKind;
  value?: number;
  maxDiscount?: number | null;
  minSubtotal?: number | null;
  minQuantity?: number | null;
  scope: CouponScope;
  productIds: string[];
  collectionIds: string[];
  audience: CouponAudience;
  customerIds: string[];
  groupIds: string[];
  usageLimit?: number | null;
  oncePerCustomer: boolean;
  startsAt?: string | null;
  endsAt?: string | null;
  status: CouponStatus;
}
