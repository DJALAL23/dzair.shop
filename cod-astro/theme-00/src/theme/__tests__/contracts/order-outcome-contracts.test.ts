// @vitest-environment node
/// <reference types="vitest/globals" />
/**
 * The order form's outcome and the thank-you query it hands over, shared by
 * the product, landing and checkout pages. `astro:actions` is a virtual module
 * that only exists inside an Astro build, so its input-error check is mocked
 * with the same shape Astro uses.
 */
import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";

vi.mock("astro:actions", () => ({
  isInputError: (error: unknown) =>
    typeof error === "object" && error !== null && (error as { type?: string }).type === "AstroActionInputError",
}));

const { orderOutcome } = await import("@/theme/pages/order-outcome");
const { resolveContent } = await import("@/theme/content");
const { readThankYou, thankYouHref } = await import("@wocart/storefront");

const absolute = (href: string) => new URL(href, "https://store.example");
const COPY = resolveContent("en");
const outcomeOf = (result: Parameters<typeof orderOutcome>[0]) => orderOutcome(result, COPY, "en");

describe("the thank-you query", () => {
  it("round-trips any order the server can return", () => {
    fc.assert(
      fc.property(
        fc.record({
          orderNumber: fc.string({ minLength: 1 }),
          total: fc.integer({ min: 0, max: 10_000_000 }),
          orderId: fc.option(fc.string(), { nil: null }),
        }),
        (order) => {
          const href = thankYouHref(order);
          expect(href.startsWith("/thank-you?")).toBe(true);
          expect(readThankYou(absolute(href))).toEqual({
            orderNumber: order.orderNumber.trim(),
            orderId: (order.orderId ?? "").trim(),
            total: order.total,
          });
        },
      ),
      { numRuns: 500 },
    );
  });

  it("reads a missing or malformed total as null, never NaN", () => {
    expect(readThankYou(absolute("/thank-you?order=A1")).total).toBeNull();
    expect(readThankYou(absolute("/thank-you?order=A1&total=")).total).toBeNull();
    expect(readThankYou(absolute("/thank-you?order=A1&total=abc")).total).toBeNull();
    expect(readThankYou(absolute("/thank-you?order=A1&total=0")).total).toBe(0);
  });
});

describe("orderOutcome", () => {
  const order = { orderId: "ord_1", orderNumber: "CF-1001", price: 4000, deliveryFee: 500, total: 4500, couponDiscount: 0 };

  it("redirects a placed order to the thank-you page", () => {
    const outcome = outcomeOf({ data: { status: "placed", order } });
    expect(outcome).toEqual({ redirect: thankYouHref(order), fieldErrors: {}, notice: null, couponRefusal: null });
  });

  it("is quiet before any submit", () => {
    expect(outcomeOf(undefined)).toEqual({ redirect: null, fieldErrors: {}, notice: null, couponRefusal: null });
  });

  it("says the store's own words under each field, never the server's English", () => {
    const outcome = outcomeOf({ error: { type: "AstroActionInputError", fields: { wilayaId: ["Invalid input: expected number, received NaN"], customerName: ["Too short"] } } });
    expect(outcome).toEqual({ redirect: null, fieldErrors: { wilayaId: [COPY.formRequiredField], customerName: [COPY.formFieldInvalid] }, notice: COPY.formFixFields, couponRefusal: null });
  });

  it("puts a field the server refused on that field", () => {
    expect(outcomeOf({ data: { status: "invalid-fields", fields: { communeId: "choose", address: "invalid" } } }).fieldErrors).toEqual({ communeId: [COPY.formRequiredField], address: [COPY.formFieldInvalid] });
  });

  it("names the product that ran out or can no longer be ordered", () => {
    expect(outcomeOf({ data: { status: "out-of-stock", productName: "Robe" } }).notice).toBe("“Robe” isn't available in the quantity you asked for. Lower the quantity or pick another option.");
    expect(outcomeOf({ data: { status: "out-of-stock", productName: null } }).notice).toBe(COPY.formOutOfStock);
    expect(outcomeOf({ data: { status: "product-unavailable", productName: "Sac" } }).notice).toBe("“Sac” can no longer be ordered.");
  });

  it("gives the reference to quote when the order could not be sent, never the server's detail", () => {
    expect(outcomeOf({ data: { status: "failed", reference: "req-42" } }).notice).toContain("req-42");
    expect(outcomeOf({ error: new Error("SKU is missing on product prod-2") })).toEqual({ redirect: null, fieldErrors: {}, notice: COPY.formSubmitFailed, couponRefusal: null });
  });

  it("hands an order refused for its code to the code box, with what the refusal carries", () => {
    const refusal = { reason: "below_minimum_subtotal", shortBy: 2000 };
    expect(outcomeOf({ data: { status: "coupon-refused", couponRefusal: refusal } })).toEqual({ redirect: null, fieldErrors: {}, notice: null, couponRefusal: refusal });
  });

  /** Every refusal the SDK names: each its own sentence in every language, never a key or a placeholder. */
  const refusals = [
    { status: "out-of-stock", productName: null },
    { status: "out-of-stock", productName: "Robe" },
    { status: "product-unavailable", productName: null },
    { status: "product-unavailable", productName: "Robe" },
    { status: "delivery-unavailable" },
    { status: "bot-check-failed" },
    { status: "phone-not-verified" },
    { status: "invalid-fields", fields: { phone: "invalid" } },
    { status: "failed", reference: null },
    { status: "failed", reference: "req-42" },
  ] as const;

  for (const locale of ["ar", "fr", "en"] as const) {
    it(`words every refused order in its own sentence, in ${locale}`, () => {
      const notices = refusals.map((data) => orderOutcome({ data }, resolveContent(locale), locale).notice ?? "");
      for (const notice of notices) expect(notice).toMatch(/^(?!form[A-Z])[^{}]+$/);
      expect(new Set(notices).size).toBe(refusals.length);
    });
  }
});
