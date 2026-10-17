/**
 * The code box in the browser: what counts as the applied code, and what the
 * shopper is told about it.
 */
/// <reference types="vitest/globals" />
import { vi } from "vitest";
import { en } from "@/theme/content/en";
import { couponCopy } from "@/theme/utils/coupon-notice";
import { COUPON_STORAGE_KEY, initCouponField } from "../coupon-field";

function mount(): HTMLElement {
  const root = document.createElement("form");
  root.innerHTML = `
    <div data-coupon-field data-coupon-copy='${JSON.stringify(couponCopy(en)).replace(/'/g, "&#39;")}' data-currency="DA" data-checking="Checking">
      <button type="button" data-coupon-toggle aria-expanded="false">Have a code?</button>
      <div data-coupon-box hidden>
        <input name="couponCode" />
        <button type="button" data-coupon-apply>Apply</button>
        <div data-coupon-status-row hidden><p data-coupon-status><span data-coupon-text></span></p><button type="button" data-coupon-remove hidden>Remove</button></div>
      </div>
    </div>`;
  document.body.appendChild(root);
  return root;
}

const status = (root: HTMLElement) => root.querySelector<HTMLElement>("[data-coupon-status]")!;
const statusRow = (root: HTMLElement) => root.querySelector<HTMLElement>("[data-coupon-status-row]")!;
const removeButton = (root: HTMLElement) => root.querySelector<HTMLButtonElement>("[data-coupon-remove]")!;
const input = (root: HTMLElement) => root.querySelector<HTMLInputElement>('input[name="couponCode"]')!;

describe("the code box", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    sessionStorage.clear();
    window.history.replaceState(null, "", "/products/robe");
  });

  it("opens behind its link, and applies the code on Apply or Enter — Enter never submits the order", () => {
    const root = mount();
    const asked = vi.fn();
    const field = initCouponField(root, asked)!;
    root.querySelector<HTMLButtonElement>("[data-coupon-toggle]")!.click();
    expect(root.querySelector<HTMLElement>("[data-coupon-box]")!.hidden).toBe(false);

    input(root).value = "  dix ";
    root.querySelector<HTMLButtonElement>("[data-coupon-apply]")!.click();
    expect(field.code()).toBe("dix");
    expect(asked).toHaveBeenCalledTimes(1);
    expect(status(root).textContent).toBe("Checking");

    input(root).value = "AUTRE";
    const enter = new KeyboardEvent("keydown", { key: "Enter", cancelable: true });
    input(root).dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(true);
    expect(field.code()).toBe("AUTRE");
    expect(asked).toHaveBeenCalledTimes(2);

    input(root).value = "";
    root.querySelector<HTMLButtonElement>("[data-coupon-apply]")!.click();
    expect(field.code()).toBeUndefined();
    expect(sessionStorage.getItem(COUPON_STORAGE_KEY)).toBeNull();
  });

  it("tells the quote's answer about the applied code, and nothing without one", () => {
    const root = mount();
    const field = initCouponField(root, () => {})!;
    field.show({ code: "X", applied: true, discount: 500, freeShipping: false });
    expect(statusRow(root).hidden).toBe(true);

    input(root).value = "DIX";
    root.querySelector<HTMLButtonElement>("[data-coupon-apply]")!.click();
    field.show({ code: "DIX", applied: true, discount: 500, freeShipping: false });
    expect(statusRow(root).hidden).toBe(false);
    expect(status(root).dataset.tone).toBe("applied");
    expect(removeButton(root).hidden).toBe(false);
    expect(status(root).textContent).toMatch(/500/);

    field.show({ code: "DIX", applied: false, reason: "expired" });
    expect(status(root).textContent).toBe(en.couponExpired);
    expect(status(root).dataset.tone).toBe("refused");
    expect(input(root).classList.contains("error")).toBe(true);
    expect(removeButton(root).hidden).toBe(true);

    field.show({ code: "DIX", applied: false, reason: "offer_applied" });
    expect(status(root).dataset.tone).toBe("hint");
    expect(input(root).classList.contains("error")).toBe(false);

    field.show(undefined);
    expect(statusRow(root).hidden).toBe(true);
  });

  it("takes an applied code off with Remove, and asks the quote again", () => {
    const root = mount();
    const asked = vi.fn();
    const field = initCouponField(root, asked)!;
    input(root).value = "DIX";
    root.querySelector<HTMLButtonElement>("[data-coupon-apply]")!.click();
    field.show({ code: "DIX", applied: true, discount: 500, freeShipping: false });

    removeButton(root).click();
    expect(field.code()).toBeUndefined();
    expect(input(root).value).toBe("");
    expect(asked).toHaveBeenCalledTimes(2);
    expect(statusRow(root).hidden).toBe(true);
    expect(sessionStorage.getItem(COUPON_STORAGE_KEY)).toBeNull();
  });

  it("takes the code a shared link brings, and keeps it for the visit's next pages", () => {
    window.history.replaceState(null, "", "/products/robe?coupon=RAMADAN10");
    const first = mount();
    expect(initCouponField(first, () => {})!.code()).toBe("RAMADAN10");
    expect(input(first).value).toBe("RAMADAN10");
    expect(first.querySelector<HTMLElement>("[data-coupon-box]")!.hidden).toBe(false);

    document.body.innerHTML = "";
    window.history.replaceState(null, "", "/checkout");
    const next = mount();
    expect(initCouponField(next, () => {})!.code()).toBe("RAMADAN10");
  });

  it("still applies a code when the browser refuses storage", () => {
    const refuse = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    const root = mount();
    const field = initCouponField(root, () => {})!;
    input(root).value = "DIX";
    root.querySelector<HTMLButtonElement>("[data-coupon-apply]")!.click();
    expect(field.code()).toBe("DIX");
    refuse.mockRestore();
  });

  it("is absent from a form without a code box", () => {
    expect(initCouponField(document.createElement("form"), () => {})).toBeNull();
  });
});
