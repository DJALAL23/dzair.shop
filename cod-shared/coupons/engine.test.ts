/**
 * priceCoupon — every pricing rule of a coupon, exhaustively.
 *
 * Pure: lines in, discount out. Who may use a coupon and how often is proven
 * against real D1 where the order is placed.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { priceCoupon, type CouponLine, type EngineCoupon } from "./engine";

const line = (productId: string, lineTotal: number, offerId: string | null = null): CouponLine => ({ productId, lineTotal, offerId });

const coupon = (extra: Partial<EngineCoupon> = {}): EngineCoupon => ({
  kind: "percentage",
  value: 10,
  maxDiscount: null,
  minSubtotal: null,
  productIds: null,
  ...extra,
});

describe("which lines a coupon covers", () => {
  it("covers every paid line of the store when it is store-wide", () => {
    expect(priceCoupon([line("a", 1000), line("b", 3000)], coupon())).toEqual({ applied: true, discounts: [100, 300], discount: 400, freeShipping: false });
  });

  it("covers only the products in its scope", () => {
    expect(priceCoupon([line("a", 1000), line("b", 3000)], coupon({ productIds: new Set(["b"]) }))).toMatchObject({ discounts: [0, 300], discount: 300 });
  });

  it("never covers a line an offer applied to, even inside its scope", () => {
    expect(priceCoupon([line("a", 3500, "packs"), line("b", 1000)], coupon())).toMatchObject({ discounts: [0, 100], discount: 100 });
  });

  it("does not apply when every line in scope already has an offer, or none is in scope", () => {
    expect(priceCoupon([line("a", 3500, "packs")], coupon())).toEqual({ applied: false, reason: "no_eligible_products" });
    expect(priceCoupon([line("a", 1000)], coupon({ productIds: new Set(["z"]) }))).toEqual({ applied: false, reason: "no_eligible_products" });
    expect(priceCoupon([], coupon())).toEqual({ applied: false, reason: "no_eligible_products" });
  });
});

describe("the minimum purchase", () => {
  it("is measured on the covered lines alone, and says how far short the basket is", () => {
    const lines = [line("a", 1500), line("b", 9000, "packs"), line("c", 9000)];
    expect(priceCoupon(lines, coupon({ productIds: new Set(["a", "b"]), minSubtotal: 2000 }))).toEqual({ applied: false, reason: "below_minimum", shortBy: 500 });
  });

  it("is met at exactly the amount", () => {
    expect(priceCoupon([line("a", 2000)], coupon({ minSubtotal: 2000 }))).toMatchObject({ applied: true, discount: 200 });
  });
});

describe("what comes off", () => {
  it("takes a percentage rounded to the dinar, then caps it", () => {
    expect(priceCoupon([line("a", 1005)], coupon({ value: 10 }))).toMatchObject({ discount: 101 });
    expect(priceCoupon([line("a", 1004)], coupon({ value: 10 }))).toMatchObject({ discount: 100 });
    expect(priceCoupon([line("a", 10000)], coupon({ value: 20, maxDiscount: 1500 }))).toMatchObject({ discount: 1500 });
    expect(priceCoupon([line("a", 5000)], coupon({ value: 20, maxDiscount: 1500 }))).toMatchObject({ discount: 1000 });
  });

  it("takes a fixed amount once per order, never more than the covered lines cost", () => {
    expect(priceCoupon([line("a", 1000), line("b", 3000)], coupon({ kind: "fixed_amount", value: 500 }))).toMatchObject({ discounts: [125, 375], discount: 500 });
    expect(priceCoupon([line("a", 300), line("b", 3000, "packs")], coupon({ kind: "fixed_amount", value: 500 }))).toMatchObject({ discounts: [300, 0], discount: 300 });
  });

  it("makes delivery free for the order and takes nothing off the lines", () => {
    expect(priceCoupon([line("a", 1000), line("b", 3000, "packs")], coupon({ kind: "free_shipping", value: 0 }))).toEqual({
      applied: true,
      discounts: [0, 0],
      discount: 0,
      freeShipping: true,
    });
  });

  it("shares the discount by what each line costs, the remainder to the larger fraction", () => {
    expect(priceCoupon([line("a", 1000), line("b", 1000), line("c", 1000)], coupon({ kind: "fixed_amount", value: 100 }))).toMatchObject({ discounts: [34, 33, 33] });
    expect(priceCoupon([line("a", 1000), line("b", 2000)], coupon({ kind: "fixed_amount", value: 100 }))).toMatchObject({ discounts: [33, 67] });
  });
});

describe("invariants", () => {
  const arbLines = fc.array(
    fc.record({
      productId: fc.constantFrom("a", "b", "c", "d"),
      lineTotal: fc.integer({ min: 0, max: 200_000 }),
      offerId: fc.constantFrom(null, null, "o1"),
    }),
    { maxLength: 8 },
  );
  const arbCoupon = fc.oneof(
    fc.record({
      kind: fc.constant("percentage" as const),
      value: fc.integer({ min: 1, max: 100 }),
      maxDiscount: fc.option(fc.integer({ min: 1, max: 50_000 }), { nil: null }),
      minSubtotal: fc.option(fc.integer({ min: 1, max: 100_000 }), { nil: null }),
      productIds: fc.option(fc.subarray(["a", "b", "c", "d"]).map((ids) => new Set(ids)), { nil: null }),
    }),
    fc.record({
      kind: fc.constant("fixed_amount" as const),
      value: fc.integer({ min: 1, max: 100_000 }),
      maxDiscount: fc.constant(null),
      minSubtotal: fc.option(fc.integer({ min: 1, max: 100_000 }), { nil: null }),
      productIds: fc.option(fc.subarray(["a", "b", "c", "d"]).map((ids) => new Set(ids)), { nil: null }),
    }),
  );

  it("takes off exactly its discount, only from covered lines, never below zero, never above the cap", () => {
    fc.assert(
      fc.property(arbLines, arbCoupon, (lines, c) => {
        const result = priceCoupon(lines, c);
        if (!result.applied) return;
        expect(result.discounts).toHaveLength(lines.length);
        expect(result.discounts.reduce((sum, value) => sum + value, 0)).toBe(result.discount);
        lines.forEach((l, index) => {
          const covered = l.offerId === null && (c.productIds === null || c.productIds.has(l.productId));
          if (!covered) expect(result.discounts[index]).toBe(0);
          expect(result.discounts[index]).toBeGreaterThanOrEqual(0);
          expect(result.discounts[index]).toBeLessThanOrEqual(l.lineTotal);
          expect(Number.isInteger(result.discounts[index])).toBe(true);
        });
        if (c.maxDiscount !== null) expect(result.discount).toBeLessThanOrEqual(c.maxDiscount);
        if (c.kind === "fixed_amount") expect(result.discount).toBeLessThanOrEqual(c.value);
      }),
    );
  });

  it("applies exactly when a covered line exists and the covered lines reach the minimum", () => {
    fc.assert(
      fc.property(arbLines, arbCoupon, (lines, c) => {
        const covered = lines.filter((l) => l.offerId === null && (c.productIds === null || c.productIds.has(l.productId)));
        const subtotal = covered.reduce((sum, l) => sum + l.lineTotal, 0);
        const result = priceCoupon(lines, c);
        expect(result.applied).toBe(covered.length > 0 && (c.minSubtotal === null || subtotal >= c.minSubtotal));
        if (!result.applied && result.reason === "below_minimum") expect(result.shortBy).toBe(c.minSubtotal! - subtotal);
      }),
    );
  });
});
