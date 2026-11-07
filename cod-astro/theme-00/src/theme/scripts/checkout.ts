/**
 * Checkout page controller.
 *
 * The basket lives in this browser, so the page arrives as a shell and this
 * fills it: lines from localStorage first so there is something to look at
 * immediately, then the server's verdict on prices, stock and offers.
 *
 * Delivery depends on where the shopper is choosing to be delivered on this
 * very page, so each change of wilaya, commune or delivery type asks the server
 * again: its answer carries the delivery quote, computed by the same function
 * that charges the order, and the fee and total shown are that quote. Until it
 * answers, the merchant's wilaya rate stands in.
 *
 * Nothing here is trusted for money. The server re-prices every line and
 * re-resolves delivery when the order is placed.
 */

import { embeddedMessage, embeddedTemplate } from "@/theme/content/messages";
import { toLocalAlgerianMobile } from "@wocart/storefront";
import { initCouponField } from "./coupon-field";
import {
  getCart,
  cartCount,
  cartSubtotal,
  lineKey,
  subscribe,
  isCartAvailable,
  toOrderItems,
} from "./cart";
import {
  createValidator,
  renderCartLine,
  renderCartRewards,
  validatedByKey,
  giftOfferIds,
  hasBlocker,
  renderFreeDelivery,
  moneyFormatter,
  bindLineControls,
  type ValidationResult,
} from "./cart-render";
import {
  bindDeliveryFields,
  watchShippingRates,
  rateFor,
  selectedWilayaId,
  currentDeliveryType,
  deliveryDestination,
  type ShippingRates,
} from "./delivery-fields";
import { storefrontTracking } from "@wocart/storefront";
import { collectCustomFieldAnswers } from "./custom-fields";
import { initRequiredSelects } from "./select-required";
import { onEachPage } from "@wocart/theme/lifecycle";

/** One controller per page, so a second call is a no-op rather than a duplicate. */
const controllers = new WeakMap<HTMLElement, () => void>();

export function initCheckout(): () => void {
  const noop = () => {};
  const root = document.getElementById("checkout-root");
  if (!root) return noop;

  const existing = controllers.get(root);
  if (existing) return existing;

  const loading = document.getElementById("checkout-loading");
  const emptyState = document.getElementById("checkout-empty");
  const main = document.getElementById("checkout-main");
  const list = document.getElementById("checkout-line-list");
  const template = document.getElementById("checkout-line-template") as HTMLTemplateElement | null;
  const rewardTemplate = document.getElementById("checkout-reward-template") as HTMLTemplateElement | null;
  const itemsLabel = document.getElementById("checkout-items-label");
  const blockedNote = document.getElementById("checkout-blocked-note");
  const subtotalEl = document.getElementById("checkout-subtotal");
  const couponRow = document.getElementById("checkout-coupon-row");
  const deliveryEl = document.getElementById("checkout-delivery");
  const totalEl = document.getElementById("checkout-total");
  const freeWrap = document.getElementById("checkout-free-delivery");
  const freeText = document.getElementById("checkout-free-delivery-text");
  const freeBar = document.getElementById("checkout-free-delivery-bar");
  const submitBtn = document.getElementById("submit-btn") as HTMLButtonElement | null;
  const form = document.getElementById("checkout-form") as HTMLFormElement | null;
  const itemsInput = document.getElementById("cart-items-input") as HTMLInputElement | null;
  // Present only when the merchant added custom fields; null otherwise, and
  // then there is nothing to serialise.
  const customFieldResponsesInput = document.getElementById(
    "custom-field-responses-input",
  ) as HTMLInputElement | null;

  if (!list || !template) return noop;

  const currency = root.dataset.currency ?? "";
  // Every string comes from the content pack via the markup. Nothing here
  // invents user-facing text; an absent key degrades to empty, never to a
  // hardcoded fallback in a language the shopper may not read.
  const copy = {
    items: root.dataset.copyItems ?? "",
    outOfStock: root.dataset.copyOutOfStock ?? "",
    unavailable: root.dataset.copyUnavailable ?? "",
    freeEarned: root.dataset.copyFreeEarned ?? "",
    freeRemaining: root.dataset.copyFreeRemaining ?? "",
    shippingCalculated: root.dataset.copyShippingCalculated ?? "",
    shippingFree: root.dataset.copyShippingFree ?? "",
    shippingUnavailable: root.dataset.copyShippingUnavailable ?? "",
  };

  const aborter = new AbortController();
  const { signal } = aborter;
  const money = moneyFormatter(currency);
  const validate = createValidator();
  const isRTL = document.documentElement.dir === "rtl";

  let validated: ValidationResult | null = null;
  /** The destination `validated` was quoted for: a quote answers only that one. */
  let quotedFor = "";
  /** The code box: Apply asks the quote again with the code. */
  const coupon = initCouponField(root, () => {
    render();
    void revalidate();
  });

  /** What the quote is asked about the code: the code applied, and the phone once it is a mobile number. */
  function couponAsk(): { couponCode?: string; phone?: string } {
    const code = coupon?.code();
    if (!code) return {};
    const phone = toLocalAlgerianMobile((document.getElementById("f-phone") as HTMLInputElement | null)?.value ?? "");
    return { couponCode: code, ...(phone ? { phone } : {}) };
  }
  let rates: ShippingRates = {};

  const destinationKey = () => JSON.stringify(deliveryDestination() ?? null);

  /**
   * The server's quote for the destination on screen; `null` when the store
   * does not deliver there. Without a quote for it, the wilaya rate stands in,
   * and NaN — no wilaya the merchant priced yet — shows as "calculated after
   * selecting wilaya" rather than as free.
   */
  function deliveryFee(): number | null {
    const quote = validated?.delivery;
    if (quote && quotedFor === destinationKey()) return quote.available ? quote.fee : null;
    if (validated?.freeDelivery.qualified) return 0;
    return rateFor(rates, selectedWilayaId(), currentDeliveryType());
  }

  function render(): void {
    const lines = getCart();
    if (loading) loading.hidden = true;

    const empty = lines.length === 0;
    if (emptyState) emptyState.hidden = !empty;
    if (main) main.hidden = empty;
    if (empty) {
      list!.replaceChildren();
      // Nothing in the basket, nothing to make progress towards.
      if (freeWrap) freeWrap.hidden = true;
      return;
    }

    if (itemsLabel) itemsLabel.textContent = embeddedMessage(copy.items, "cartItems", { count: cartCount(lines) });

    const byKey = validatedByKey(validated);
    const giftOffers = giftOfferIds(validated);
    list!.replaceChildren(
      ...lines.map((line) =>
        renderCartLine(template!, line, byKey.get(lineKey(line.productId, line.variantId)), copy, money, { giftOffers }),
      ),
      ...(rewardTemplate ? renderCartRewards(rewardTemplate, validated) : []),
    );

    const blocked = hasBlocker(validated);
    // The server's subtotal is net of the coupon; the lines show their price
    // before it, so the subtotal row shows the sum before it and the coupon row what came off.
    const subtotal = validated?.subtotal ?? cartSubtotal(lines);
    const applied = validated?.coupon?.applied ? validated.coupon : null;
    const couponOff = applied?.discount ?? 0;
    const delivery = deliveryFee();
    // The server refuses an order to a destination the store does not serve;
    // holding the button back says so before the shopper fills in the rest.
    const undeliverable = delivery === null;

    if (blockedNote) blockedNote.hidden = !blocked;
    if (submitBtn) submitBtn.disabled = blocked || undeliverable;

    if (subtotalEl) subtotalEl.textContent = money(subtotal + couponOff);
    if (couponRow) {
      couponRow.hidden = couponOff === 0;
      const label = couponRow.querySelector<HTMLElement>("[data-coupon-label]");
      const amount = couponRow.querySelector<HTMLElement>("[data-coupon-amount]");
      if (applied && label) label.textContent = embeddedTemplate(couponRow.dataset.labelTemplate ?? "{code}", { code: applied.code });
      if (amount) amount.textContent = `−${money(couponOff)}`;
    }
    if (deliveryEl) {
      deliveryEl.textContent =
        delivery === null
          ? copy.shippingUnavailable
          : Number.isNaN(delivery)
            ? copy.shippingCalculated
            : delivery === 0
              ? copy.shippingFree
              : money(delivery);
    }
    // An unknown or unavailable delivery fee adds nothing rather than guessing:
    // the shopper sees the basket total and why delivery is not in it.
    if (totalEl) {
      totalEl.textContent = money(subtotal + (delivery !== null && Number.isFinite(delivery) ? delivery : 0));
    }

    renderFreeDelivery(
      { wrap: freeWrap, text: freeText, bar: freeBar },
      validated,
      subtotal,
      { earned: copy.freeEarned, remaining: copy.freeRemaining },
      currency,
    );
  }

  async function revalidate(): Promise<void> {
    const destination = deliveryDestination();
    const key = JSON.stringify(destination ?? null);
    const result = await validate(getCart(), destination, couponAsk());
    // `undefined` means the answer is stale or the request failed — the
    // optimistic view stands rather than flickering to a worse one.
    if (result === undefined) return;
    validated = result;
    coupon?.show(result?.coupon ?? null);
    quotedFor = key;
    render();
  }

  // A browser blocking storage cannot hold a basket, so there is nothing to
  // check out. Say so with the empty state rather than an endless spinner.
  if (!isCartAvailable()) {
    if (loading) loading.hidden = true;
    if (emptyState) emptyState.hidden = false;
    if (main) main.hidden = true;
    const teardownEarly = () => controllers.delete(root);
    controllers.set(root, teardownEarly);
    return teardownEarly;
  }

  bindLineControls(list, () => {
    render();
    void revalidate();
  }, signal);

  const unbindDelivery = bindDeliveryFields(
    {
      communeLoading: root.dataset.copyCommuneLoading ?? "",
      communePlaceholder: root.dataset.copyCommunePlaceholder ?? "",
      communeDisabled: root.dataset.copyCommuneDisabled ?? "",
    },
    {
      isRTL,
      onChange: () => {
        render();
        void revalidate();
      },
    },
  );

  const unwatchRates = watchShippingRates((loaded) => {
    rates = loaded;
    render();
  });

  // ─── InitiateCheckout ──────────────────────────────────────────────────────
  //
  // Fires once, on the first real interaction with the form — the same rule
  // the product page uses: arriving on a checkout page is not starting
  // checkout, typing into it is. Without this the basket journey reported
  // nothing to Meta while product pages reported every one.
  const fireInitiateCheckout = () => {
    const lines = getCart();
    // Prefer the price the server stands behind; the optimistic subtotal is
    // only used if validation has not answered yet. Reported once per page.
    storefrontTracking().checkoutStarted({ lines, value: validated?.subtotal ?? cartSubtotal(lines) });
  };
  for (const event of ["focusin", "input", "change"] as const) {
    form?.addEventListener(event, fireInitiateCheckout, { signal });
  }

  // A code may depend on who the shopper is: ask again once the phone is known.
  document.getElementById("f-phone")?.addEventListener(
    "change",
    () => {
      if (coupon?.code()) void revalidate();
    },
    { signal },
  );

  // Serialised at submit time, not earlier: the shopper can still change the
  // basket from the summary above, and the order must equal what they see.
  form?.addEventListener(
    "submit",
    () => {
      if (itemsInput) itemsInput.value = JSON.stringify(toOrderItems());
      // The merchant's own questions, same rule: serialised at submit, so the
      // answers posted are the ones the shopper was looking at.
      if (customFieldResponsesInput) {
        customFieldResponsesInput.value = JSON.stringify(collectCustomFieldAnswers(form));
      }
    },
    { signal },
  );

  // Another tab — or the drawer on this page — changing the basket.
  const unsubscribe = subscribe(() => {
    validated = null;
    render();
    void revalidate();
  });

  render();
  void revalidate();

  // Wilaya, commune and any required dropdown the merchant added keep their
  // value in a hidden input, which the browser refuses to validate — so the
  // check is ours. See scripts/select-required.ts.
  const unbindRequiredSelects = initRequiredSelects();

  const teardown = () => {
    aborter.abort();
    unbindDelivery();
    unwatchRates();
    unsubscribe();
    unbindRequiredSelects();
    controllers.delete(root);
  };
  controllers.set(root, teardown);
  return teardown;
}

onEachPage(() => initCheckout());
