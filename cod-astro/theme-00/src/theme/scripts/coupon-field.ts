/**
 * The code box in the browser: which code the page's quote is asked with, and
 * what the shopper is told about it.
 *
 * A code counts once it is applied — Apply, Enter in the box, or arriving with
 * a shared link (`?coupon=CODE`, kept for the visit so it follows the shopper
 * from page to page). The page then asks its quote again; the answer's
 * `coupon` is worded by `couponNotice`, the same words the server uses when it
 * refuses an order for its code.
 */
import { couponFromUrl, type CouponOutcome } from "@wocart/storefront";
import { couponNotice, type CouponCopy } from "@/theme/utils/coupon-notice";

/** Where the visit keeps the code a shared link brought, and the last one applied. */
export const COUPON_STORAGE_KEY = "theme00:coupon";

export interface CouponField {
  /** The code applied, which the quote is asked with; undefined for none. */
  code(): string | undefined;
  /** Shows a quote's answer about the applied code; call it with every answer the page receives. */
  show(outcome: CouponOutcome | null | undefined): void;
}

function remembered(): string | null {
  try {
    return sessionStorage.getItem(COUPON_STORAGE_KEY);
  } catch {
    return null;
  }
}

function remember(code: string | undefined): void {
  try {
    if (code) sessionStorage.setItem(COUPON_STORAGE_KEY, code);
    else sessionStorage.removeItem(COUPON_STORAGE_KEY);
  } catch {
    // Private mode or storage refused: the code still applies on this page.
  }
}

function readCopy(raw: string | undefined): CouponCopy {
  try {
    return raw ? (JSON.parse(raw) as CouponCopy) : {};
  } catch {
    return {};
  }
}

/**
 * Wires the code box under `root`, or answers null when the form has none.
 * `onApply` runs whenever the applied code changes: the page asks its quote.
 */
export function initCouponField(root: ParentNode, onApply: () => void): CouponField | null {
  const field = root.querySelector<HTMLElement>("[data-coupon-field]");
  const toggle = field?.querySelector<HTMLButtonElement>("[data-coupon-toggle]");
  const box = field?.querySelector<HTMLElement>("[data-coupon-box]");
  const input = field?.querySelector<HTMLInputElement>('input[name="couponCode"]');
  const apply = field?.querySelector<HTMLButtonElement>("[data-coupon-apply]");
  const status = field?.querySelector<HTMLElement>("[data-coupon-status]");
  if (!field || !toggle || !box || !input || !apply || !status) return null;

  const copy = readCopy(field.dataset.couponCopy);
  const currency = field.dataset.currency ?? "";
  let applied: string | undefined;

  function open(): void {
    box!.hidden = false;
    toggle!.hidden = true;
    toggle!.setAttribute("aria-expanded", "true");
  }

  function say(text: string, tone?: "applied" | "refused"): void {
    status!.textContent = text;
    status!.hidden = text === "";
    if (tone) status!.dataset.tone = tone;
    else delete status!.dataset.tone;
    input!.classList.toggle("error", tone === "refused");
  }

  function use(code: string | undefined): void {
    applied = code;
    remember(code);
    say(code ? (field!.dataset.checking ?? "") : "");
    onApply();
  }

  toggle.addEventListener("click", () => {
    open();
    input.focus();
  });
  apply.addEventListener("click", () => use(input.value.trim() || undefined));
  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    // Enter in the code box applies the code; it never submits the order.
    event.preventDefault();
    use(input.value.trim() || undefined);
  });

  const brought = couponFromUrl(new URL(window.location.href));
  if (brought) remember(brought);
  const start = brought ?? remembered();
  if (start && !input.value) {
    input.value = start;
    open();
    applied = start;
  }

  return {
    code: () => applied,
    show(outcome) {
      // No code applied, or an answer that says nothing of one (a server that
      // predates coupons): nothing to tell.
      if (!applied || !outcome) {
        say("");
        return;
      }
      const notice = couponNotice(outcome, copy, document.documentElement.lang || "ar", currency);
      say(notice.text, notice.tone);
    },
  };
}
