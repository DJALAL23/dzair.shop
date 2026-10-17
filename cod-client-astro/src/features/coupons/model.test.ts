import { describe, expect, it } from "vitest";
import type { Translate } from "@/i18n/core";
import {
  couponBody,
  couponConditionsLabel,
  couponErrorMessage,
  couponForm,
  couponFormProblem,
  couponScopeLabel,
  couponUsesLabel,
  couponValueLabel,
  EMPTY_COUPON_FORM,
  generateCouponCode,
  parseCouponRoute,
  searchCoupons,
} from "./model";
import type { Coupon, CouponFormValues, CouponSummary } from "./types";

const t = ((key: string, values?: Record<string, unknown>) => (values ? `${key} ${JSON.stringify(values)}` : key)) as Translate;

const STORED: Coupon = {
  id: "c1",
  code: "RAMADAN10",
  kind: "percentage",
  value: 10,
  maxDiscount: 1500,
  minSubtotal: null,
  minQuantity: 2,
  scope: "collections",
  audience: "selected",
  usageLimit: 100,
  oncePerCustomer: true,
  startsAt: "2026-03-01T10:00:00.000Z",
  endsAt: null,
  status: "active",
  state: "live",
  uses: 3,
  discountGiven: 900,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  products: [],
  collections: [{ id: "ete", title: "Été", handle: "ete" }],
  customers: [{ id: "k1", name: "Amel", phone: "0551000001" }],
  groups: [{ id: "vip", name: "VIP" }],
};

const form = (extra: Partial<CouponFormValues> = {}): CouponFormValues => ({ ...EMPTY_COUPON_FORM, code: "SALE10", ...extra });

describe("parseCouponRoute", () => {
  it("tells the list, a new coupon and an edit apart", () => {
    expect(parseCouponRoute("/coupons/")).toEqual({ kind: "list" });
    expect(parseCouponRoute("/coupons/new")).toEqual({ kind: "new" });
    expect(parseCouponRoute("/coupons/c%2F1")).toEqual({ kind: "edit", id: "c/1" });
    expect(parseCouponRoute("/coupons/a/b")).toEqual({ kind: "unknown" });
    expect(parseCouponRoute("/coupons/%E0")).toEqual({ kind: "unknown" });
  });
});

describe("the form and the body it sends", () => {
  it("fills from a stored coupon, and sends it back unchanged", () => {
    const filled = couponForm(STORED);
    expect(filled).toMatchObject({ value: "10", maxDiscount: "1500", minimum: "quantity", minimumValue: "2", usageLimit: "100", oncePerCustomer: true });
    expect(filled.collections).toEqual([{ id: "ete", label: "Été" }]);
    expect(filled.customers).toEqual([{ id: "k1", label: "Amel", detail: "0551000001" }]);
    expect(couponForm({ ...STORED, kind: "free_shipping", value: 0, maxDiscount: null }).value).toBe("");
    expect(couponBody(filled, true)).toEqual({
      code: "RAMADAN10",
      kind: "percentage",
      value: 10,
      maxDiscount: 1500,
      minSubtotal: null,
      minQuantity: 2,
      scope: "collections",
      productIds: [],
      collectionIds: ["ete"],
      audience: "selected",
      customerIds: ["k1"],
      groupIds: ["vip"],
      usageLimit: 100,
      oncePerCustomer: true,
      startsAt: "2026-03-01T10:00:00.000Z",
      endsAt: null,
      status: "active",
    });
  });

  it("sends only what the kind, minimum, scope and audience use — clearing the rest on an edit", () => {
    const shipping = form({ kind: "free_shipping", value: "10", maxDiscount: "500", minimum: "none", minimumValue: "3", scope: "store", products: [{ id: "p", label: "P" }], audience: "everyone", customers: [{ id: "k", label: "K" }] });
    expect(couponBody(shipping, true)).toMatchObject({ maxDiscount: null, minSubtotal: null, minQuantity: null, productIds: [], customerIds: [], groupIds: [] });
    expect(couponBody(shipping, true)).not.toHaveProperty("value");
    expect(couponBody(shipping, false)).toMatchObject({ maxDiscount: undefined, minSubtotal: undefined, usageLimit: undefined, startsAt: undefined });
    expect(couponBody(form({ kind: "fixed_amount", value: "500", maxDiscount: "300" }), false)).toMatchObject({ value: 500, maxDiscount: undefined });
    expect(couponBody(form({ minimum: "subtotal", minimumValue: "3000" }), false)).toMatchObject({ minSubtotal: 3000, minQuantity: undefined });
  });

  it("is judged by the platform's own rule before it is sent", () => {
    expect(couponFormProblem(form())).toBeNull();
    expect(couponFormProblem(form({ code: " sale 10 " }))).toBeNull();
    expect(couponFormProblem(form({ code: "x" }))).toBe("invalid_code");
    expect(couponFormProblem(form({ value: "" }))).toBe("invalid_value");
    expect(couponFormProblem(form({ value: "150" }))).toBe("invalid_value");
    expect(couponFormProblem(form({ kind: "free_shipping", value: "" }))).toBeNull();
    expect(couponFormProblem(form({ minimum: "subtotal", minimumValue: "" }))).toBe("invalid_amount");
    expect(couponFormProblem(form({ scope: "products" }))).toBe("scope_empty");
    expect(couponFormProblem(form({ audience: "selected" }))).toBe("audience_empty");
    expect(couponFormProblem(form({ usageLimit: "0" }))).toBe("invalid_usage_limit");
    expect(couponFormProblem(form({ startsAt: "2026-05-02T10:00", endsAt: "2026-05-01T10:00" }))).toBe("schedule_ends_before_start");
  });
});

describe("labels", () => {
  const summary = (extra: Partial<CouponSummary>): CouponSummary => ({ ...STORED, counts: { products: 0, collections: 1, customers: 1, groups: 1 }, ...extra });

  it("says what a coupon gives, covers and has used", () => {
    expect(couponValueLabel(summary({ kind: "free_shipping", value: 0, maxDiscount: null }), t, "en")).toBe("value.free_shipping");
    expect(couponValueLabel(summary({ kind: "percentage", value: 10, maxDiscount: null }), t, "en")).toBe('value.percentage {"percent":10}');
    expect(couponValueLabel(summary({ kind: "percentage", value: 10, maxDiscount: 1500 }), t, "en")).toMatch(/^value\.percentage_capped .*"max":"1,500 DA"/);
    expect(couponValueLabel(summary({ kind: "fixed_amount", value: 500, maxDiscount: null }), t, "en")).toBe('value.fixed_amount {"amount":"500 DA"}');
    expect(couponScopeLabel(summary({ scope: "store" }), t)).toBe("scope_label.store");
    expect(couponScopeLabel(summary({ scope: "products", counts: { products: 4, collections: 0, customers: 0, groups: 0 } }), t)).toBe('scope_label.products {"count":4}');
    expect(couponScopeLabel(summary({ scope: "collections" }), t)).toBe('scope_label.collections {"count":1}');
    expect(couponUsesLabel(summary({ uses: 3, usageLimit: 100 }), t)).toBe('uses_label.limited {"used":3,"limit":100}');
    expect(couponUsesLabel(summary({ uses: 3, usageLimit: null }), t)).toBe('uses_label.unlimited {"used":3}');
  });

  it("names what a shopper must meet besides the code, and nothing when there is nothing", () => {
    const plain = { audience: "everyone" as const, minSubtotal: null, minQuantity: null, oncePerCustomer: false };
    expect(couponConditionsLabel(plain, t, "en")).toBeNull();
    expect(couponConditionsLabel({ ...plain, audience: "selected" }, t, "en")).toBe("conditions.selected");
    expect(couponConditionsLabel({ ...plain, minSubtotal: 5000, oncePerCustomer: true }, t, "en")).toBe('conditions.min_subtotal {"amount":"5,000 DA"} · conditions.once_per_customer');
    expect(couponConditionsLabel({ ...plain, minQuantity: 3 }, t, "en")).toBe('conditions.min_items {"count":3}');
  });

  it("finds coupons by code, case and spaces aside", () => {
    const list = [summary({ id: "a", code: "RAMADAN10" }), summary({ id: "b", code: "EID2026" })];
    expect(searchCoupons(list, " ramadan ").map((coupon) => coupon.id)).toEqual(["a"]);
    expect(searchCoupons(list, "")).toHaveLength(2);
  });

  it("says why a write was refused", () => {
    expect(couponErrorMessage({ code: "COUPON_CODE_TAKEN" }, t)).toBe("error_code_taken");
    expect(couponErrorMessage({ code: "INVALID_COUPON", context: { reason: "scope_empty" } }, t)).toBe("error_invalid.scope_empty");
    expect(couponErrorMessage({ code: "INVALID_COUPON" }, t)).toBe("error_generic");
    expect(couponErrorMessage({ code: "COUPON_NOT_FOUND" }, t)).toBe("error_not_found");
    expect(couponErrorMessage(new Error("offline"), t)).toBe("error_generic");
  });
});

describe("generateCouponCode", () => {
  it("draws eight characters a shopper cannot misread, that the platform accepts as a code", () => {
    const code = generateCouponCode();
    expect(code).toMatch(/^[A-HJKMNP-Z2-9]{8}$/);
    expect(couponFormProblem(form({ code }))).toBeNull();
    expect(generateCouponCode((size) => new Uint8Array(size).fill(31))).toBe("AAAAAAAA");
  });
});
