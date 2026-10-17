import { describe, expect, it } from "vitest";
import { couponProblem, couponState, normalizeCouponCode, type CouponShape } from "./model";

const shape = (extra: Partial<CouponShape> = {}): CouponShape => ({
  code: "RAMADAN10",
  kind: "percentage",
  value: 10,
  maxDiscount: null,
  minSubtotal: null,
  minQuantity: null,
  scope: "store",
  productIds: [],
  collectionIds: [],
  audience: "everyone",
  customerIds: [],
  groupIds: [],
  usageLimit: null,
  oncePerCustomer: false,
  startsAt: null,
  endsAt: null,
  ...extra,
});

describe("normalizeCouponCode", () => {
  it("drops spaces, upper-cases Latin letters and reads Arabic-Indic digits as 0–9", () => {
    expect(normalizeCouponCode(" ramadan 10 ")).toBe("RAMADAN10");
    expect(normalizeCouponCode("eid٢٠٢٦")).toBe("EID2026");
    expect(normalizeCouponCode("eid۲۰۲۶")).toBe("EID2026");
    expect(normalizeCouponCode("vip_club-1")).toBe("VIP_CLUB-1");
  });

  it("refuses what is not a code: too short, too long, other characters", () => {
    expect(normalizeCouponCode("ab")).toBeNull();
    expect(normalizeCouponCode("A".repeat(33))).toBeNull();
    expect(normalizeCouponCode("A".repeat(32))).toBe("A".repeat(32));
    expect(normalizeCouponCode("رمضان")).toBeNull();
    expect(normalizeCouponCode("SALE!")).toBeNull();
    expect(normalizeCouponCode("")).toBeNull();
  });
});

describe("couponProblem", () => {
  it("accepts a coherent coupon of every kind", () => {
    expect(couponProblem(shape())).toBeNull();
    expect(couponProblem(shape({ value: 100, maxDiscount: 2000 }))).toBeNull();
    expect(couponProblem(shape({ kind: "fixed_amount", value: 500, minSubtotal: 3000 }))).toBeNull();
    expect(couponProblem(shape({ kind: "free_shipping", value: 0 }))).toBeNull();
  });

  it("refuses a code that is not in the stored form", () => {
    expect(couponProblem(shape({ code: "ramadan10" }))).toBe("invalid_code");
    expect(couponProblem(shape({ code: "AB" }))).toBe("invalid_code");
  });

  it("holds each kind to its own value", () => {
    for (const value of [0, 101, 2.5]) expect(couponProblem(shape({ value }))).toBe("invalid_value");
    for (const value of [0, -5, 9.5]) expect(couponProblem(shape({ kind: "fixed_amount", value }))).toBe("invalid_value");
    expect(couponProblem(shape({ kind: "free_shipping", value: 1 }))).toBe("invalid_value");
  });

  it("caps only a percentage, and keeps every amount a whole positive dinar", () => {
    expect(couponProblem(shape({ kind: "fixed_amount", value: 500, maxDiscount: 400 }))).toBe("max_discount_not_allowed");
    expect(couponProblem(shape({ kind: "free_shipping", value: 0, maxDiscount: 400 }))).toBe("max_discount_not_allowed");
    expect(couponProblem(shape({ maxDiscount: 0 }))).toBe("invalid_amount");
    expect(couponProblem(shape({ minSubtotal: 0 }))).toBe("invalid_amount");
    expect(couponProblem(shape({ minSubtotal: 99.5 }))).toBe("invalid_amount");
    expect(couponProblem(shape({ minQuantity: 0 }))).toBe("invalid_amount");
    expect(couponProblem(shape({ minQuantity: 2 }))).toBeNull();
  });

  it("asks for a minimum amount or a minimum number of items, never both", () => {
    expect(couponProblem(shape({ minSubtotal: 3000, minQuantity: 2 }))).toBe("minimum_conflict");
  });

  it("picks at least one of what its scope names, and nothing else", () => {
    expect(couponProblem(shape({ scope: "products" }))).toBe("scope_empty");
    expect(couponProblem(shape({ scope: "collections" }))).toBe("scope_empty");
    expect(couponProblem(shape({ scope: "products", productIds: ["p"] }))).toBeNull();
    expect(couponProblem(shape({ scope: "collections", collectionIds: ["c"] }))).toBeNull();
    expect(couponProblem(shape({ scope: "products", productIds: ["p"], collectionIds: ["c"] }))).toBe("scope_mismatch");
    expect(couponProblem(shape({ scope: "collections", collectionIds: ["c"], productIds: ["p"] }))).toBe("scope_mismatch");
    expect(couponProblem(shape({ scope: "store", productIds: ["p"] }))).toBe("scope_mismatch");
    expect(couponProblem(shape({ scope: "store", collectionIds: ["c"] }))).toBe("scope_mismatch");
  });

  it("names its customers or groups only when it is for selected customers", () => {
    expect(couponProblem(shape({ audience: "selected" }))).toBe("audience_empty");
    expect(couponProblem(shape({ audience: "selected", customerIds: ["k"] }))).toBeNull();
    expect(couponProblem(shape({ audience: "selected", groupIds: ["g"] }))).toBeNull();
    expect(couponProblem(shape({ customerIds: ["k"] }))).toBe("audience_mismatch");
    expect(couponProblem(shape({ groupIds: ["g"] }))).toBe("audience_mismatch");
  });

  it("picks no more than each limit allows", () => {
    const ids = (n: number) => Array.from({ length: n }, (_, i) => `x${i}`);
    expect(couponProblem(shape({ scope: "products", productIds: ids(500) }))).toBeNull();
    expect(couponProblem(shape({ scope: "products", productIds: ids(501) }))).toBe("too_many_picks");
    expect(couponProblem(shape({ scope: "collections", collectionIds: ids(101) }))).toBe("too_many_picks");
    expect(couponProblem(shape({ audience: "selected", customerIds: ids(1000) }))).toBeNull();
    expect(couponProblem(shape({ audience: "selected", customerIds: ids(1001) }))).toBe("too_many_picks");
    expect(couponProblem(shape({ audience: "selected", groupIds: ids(51) }))).toBe("too_many_picks");
  });

  it("limits uses to a whole positive number, and ends a schedule after it starts", () => {
    expect(couponProblem(shape({ usageLimit: 0 }))).toBe("invalid_usage_limit");
    expect(couponProblem(shape({ usageLimit: 1 }))).toBeNull();
    expect(couponProblem(shape({ startsAt: "2026-11-01T00:00:00.000Z", endsAt: "2026-11-01T00:00:00.000Z" }))).toBe("schedule_ends_before_start");
    expect(couponProblem(shape({ startsAt: "2026-11-01T00:00:00.000Z", endsAt: "2026-11-02T00:00:00.000Z" }))).toBeNull();
    expect(couponProblem(shape({ endsAt: "2026-11-02T00:00:00.000Z" }))).toBeNull();
  });
});

describe("couponState", () => {
  const NOW = "2026-11-10T12:00:00.000Z";
  const at = (extra: Partial<Parameters<typeof couponState>[0]> = {}) => ({ status: "active" as const, startsAt: null, endsAt: null, usageLimit: null, ...extra });

  it("is live when active, started, not ended and not used up", () => {
    expect(couponState(at(), 0, NOW)).toBe("live");
    expect(couponState(at({ startsAt: NOW, endsAt: "2026-11-10T12:00:00.001Z", usageLimit: 3 }), 2, NOW)).toBe("live");
  });

  it("says why it is not, the merchant's switch first", () => {
    expect(couponState(at({ status: "inactive", endsAt: "2026-01-01T00:00:00.000Z" }), 0, NOW)).toBe("inactive");
    expect(couponState(at({ startsAt: "2026-11-10T12:00:00.001Z" }), 0, NOW)).toBe("scheduled");
    expect(couponState(at({ endsAt: NOW }), 0, NOW)).toBe("expired");
    expect(couponState(at({ usageLimit: 3 }), 3, NOW)).toBe("used_up");
  });
});
