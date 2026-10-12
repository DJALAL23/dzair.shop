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

const { orderOutcome, readThankYou, thankYouHref } = await import("@/theme/pages/order-outcome");

const absolute = (href: string) => new URL(href, "https://store.example");

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
            orderNumber: order.orderNumber,
            orderId: order.orderId ?? "",
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
  it("redirects a placed order to the thank-you page", () => {
    const outcome = orderOutcome({ data: { orderNumber: "CF-1001", total: 4500, orderId: "ord_1" } });
    expect(outcome.redirect).toBe(thankYouHref({ orderNumber: "CF-1001", total: 4500, orderId: "ord_1" }));
    expect(outcome.fieldErrors).toEqual({});
    expect(outcome.serverError).toBeNull();
  });

  it("returns field errors for invalid input and keeps the shopper on the form", () => {
    const outcome = orderOutcome({
      error: { type: "AstroActionInputError", fields: { phone: ["Invalid phone"] } },
    });
    expect(outcome).toEqual({ redirect: null, fieldErrors: { phone: ["Invalid phone"] }, serverError: null });
  });

  it("returns the server message for any other failure", () => {
    const outcome = orderOutcome({ error: new Error("Out of stock") });
    expect(outcome).toEqual({ redirect: null, fieldErrors: {}, serverError: "Out of stock" });
  });

  it("is quiet before any submit", () => {
    expect(orderOutcome(undefined)).toEqual({ redirect: null, fieldErrors: {}, serverError: null });
  });
});
