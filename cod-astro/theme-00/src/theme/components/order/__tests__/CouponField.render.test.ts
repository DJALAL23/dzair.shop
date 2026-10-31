// @vitest-environment node
/**
 * What the code box emits: closed behind its link on a fresh form, and open
 * with the reason when the order came back refused for its code — worded by
 * the same `couponNotice` the browser uses, in the page's language.
 */
/// <reference types="vitest/globals" />

import { testLocals } from "../../../__tests__/support/locals";
import { Window } from "happy-dom";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import CouponField from "../CouponField.astro";
import { en } from "@/theme/content/en";

async function render(couponRefusal: unknown = null) {
  const container = await AstroContainer.create();
  const html = await container.renderToString(CouponField, { locals: testLocals(), props: { content: en, cur: "DA", couponRefusal } });
  const document = new Window().document;
  document.body.innerHTML = html;
  return document;
}

describe("the code box", () => {
  it("posts the code as couponCode, and stays closed behind its link on a fresh form", async () => {
    const doc = await render();
    expect(doc.querySelector('input[name="couponCode"]')).not.toBeNull();
    expect(doc.querySelector("[data-coupon-box]")!.hasAttribute("hidden")).toBe(true);
    expect(doc.querySelector("[data-coupon-toggle]")!.hasAttribute("hidden")).toBe(false);
    expect(doc.querySelector("[data-coupon-status-row]")!.hasAttribute("hidden")).toBe(true);
  });

  it("opens with the reason when the order came back refused for its code", async () => {
    const doc = await render({ reason: "already_used" });
    expect(doc.querySelector("[data-coupon-box]")!.hasAttribute("hidden")).toBe(false);
    expect(doc.querySelector("[data-coupon-toggle]")!.hasAttribute("hidden")).toBe(false);
    expect(doc.querySelector("[data-coupon-toggle]")!.getAttribute("aria-expanded")).toBe("true");
    const status = doc.querySelector("[data-coupon-status]")!;
    expect(doc.querySelector("[data-coupon-status-row]")!.hasAttribute("hidden")).toBe(false);
    expect(status.textContent?.trim()).toBe(en.couponAlreadyUsed);
    expect(doc.querySelector("[data-coupon-remove]")!.hasAttribute("hidden")).toBe(true);
    expect(status.getAttribute("data-tone")).toBe("refused");
    expect(doc.querySelector('input[name="couponCode"]')!.classList.contains("error")).toBe(true);
  });

  it("carries the copy the browser words its answers with", async () => {
    const doc = await render();
    const copy = JSON.parse(doc.querySelector("[data-coupon-field]")!.getAttribute("data-coupon-copy")!);
    expect(copy).toMatchObject({ couponApplied: en.couponApplied, couponBelowQuantity_one: en.couponBelowQuantity_one, couponRefused: en.couponRefused });
  });
});
