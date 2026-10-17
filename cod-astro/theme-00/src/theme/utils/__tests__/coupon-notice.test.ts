/**
 * What the shopper is told about a code — every answer the platform gives,
 * in the shopper's language, with the figure a reason carries.
 */
import { describe, expect, it } from "vitest";
import { en } from "@/theme/content/en";
import { ar } from "@/theme/content/ar";
import { couponCopy, couponNotice } from "../coupon-notice";

const copy = couponCopy(en);
const refused = (reason: string, extra: { shortBy?: number; startsAt?: string } = {}) => ({ applied: false as const, reason, ...extra });
const say = (answer: Parameters<typeof couponNotice>[0]) => couponNotice(answer, copy, "en", "DA");

describe("couponNotice", () => {
  it("says what an applied code took off, or that delivery is free", () => {
    expect(say({ code: "DIX", applied: true, discount: 500, freeShipping: false })).toEqual({ tone: "applied", text: expect.stringMatching(/^Code applied: .*500.*DA off$/) });
    expect(say({ code: "LIV", applied: true, discount: 0, freeShipping: true })).toEqual({ tone: "applied", text: en.couponAppliedFreeShipping });
  });

  it("words each refusal of the code itself, as a refusal", () => {
    const sentences: Record<string, string> = {
      not_found: en.couponNotFound,
      expired: en.couponExpired,
      used_up: en.couponUsedUp,
      not_eligible: en.couponNotEligible,
      already_used: en.couponAlreadyUsed,
    };
    for (const [reason, text] of Object.entries(sentences)) expect(say(refused(reason))).toEqual({ tone: "refused", text });
  });

  it("words what the basket still lacks as a hint, not as a bad code", () => {
    const sentences: Record<string, string> = {
      identify_first: en.couponIdentifyFirst,
      no_eligible_products: en.couponNoEligibleProducts,
      offer_applied: en.couponOfferApplied,
      delivery_already_free: en.couponDeliveryAlreadyFree,
    };
    for (const [reason, text] of Object.entries(sentences)) expect(say(refused(reason))).toEqual({ tone: "hint", text });
    expect(say(refused("below_minimum_subtotal", { shortBy: 500 })).tone).toBe("hint");
    expect(say(refused("below_minimum_quantity", { shortBy: 1 })).tone).toBe("hint");
  });

  it("names the figure a reason carries: the amount, the items, the start date", () => {
    expect(say(refused("below_minimum_subtotal", { shortBy: 2000 })).text).toMatch(/^Add .*2.000.*DA more/);
    expect(say(refused("below_minimum_quantity", { shortBy: 1 })).text).toBe("Add 1 more eligible item to use this code.");
    expect(say(refused("below_minimum_quantity", { shortBy: 3 })).text).toBe("Add 3 more eligible items to use this code.");
    expect(say(refused("not_started", { startsAt: "2099-03-01T12:00:00.000Z" })).text).toBe("This code starts on March 1, 2099.");
  });

  it("falls back to the general sentence for a reason it does not know, or a figure that is missing", () => {
    for (const answer of [refused("brand_new_reason"), refused("constructor"), refused("below_minimum_subtotal"), refused("below_minimum_quantity"), refused("not_started")]) {
      expect(say(answer)).toEqual({ tone: "refused", text: en.couponRefused });
    }
  });

  it("speaks the page's language, with its own plural forms", () => {
    expect(couponNotice(refused("below_minimum_quantity", { shortBy: 2 }), couponCopy(ar), "ar", "دج").text).toBe(ar.couponBelowQuantity_two);
  });
});
