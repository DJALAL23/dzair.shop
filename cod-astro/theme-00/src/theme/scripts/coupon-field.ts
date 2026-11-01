/**
 * The code box in the browser: which code the page's quote is asked with, and
 * what the shopper is told about it.
 *
 * A code counts once it is applied — Apply, Enter in the box, or arriving with
 * a shared link (`?coupon=CODE`, kept for the visit so it follows the shopper
 * from page to page). The page then asks its quote again; the answer's
 * `coupon` is worded by `couponNotice`, the same words the server uses when it
 * refuses an order for its code.
 *
 * The order waits for its code: submitting with a code typed but not applied
 * applies it first and places the order once it applies; a code that does not
 * apply holds the order, its reason on screen and every field kept — the
 * server would refuse the whole order for it, and the shopper would lose what
 * they typed.
 */
import { couponFromUrl, type CouponOutcome } from "@wocart/storefront";
import { couponNotice, type CouponCopy, type CouponNotice } from "@/theme/utils/coupon-notice";

/** Where the visit keeps the code a shared link brought, and the last one applied. */
export const COUPON_STORAGE_KEY = "theme00:coupon";

export interface CouponField {
  /** The code applied, which the quote is asked with; undefined for none. */
  code(): string | undefined;
  /** Shows a quote's answer about the applied code (null: asked without one); call it with every answer the page receives. */
  show(outcome: CouponOutcome | null): void;
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
  const statusRow = field?.querySelector<HTMLElement>("[data-coupon-status-row]");
  const status = field?.querySelector<HTMLElement>("[data-coupon-status]");
  const text = field?.querySelector<HTMLElement>("[data-coupon-text]");
  const remove = field?.querySelector<HTMLButtonElement>("[data-coupon-remove]");
  if (!field || !toggle || !box || !input || !apply || !statusRow || !status || !text || !remove) return null;

  const copy = readCopy(field.dataset.couponCopy);
  const currency = field.dataset.currency ?? "";
  const form = field.closest("form");
  let applied: string | undefined;
  /** The quote has answered for the applied code — `outcome` is what it said. */
  let settled = false;
  let outcome: CouponOutcome | undefined;
  /** The shopper submitted while the code was being checked: place the order once it applies. */
  let submitWhenApplied = false;

  /** The link stays: it opens the code box and closes it again; a code already applied stays applied. */
  function show(open: boolean): void {
    box!.hidden = !open;
    toggle!.setAttribute("aria-expanded", String(open));
  }

  function say(message: string, tone?: CouponNotice["tone"]): void {
    text!.textContent = message;
    statusRow!.hidden = message === "";
    if (tone) status!.dataset.tone = tone;
    else delete status!.dataset.tone;
    remove!.hidden = tone !== "applied";
    input!.classList.toggle("error", tone === "refused");
  }

  function use(code: string | undefined): void {
    applied = code;
    settled = !code;
    outcome = undefined;
    remember(code);
    say(code ? (field!.dataset.checking ?? "") : "");
    onApply();
  }

  toggle.addEventListener("click", () => {
    show(box.hidden !== false);
    if (!box.hidden) input.focus();
  });
  apply.addEventListener("click", () => use(input.value.trim() || undefined));
  remove.addEventListener("click", () => {
    input.value = "";
    use(undefined);
    input.focus();
  });
  /** Whether the order must wait for its code; a code typed but not applied is applied now. */
  function holds(): boolean {
    const typed = input!.value.trim() || undefined;
    if (typed !== applied) {
      use(typed);
      return typed !== undefined || !settled;
    }
    if (!applied) return false;
    if (!settled) return true;
    return outcome !== undefined && !outcome.applied;
  }

  // Capture, on the form's parent: before any gate on the form itself (the
  // OTP step sends a code on submit), and gone with the form.
  form?.parentElement?.addEventListener(
    "submit",
    (event) => {
      if (event.target !== form || !holds()) return;
      event.preventDefault();
      event.stopPropagation();
      submitWhenApplied = !settled;
      if (settled) input.focus();
    },
    { capture: true },
  );
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
    show(true);
    applied = start;
  }

  return {
    code: () => applied,
    show(answer) {
      settled = true;
      outcome = answer ?? undefined;
      const resume = submitWhenApplied;
      submitWhenApplied = false;
      // No code applied, or an answer asked without one: nothing to tell.
      if (!applied || !answer) {
        say("");
        if (resume) form?.requestSubmit();
        return;
      }
      const notice = couponNotice(answer, copy, document.documentElement.lang || "ar", currency);
      say(notice.text, notice.tone);
      if (resume && answer.applied) form?.requestSubmit();
      else if (resume) input.focus();
    },
  };
}
