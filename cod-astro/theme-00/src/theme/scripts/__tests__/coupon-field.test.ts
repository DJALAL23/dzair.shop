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
  const page = document.createElement("div");
  document.body.appendChild(page);
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
  page.appendChild(root);
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

  it("closes again from the same link, and keeps a code already applied", () => {
    const root = mount();
    const field = initCouponField(root, vi.fn())!;
    const toggle = root.querySelector<HTMLButtonElement>("[data-coupon-toggle]")!;
    const box = root.querySelector<HTMLElement>("[data-coupon-box]")!;
    toggle.click();
    input(root).value = "dix";
    root.querySelector<HTMLButtonElement>("[data-coupon-apply]")!.click();
    toggle.click();
    expect([box.hidden, toggle.hidden, toggle.getAttribute("aria-expanded")]).toEqual([true, false, "false"]);
    expect(field.code()).toBe("dix");
    toggle.click();
    expect([box.hidden, toggle.getAttribute("aria-expanded")]).toEqual([false, "true"]);
  });

  it("opens behind its link, and applies the code on Apply or Enter — Enter never submits the order", () => {
    const root = mount();
    const asked = vi.fn();
    const field = initCouponField(root, asked)!;
    const toggle = root.querySelector<HTMLButtonElement>("[data-coupon-toggle]")!;
    toggle.click();
    expect(root.querySelector<HTMLElement>("[data-coupon-box]")!.hidden).toBe(false);
    expect([toggle.hidden, toggle.getAttribute("aria-expanded")]).toEqual([false, "true"]);

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

    field.show(null);
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

  describe("the order waits for its code", () => {
    /** Submits the form as a click would; answers whether the order went out. */
    function submit(root: HTMLElement): boolean {
      const event = new SubmitEvent("submit", { bubbles: true, cancelable: true });
      return root.dispatchEvent(event);
    }

    it("goes straight out with no code, or with an applied code", () => {
      const root = mount();
      const field = initCouponField(root, () => {})!;
      expect(submit(root)).toBe(true);

      input(root).value = "DIX";
      root.querySelector<HTMLButtonElement>("[data-coupon-apply]")!.click();
      field.show({ code: "DIX", applied: true, discount: 500, freeShipping: false });
      expect(submit(root)).toBe(true);
    });

    it("applies a code typed but not applied, then places the order once it applies", () => {
      const root = mount();
      const asked = vi.fn();
      const field = initCouponField(root, asked)!;
      const requestSubmit = vi.spyOn(root as HTMLFormElement, "requestSubmit").mockImplementation(() => {});
      input(root).value = "DIX";

      expect(submit(root)).toBe(false);
      expect(field.code()).toBe("DIX");
      expect(asked).toHaveBeenCalledTimes(1);

      field.show({ code: "DIX", applied: true, discount: 500, freeShipping: false });
      expect(requestSubmit).toHaveBeenCalledTimes(1);
    });

    it("holds the order, every field kept, while its code does not apply — and lets it go once removed", () => {
      const root = mount();
      const field = initCouponField(root, () => {})!;
      const requestSubmit = vi.spyOn(root as HTMLFormElement, "requestSubmit").mockImplementation(() => {});
      input(root).value = "NOPE";

      expect(submit(root)).toBe(false);
      field.show({ code: "NOPE", applied: false, reason: "not_found" });
      expect(requestSubmit).not.toHaveBeenCalled();
      expect(submit(root)).toBe(false);
      expect(document.activeElement).toBe(input(root));

      input(root).value = "";
      expect(submit(root)).toBe(true);
      expect(field.code()).toBeUndefined();
      expect(requestSubmit).not.toHaveBeenCalled();
    });

    it("waits for an answer still on its way, and stops the gates behind it — the OTP step sends nothing", () => {
      const root = mount();
      initCouponField(root, () => {});
      const otpGate = vi.fn();
      root.addEventListener("submit", otpGate, { capture: true });
      input(root).value = "DIX";
      root.querySelector<HTMLButtonElement>("[data-coupon-apply]")!.click();

      expect(submit(root)).toBe(false);
      expect(otpGate).not.toHaveBeenCalled();
    });

    it("never sends the order on its own after a hold the shopper fixed: they confirm again", () => {
      const root = mount();
      const field = initCouponField(root, () => {})!;
      const requestSubmit = vi.spyOn(root as HTMLFormElement, "requestSubmit").mockImplementation(() => {});
      input(root).value = "NOPE";
      submit(root);
      field.show({ code: "NOPE", applied: false, reason: "not_found" });
      submit(root);

      input(root).value = "DIX";
      root.querySelector<HTMLButtonElement>("[data-coupon-apply]")!.click();
      field.show({ code: "DIX", applied: true, discount: 500, freeShipping: false });
      expect(requestSubmit).not.toHaveBeenCalled();
    });

    it("holds only its own form", () => {
      const root = mount();
      initCouponField(root, () => {});
      input(root).value = "NOPE";
      const other = document.createElement("form");
      root.parentElement!.appendChild(other);
      expect(other.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }))).toBe(true);
    });

    it("leaves the order to the server when an answer says nothing of the code", () => {
      const root = mount();
      const field = initCouponField(root, () => {})!;
      input(root).value = "DIX";
      root.querySelector<HTMLButtonElement>("[data-coupon-apply]")!.click();
      field.show(null);
      expect(submit(root)).toBe(true);
    });
  });
});
