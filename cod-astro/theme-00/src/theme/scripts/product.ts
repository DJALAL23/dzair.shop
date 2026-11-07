/**
 * Product Page Logic
 * Handles variant selection, gallery interactions, offer tiers,
 * shipping calculations, and commune loading.
 */

import { embeddedMessage, embeddedTemplate } from "@/theme/content/messages";
import {
  bindDeliveryFields,
  watchShippingRates,
  rateFor,
  selectedWilayaId,
  currentDeliveryType,
  deliveryDestination,
  toggleAddressFields,
} from "./delivery-fields";
import { STOREFRONT_API_PATHS } from "@wocart/storefront";
import { initCouponField } from "./coupon-field";
import { storefrontTracking } from "@wocart/storefront";
import { initCustomFields } from "./custom-fields";
import { initRequiredSelects } from "./select-required";
// One money formatter for the whole theme — see utils/money.ts.
import { formatAmount, formatCurrency } from "../utils/money";
// The product page's one SSR→browser contract — see bridges/.
import { readProductPageData } from "../bridges/product-page-data";
import {
  createQuoter,
  getOfferTierView,
  initialVariant,
  optionStates,
  pickOption,
  toLocalAlgerianMobile,
  variantFor,
  type CartValidation,
  type OptionSelection,
  type ProductQuoteInput,
} from "@wocart/storefront";
import { onEachPage } from "@wocart/theme/lifecycle";

export function initProductPage(): () => void {
  // ── DATA BRIDGE ────────────────────────────────────────────────────────────
  // Server-computed values arrive on one hidden element; the contract (writer
  // and reader) lives in `theme/bridges/product-page-data.ts`.
  const data = readProductPageData();
  if (!data) return () => {};

  const variants = data.variants;
  const productId = data.productId;
  const productName = data.productName;
  
  /** @type {Record<string, Object>} Shipping rates per wilaya: { wilayaId: { home, stopDesk } } */
  let rates: Record<string, { home: number; stopDesk: number }> = {};

  // Localized strings and configuration. Labels come from the bridge and are
  // null when the markup did not carry them — the UI then keeps its
  // server-rendered text instead of inventing copy.
  const cur                = data.currencySymbol;
  const shippingCalc       = data.shippingCalculated ?? "";
  const shippingFree       = data.shippingFree ?? "";
  const shippingUnavailable = data.shippingUnavailable ?? shippingCalc;
  const communePlaceholder = data.communePlaceholder ?? "";
  const communeLoading     = data.communeLoading ?? "";
  const communeDisabled    = data.communeDisabled ?? "";
  const isRTL              = data.isRTL;
  const trackInventory     = data.trackInventory;
  const outOfStockLabel    = data.outOfStock;
  const qtyMaxStockLabel   = data.qtyMaxStock;
  const productInventory   = data.inventory || 100;

  const allOffers = data.offers;
  /** The product is priced by quantity tiers: what a quantity costs is the server's quote alone. */
  const quantityPriced = data.quantityPriced;

  // ── STATE ──────────────────────────────────────────────────────────────────
  /** What the option buttons choose between; the SDK's picker decides what a pick means. */
  const catalog = { variants, trackInventory, variantOptions: data.variantOptions };
  /** The values the option buttons show — always a variant that exists, the one ordered. */
  let selection: OptionSelection = initialVariant(catalog)?.variations ?? {};
  /** Each unit of an offer the shopper chose a variant for, by `offerId:unit`; the others follow `selection`. */
  const unitSelections = new Map<string, OptionSelection>();
  /** The chosen variant is sold out. */
  let mainOos = false;

  /** Current unit price based on selected variant */
  let currentPrice        = data.basePrice || 0;

  /** Current calculated shipping cost */
  let currentShipping     = NaN;
  /** The store does not deliver to the chosen destination. */
  let undeliverable       = false;
  /** Whether the selected variant combination is sold out. */
  let variantOos          = false;
  /** The server's answer for one destination and one form; a newer form never shows an older answer. */
  let quote: { key: string; answer: CartValidation } | null = null;
  const quoter = createQuoter({ endpoint: STOREFRONT_API_PATHS.cartValidate });
  /** The code box: Apply asks the quote again with the code. */
  const coupon = initCouponField(document, refreshShipping);

  /** Currently selected offer ID (if any) */
  let currentOfferId: string | null = null;

  /** Maximum quantity allowed by stock; 100 = uncapped */
  let currentVariantMax   = 100;
  let hasStockCap         = false;

  // ── DOM ELEMENTS ───────────────────────────────────────────────────────────
  const tierLabels = document.querySelectorAll<HTMLElement>(".tier-label");
  const qtyInput   = document.getElementById("qty-input") as HTMLInputElement | null;
  const offerIdInput = document.getElementById("offer-id-input") as HTMLInputElement | null;
  const variantSelectionsInput = document.getElementById("variant-selections-input") as HTMLInputElement | null;
  const priceInput = document.getElementById("price-input") as HTMLInputElement | null;
  const variantIdInput = document.getElementById("variant-id-input") as HTMLInputElement | null;
  const variantLabelInput = document.getElementById("variant-label-input") as HTMLInputElement | null;
  const gallery   = document.getElementById("gallery");
  const dots      = document.querySelectorAll<HTMLButtonElement>(".gallery-dot");
  const thumbs    = document.querySelectorAll<HTMLButtonElement>(".gallery-thumb");
  const submitBtn     = document.getElementById("submit-btn") as HTMLButtonElement | null;
  const submitLabel   = submitBtn?.textContent?.trim() ?? "";
  const qtyPlusBtn    = document.getElementById("qty-plus") as HTMLButtonElement | null;
  const qtyStockHint  = document.getElementById("qty-stock-hint") as HTMLParagraphElement | null;

  // ── OFFER TIER SELECTION ───────────────────────────────────────────────────
  
  /**
   * Updates UI and state when a user selects a specific offer tier.
   * @param {HTMLElement} label - The clicked tier label element.
   */
  function selectTier(label: HTMLElement) {
    // 1. Only the chosen tile is selected; the styling lives in the tile's class.
    tierLabels.forEach((l) => {
      l.classList.remove("is-selected");
      const r = l.querySelector<HTMLInputElement>("input[type=radio]");
      if (r) r.checked = false;
    });

    // 2. Mark the chosen tile
    label.classList.add("is-selected");
    const r = label.querySelector<HTMLInputElement>("input[type=radio]");
    if (r) r.checked = true;

    // 3. Update hidden form inputs and internal state
    const qty   = parseInt(label.dataset.qty || "1") || 1;
    const offId = label.dataset.offerId ?? "";
    if (qtyInput) qtyInput.value = String(qty);
    currentOfferId = offId || null;

    if (offerIdInput) offerIdInput.value = offId;

    // 4. Manage visibility of variant selectors (base tier + offer tiers)
    tierLabels.forEach((l) => {
      const id = l.dataset.offerId ?? "";
      const sectionId = id ? `tier-variants-${id}` : "tier-variants-base";
      document.getElementById(sectionId)?.classList.add("hidden");
    });
    const activeSectionId = offId ? `tier-variants-${offId}` : "tier-variants-base";
    document.getElementById(activeSectionId)?.classList.remove("hidden");

    // 5. The delivery for the new tier is the server's to answer.
    if (currentOfferId) paintUnits(currentOfferId);
    updateVariantSelectionsInput();
    refreshShipping();
  }

  // Attach listeners to tier cards
  tierLabels.forEach((l) => l.addEventListener("click", () => selectTier(l)));

  /**
   * Updates price labels within the tier cards when base price changes.
   */
  function updateTierPrices() {
    const basePriceEl = document.getElementById("tier-price-base");
    if (basePriceEl) {
      basePriceEl.innerHTML = `${formatAmount(currentPrice)}&nbsp;<span style="font-size:.5625rem;font-weight:900">${cur}</span>`;
    }
    for (const offer of allOffers) {
      const priceEl = document.getElementById(`tier-price-${offer.id}`);
      if (priceEl) {
        priceEl.innerHTML = `${formatAmount(getOfferTierView(offer, currentPrice, null).price)}&nbsp;<span style="font-size:.5625rem;font-weight:900">${cur}</span>`;
      }
    }
  }

  /**
   * Shows or hides offers based on whether they apply to the currently selected product variant.
   */
  function updateTierVisibility() {
    const vid = variantIdInput?.value || null;
    for (const offer of allOffers) {
      const card = document.getElementById(`tier-card-${offer.id}`);
      if (!card) continue;
      
      const applies = !offer.triggerVariantId || offer.triggerVariantId === vid;
      if (applies) {
        card.classList.remove("hidden");
      } else {
        card.classList.add("hidden");
        // Fallback to base tier if current offer becomes invalid
        if (currentOfferId === offer.id) {
          const base = document.getElementById("tier-card-base");
          if (base) selectTier(base);
        }
      }
    }
  }

  // ── VARIANT SELECTIONS ─────────────────────────────────────────────────────

  /** Marks each button's value chosen or not, and its state for the other choices. */
  function paintOptions(buttons: Iterable<HTMLButtonElement>, chosen: OptionSelection) {
    const states = optionStates(catalog, chosen);
    for (const btn of buttons) {
      const option = btn.dataset.option ?? "";
      const value = btn.dataset.value ?? "";
      const selected = chosen[option] === value;
      btn.classList.toggle("is-selected", selected);
      btn.setAttribute("aria-pressed", String(selected));
      btn.dataset.state = states[option]?.[value] ?? "unavailable";
    }
  }

  /**
   * The values one unit of an offer is ordered in: the shopper's pick for it,
   * else the page's. An offer locked to a variant is only offered while the
   * page shows that variant, and its buttons cannot be picked.
   */
  function unitSelection(offerId: string, unit: number): OptionSelection {
    return unitSelections.get(`${offerId}:${unit}`) ?? selection;
  }

  function unitCount(offerId: string): number {
    return parseInt(document.getElementById(`tier-card-${offerId}`)?.dataset.qty || "1") || 1;
  }

  function paintUnits(offerId: string) {
    for (let unit = 0; unit < unitCount(offerId); unit++) {
      paintOptions(document.querySelectorAll<HTMLButtonElement>(`.tier-unit-opt[data-tier-id="${offerId}"][data-unit="${unit}"]`), unitSelection(offerId, unit));
    }
  }

  /** One variant per unit of the chosen offer — every unit, each a variant that exists. */
  function updateVariantSelectionsInput() {
    const units = currentOfferId ? unitVariants(currentOfferId) : [];
    if (variantSelectionsInput) {
      variantSelectionsInput.value = JSON.stringify(units.map((variant) => ({ variantId: variant.id, variantLabel: Object.values(variant.variations).join(" / ") })));
    }
    setVariantOosState(mainOos || (trackInventory && units.some((variant) => variant.inventory === 0)));
  }

  function unitVariants(offerId: string) {
    const out: (typeof variants)[number][] = [];
    for (let unit = 0; unit < unitCount(offerId); unit++) {
      const variant = variantFor(variants, unitSelection(offerId, unit));
      if (variant) out.push(variant);
    }
    return out;
  }

  // Per-unit option buttons of an offer: each unit moves like the page's own buttons.
  document.querySelectorAll<HTMLButtonElement>(".tier-unit-opt").forEach((btn) => {
    btn.addEventListener("click", () => {
      const offerId = btn.dataset.tierId ?? "";
      const unit = Number(btn.dataset.unit);
      const picked = pickOption(catalog, unitSelection(offerId, unit), btn.dataset.option ?? "", btn.dataset.value ?? "");
      if (!picked.variant) return;
      unitSelections.set(`${offerId}:${unit}`, picked.selection);
      paintUnits(offerId);
      updateVariantSelectionsInput();
      refreshShipping();
    });
  });

  // ── PRICE & SUMMARY UI ─────────────────────────────────────────────────────

  /**
   * Refreshes all price-related text in the UI (product price, summary rows, total).
   */
  function updatePriceUI() {
    const qty = Math.max(1, parseInt(qtyInput?.value || "1") || 1);
    // The server's subtotal for exactly this form when it has answered; the
    // catalog price meanwhile — except under quantity pricing, whose total is
    // only ever the server's, so it waits for the answer. The subtotal is net
    // of the coupon: the item row shows it before, the coupon row what came off.
    const answer = quote?.key === shippingKey() ? quote.answer : undefined;
    const couponOff = answer?.coupon?.applied ? answer.coupon.discount : 0;
    const itemTotal: number | null = answer?.subtotal ?? (quantityPriced ? null : currentPrice * qty);
    syncQuantityTiers(qty);
    syncCouponRow(answer?.coupon?.applied ? answer.coupon : null);

    // 1. Update main price displays
    document.querySelectorAll<HTMLElement>("#price-display-desktop, #price-display-mobile").forEach((el) => {
      el.innerHTML = `${formatAmount(currentPrice)}&nbsp;<span style="font-size:.6em;font-weight:700">${cur}</span>`;
    });
    // The sticky bar is the order in short: what the chosen quantity, offer
    // and code cost, as the summary says it — never the price of one piece.
    // Under quantity pricing it keeps its figure until the server answers.
    const stickyPrice = document.getElementById("sticky-price");
    if (stickyPrice && itemTotal !== null) {
      stickyPrice.innerHTML = `${formatAmount(itemTotal)}<span class="price-cur">${cur}</span>`;
    }

    // 2. Update order summary rows
    const summaryItemPrice = document.getElementById("summary-item-price");
    if (summaryItemPrice) summaryItemPrice.textContent = itemTotal === null ? "…" : formatCurrency(itemTotal + couponOff, cur);
    
    const summaryQtyLabel = document.getElementById("summary-qty-label");
    if (summaryQtyLabel) summaryQtyLabel.textContent = `${qty} ×`;

    const shippingEl = document.getElementById("summary-shipping");
    const totalEl    = document.getElementById("summary-total");

    // 3. Handle shipping logic in summary
    if (shippingEl && totalEl && itemTotal === null) {
      totalEl.textContent = "…";
    } else if (shippingEl && totalEl && itemTotal !== null) {
      if (undeliverable) {
        shippingEl.textContent = shippingUnavailable;
        totalEl.textContent = formatCurrency(itemTotal, cur);
      } else if (isNaN(currentShipping)) {
        shippingEl.textContent = shippingCalc;
        totalEl.textContent = formatCurrency(itemTotal, cur);
      } else if (currentShipping === 0) {
        shippingEl.textContent = shippingFree;
        totalEl.textContent = formatCurrency(itemTotal, cur);
      } else {
        shippingEl.textContent = formatCurrency(currentShipping, cur);
        totalEl.textContent = formatCurrency(itemTotal + currentShipping, cur);
      }
    }

    // 4. Show/hide relevant offer summary rows
    for (const offer of allOffers) {
      const row = document.getElementById(`offer-row-${offer.id}`);
      if (!row) continue;
      if (offer.id === currentOfferId) row.classList.remove("hidden");
      else row.classList.add("hidden");
    }
  }

  /** The summary's coupon row: the code applied and what it took off, hidden otherwise. */
  function syncCouponRow(applied: { code: string; discount: number } | null) {
    const row = document.getElementById("summary-coupon-row");
    if (!row) return;
    row.hidden = !applied || applied.discount === 0;
    if (!applied || row.hidden) return;
    const label = row.querySelector<HTMLElement>("[data-coupon-label]");
    const amount = row.querySelector<HTMLElement>("[data-coupon-amount]");
    if (label) label.textContent = embeddedTemplate(row.dataset.labelTemplate ?? "{code}", { code: applied.code });
    if (amount) amount.textContent = `−${formatCurrency(applied.discount, cur)}`;
  }

  // ── VARIANT OPTION CLICKS ──────────────────────────────────────────────────

  /**
   * The page's option buttons. A pick moves the selection to the variant it
   * means — never to a combination that is not made — and a sold-out value can
   * still be chosen, the order button then saying so.
   */
  const variantButtons = document.querySelectorAll<HTMLButtonElement>(".variant-opt");
  variantButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const picked = pickOption(catalog, selection, btn.dataset.option ?? "", btn.dataset.value ?? "");
      if (!picked.variant) return;
      selection = picked.selection;
      updateVariant();
    });
  });

  /**
   * Toggles the submit button between normal and out-of-stock states.
   * Called whenever the selected variant combination changes.
   */
  function setVariantOosState(oos: boolean) {
    if (!submitBtn) return;
    variantOos = oos;
    syncSubmit();
    submitBtn.style.background = oos ? "var(--clr-disabled)" : "";
    submitBtn.style.cursor     = oos ? "not-allowed" : "";
    // A null label means the markup did not carry one: keep the server-rendered
    // text instead of inventing copy in the script.
    if (!oos) submitBtn.textContent = submitLabel;
    else if (outOfStockLabel != null) submitBtn.textContent = outOfStockLabel;
  }

  /** The order is held back while the variant is sold out or the store does not deliver there. */
  function syncSubmit() {
    if (submitBtn) submitBtn.disabled = variantOos || undeliverable;
  }

  /**
   * Disables the + button and shows a stock-limit hint when qty reaches the cap.
   */
  function updateQtyState() {
    if (!qtyInput) return;
    const qty = parseInt(qtyInput.value) || 1;
    const atMax = hasStockCap && qty >= currentVariantMax;

    if (qtyPlusBtn) {
      qtyPlusBtn.disabled = atMax;
      qtyPlusBtn.style.opacity = atMax ? "0.4" : "";
      qtyPlusBtn.style.cursor  = atMax ? "not-allowed" : "";
    }

    if (qtyStockHint) {
      if (atMax && qtyMaxStockLabel != null) {
        qtyStockHint.textContent = embeddedMessage(qtyMaxStockLabel, "qtyMaxStock", { count: currentVariantMax });
        qtyStockHint.classList.remove("hidden");
      } else {
        qtyStockHint.classList.add("hidden");
      }
    }
  }

  /** Shows the selected variant: its buttons, price, stock and photo; the offer units that follow it. */
  function updateVariant() {
    paintOptions(variantButtons, selection);
    const match = variantFor(variants, selection);
    if (!match) return;

    currentPrice = match.price;
    if (priceInput) priceInput.value = String(match.price);
    if (variantIdInput) variantIdInput.value = match.id;
    if (variantLabelInput) {
      variantLabelInput.value = Object.values(match.variations).join(" / ");
    }

    mainOos = trackInventory && match.inventory === 0;

    // Stock cap: prevent qty from exceeding available inventory
    if (trackInventory && match.inventory > 0) {
      currentVariantMax = match.inventory;
      hasStockCap = true;
    } else {
      currentVariantMax = 100;
      hasStockCap = false;
    }
    if (qtyInput) {
      qtyInput.max = String(currentVariantMax);
      const curQty = parseInt(qtyInput.value) || 1;
      if (curQty > currentVariantMax) qtyInput.value = String(fittingQuantity(currentVariantMax));
    }
    updateQtyState();

    // Jump gallery to the variant's assigned image (if any)
    if (match.imageId && gallery) {
      const slide = gallery.querySelector<HTMLElement>(`[data-image-id="${match.imageId}"]`);
      if (slide) {
        const index = Array.from(gallery.children).indexOf(slide);
        if (index >= 0) goToImage(index);
      }
    }

    // Refresh dependent UI
    if (tierLabels.length > 0) {
      updateTierPrices();
      updateTierVisibility();
    }
    if (currentOfferId) paintUnits(currentOfferId);
    updateVariantSelectionsInput();
    updatePriceUI();
    // The threshold and the offers read the price, so the delivery moves with it.
    refreshShipping();
  }

  // ── QUANTITY TIERS ─────────────────────────────────────────────────────────

  const quantityTierTiles = document.querySelectorAll<HTMLButtonElement>(".qty-tier");

  /** The most the stock allows: where tiles choose the quantity, the largest tile it can fill. */
  function fittingQuantity(max: number): number {
    if (quantityTierTiles.length === 0) return max;
    const fitting = [...quantityTierTiles].map((tile) => Number(tile.dataset.qty)).filter((qty) => qty <= max);
    return fitting.length ? Math.max(...fitting) : 1;
  }

  /**
   * Marks the tile whose quantity is the one ordered — a display match, never
   * a price — and takes out the tiles the stock cannot fill: all of them when
   * the product or chosen variant is sold out.
   */
  function syncQuantityTiers(qty: number) {
    quantityTierTiles.forEach((tile) => {
      const tileQty = Number(tile.dataset.qty);
      const chosen = tileQty === qty;
      tile.setAttribute("aria-checked", String(chosen));
      tile.classList.toggle("is-selected", chosen);
      tile.disabled = mainOos || (hasStockCap && tileQty > currentVariantMax);
    });
  }

  quantityTierTiles.forEach((tile) =>
    tile.addEventListener("click", () => {
      if (!qtyInput || tile.disabled) return;
      qtyInput.value = String(Number(tile.dataset.qty) || 1);
      refreshShipping();
      updateQtyState();
    }),
  );

  // ── QUANTITY STEPPER ───────────────────────────────────────────────────────
  
  document.getElementById("qty-minus")?.addEventListener("click", () => {
    if (!qtyInput) return;
    const v = Math.max(1, parseInt(qtyInput.value) || 1);
    if (v > 1) { qtyInput.value = String(v - 1); refreshShipping(); updateQtyState(); }
  });

  document.getElementById("qty-plus")?.addEventListener("click", () => {
    if (!qtyInput) return;
    const v = Math.max(1, parseInt(qtyInput.value) || 1);
    if (v < currentVariantMax) { qtyInput.value = String(v + 1); refreshShipping(); updateQtyState(); }
  });

  qtyInput?.addEventListener("input", () => {
    if (!qtyInput) return;
    const max = currentVariantMax;
    let v = parseInt(qtyInput.value) || 1;
    if (v > max) { v = max; qtyInput.value = String(max); }
    if (v < 1)   { v = 1;   qtyInput.value = "1"; }
    refreshShipping();
    updateQtyState();
  });

  // ── DELIVERY & SHIPPING ────────────────────────────────────────────────────

  // Rates ride in on the shipping bridge, which can already be in the DOM at
  // mount. This subscription lives here — after every piece of state
  // `refreshShipping` touches — so the callback, whenever it fires, never
  // meets an uninitialized binding. (Historical note: registering this at the
  // top of initProductPage delivered rates synchronously into a TDZ
  // ReferenceError that killed the page's whole init, commune selector
  // included.)
  watchShippingRates((loaded) => {
    rates = loaded;
    refreshShipping();
  });

  // Delivery type, the address field and commune loading are shared with
  // the checkout page so the two cannot drift apart — see delivery-fields.ts.
  bindDeliveryFields(
    { communeLoading, communePlaceholder, communeDisabled },
    { isRTL, onChange: refreshShipping },
  );

  /**
   * The product's order form as the order will read it: the same fields, and
   * no others. The quote is built from these, so it prices what would be ordered.
   */
  function productFormBody(): ProductQuoteInput {
    const body: ProductQuoteInput = {
      productId,
      productName,
      quantity: Math.max(1, parseInt(qtyInput?.value || "1") || 1),
    };
    if (variantIdInput?.value) body.variantId = variantIdInput.value;
    if (variantLabelInput?.value) body.variantLabel = variantLabelInput.value;
    if (offerIdInput?.value) body.offerId = offerIdInput.value;
    try {
      const selections: unknown = JSON.parse(variantSelectionsInput?.value || "[]");
      if (Array.isArray(selections) && selections.length > 0) body.variantSelections = selections;
    } catch {
      // A malformed hidden field posts no selections, as the form itself would.
    }
    return body;
  }

  /** What the quote depends on: the destination and the form. */
  /**
   * What the quote is asked about the code: the code applied, and the phone
   * once it is a mobile number — so a coupon for selected customers, or one use
   * per customer, is judged before the order.
   */
  function couponAsk(): { couponCode?: string; phone?: string } {
    const code = coupon?.code();
    if (!code) return {};
    const phone = toLocalAlgerianMobile((document.getElementById("f-phone") as HTMLInputElement | null)?.value ?? "");
    return { couponCode: code, ...(phone ? { phone } : {}) };
  }

  function shippingKey(): string {
    return JSON.stringify({ destination: deliveryDestination() ?? null, form: productFormBody(), coupon: couponAsk() });
  }

  /** Shows the server's answer. Without a destination yet, the rate table prices delivery. */
  function applyQuote(answer: CartValidation): void {
    coupon?.show(answer.coupon);
    const delivery = answer.delivery;
    if (delivery === undefined) {
      undeliverable = false;
      currentShipping = rateFor(rates, selectedWilayaId(), currentDeliveryType());
    } else {
      undeliverable = delivery.available === false;
      currentShipping = delivery.available === true ? delivery.fee : NaN;
    }
    syncSubmit();
    updatePriceUI();
  }

  async function requestQuote(key: string): Promise<void> {
    const destination = deliveryDestination();
    const result = await quoter.quote(productFormBody(), { ...(destination ? { destination } : {}), ...couponAsk() });
    // Stale or failed: keep what is shown. A key that has moved on: the shopper
    // changed the form or the destination while this was on its way.
    if (result.status !== "fresh" || key !== shippingKey()) return;
    quote = { key, answer: result.quote };
    applyQuote(result.quote);
  }

  /**
   * Recalculates the delivery for the destination and form on screen: the
   * server's quote when it has answered for them, the rate table until then.
   */
  function refreshShipping() {
    // 1. The server's quote for exactly this destination and form.
    const key = shippingKey();
    if (quote?.key === key) {
      applyQuote(quote.answer);
      return;
    }

    // 2. Until it answers, the merchant's rate table stands in.
    undeliverable = false;
    currentShipping = rateFor(rates, selectedWilayaId(), currentDeliveryType());
    syncSubmit();
    updatePriceUI();
    void requestQuote(key);
  }


  // ── GALLERY INTERACTIVITY ──────────────────────────────────────────────────

  /**
   * Slide offset for an index, signed for the track's writing direction.
   *
   * Every slide is exactly one track wide, so the offset is a multiple of the
   * width. In RTL the scroll origin is the right edge and `scrollLeft` runs
   * negative, so reading takes the magnitude and writing takes the sign back.
   */
  function slideSign(track: HTMLElement): number {
    return getComputedStyle(track).direction === "rtl" ? -1 : 1;
  }

  /**
   * Updates the visual indicators for the image at `i`.
   *
   * A dot's button is a 44px tap target; the dot the shopper sees is the span
   * inside it, so the active styling belongs there — styling the button would
   * shrink the tap target and leave the dot itself unchanged.
   */
  function setActive(i: number) {
    dots.forEach((d, j) => {
      d.firstElementChild?.classList.toggle("is-active", j === i);
    });
    thumbs.forEach((t, j) => t.classList.toggle("is-active", j === i));
  }

  /** Scrolls the track to image `i` and marks it active. */
  function goToImage(i: number) {
    if (!gallery) return;
    gallery.scrollTo({
      left: slideSign(gallery) * i * gallery.clientWidth,
      behavior: "smooth",
    });
    setActive(i);
  }

  // Scroll tracking, read once per frame: the scroll event fires far more
  // often than the indicators can meaningfully change.
  let galleryFrame = 0;
  gallery?.addEventListener("scroll", () => {
    if (galleryFrame) return;
    galleryFrame = requestAnimationFrame(() => {
      galleryFrame = 0;
      const width = gallery.clientWidth;
      if (width > 0) setActive(Math.round(Math.abs(gallery.scrollLeft) / width));
    });
  }, { passive: true });

  // Dots (mobile) and thumbnails (desktop) both jump to their image.
  [...dots, ...thumbs].forEach((btn) => {
    btn.addEventListener("click", () => {
      const i = Number(btn.dataset.index);
      if (Number.isInteger(i)) goToImage(i);
    });
  });

  // ── SUBMIT GUARD ───────────────────────────────────────────────────────────
  const form = document.querySelector<HTMLFormElement>("form[method='POST']");
  form?.addEventListener("submit", () => {
    if (submitBtn) submitBtn.disabled = true;
  });

  // The merchant's own questions, serialised into the one hidden JSON input the
  // platform action whitelists. No-op for a store with no custom fields.
  const unbindCustomFields = initCustomFields(form);

  // A required dropdown cannot rely on the browser: its value lives in a hidden
  // input, which is barred from constraint validation. Bound on document in the
  // capture phase, so it runs before the submit guard above — a blocked submit
  // must never leave the confirm button disabled.
  const unbindRequiredSelects = initRequiredSelects();

  // ── ALGERIAN PHONE VALIDATION ──────────────────────────────────────────────
  // Normalizes to the canonical local form "05XXXXXXXX" on blur and blocks
  // submit with a localized message for anything that is not an Algerian
  // mobile. The server re-validates (storeOrderSchema) — this is UX, not the
  // enforcement point.
  const phoneInput = document.getElementById("f-phone") as HTMLInputElement | null;
  // A missing label still marks the field invalid: a single space keeps the
  // constraint broken and lets the browser show its own localized message.
  const phoneInvalidMsg = data.phoneInvalid ?? " ";

  if (phoneInput) {
    phoneInput.addEventListener("blur", () => {
      if (!phoneInput.value.trim()) {
        phoneInput.setCustomValidity("");
        return;
      }
      // The normalization/validation rule is the SDK's — one phone rule for the
      // form, the abandonment tracker and the OTP transport.
      const normalized = toLocalAlgerianMobile(phoneInput.value);
      if (normalized) {
        phoneInput.value = normalized;
        phoneInput.setCustomValidity("");
      } else {
        phoneInput.setCustomValidity(phoneInvalidMsg);
        phoneInput.reportValidity();
      }
    });
    phoneInput.addEventListener("input", () => {
      phoneInput.setCustomValidity("");
    });
    // A code may depend on who the shopper is: ask again once the phone is known.
    phoneInput.addEventListener("change", () => {
      if (coupon?.code()) refreshShipping();
    });
  }

  // ── FINAL INITIALIZATION ───────────────────────────────────────────────────
  // Show the default active tier's variant section (base tier is always default)
  if (tierLabels.length > 0) {
    document.getElementById("tier-variants-base")?.classList.remove("hidden");
  }
  // Run variant OOS check for the pre-selected default combination
  if (variants.length > 0) {
    updateVariant();
  } else {
    // Simple product — apply stock cap from product-level inventory
    mainOos = trackInventory && data.inventory <= 0;
    setVariantOosState(mainOos);
    if (trackInventory && productInventory > 0) {
      currentVariantMax = productInventory;
      hasStockCap = true;
      if (qtyInput) qtyInput.max = String(productInventory);
    }
    updatePriceUI();
    updateQtyState();
  }
  
  // Initialize address fields visibility based on default delivery type (home)
  toggleAddressFields();

  // ── TRACKING ──────────────────────────────────────────────────────────────
  // The page's pixel is the head's (trackingHead); a page with none reports nothing.
  const tracking = storefrontTracking();

  function getCookie(name: string): string | null {
    return (
      document.cookie
        .split("; ")
        .find((r) => r.startsWith(name + "="))
        ?.split("=")[1] ?? null
    );
  }

  // 1. The product was seen, at the price shown.
  tracking.productViewed({ productId, price: currentPrice });

  // 2. Checking out began: the first focus, keystroke or selection inside the
  //    order form — seeing the form is not starting checkout. Reported once.
  const orderSection = document.getElementById("order-section");
  if (orderSection) {
    const fireCheckoutStarted = () => {
      tracking.checkoutStarted({ lines: [{ productId, quantity: 1, unitPrice: currentPrice }], value: currentPrice });
      orderSection.removeEventListener("focusin", fireCheckoutStarted);
      orderSection.removeEventListener("input", fireCheckoutStarted);
      orderSection.removeEventListener("change", fireCheckoutStarted);
    };
    orderSection.addEventListener("focusin", fireCheckoutStarted);
    orderSection.addEventListener("input", fireCheckoutStarted);
    orderSection.addEventListener("change", fireCheckoutStarted);
  }

  // 3. Populate fbc/fbp hidden inputs right before form submits so the values
  //    travel with the order payload to cod-server for CAPI attribution.
  const orderForm = document.querySelector<HTMLFormElement>("form[method=POST]");
  const fbcInput = document.getElementById("fbc-input") as HTMLInputElement | null;
  const fbpInput = document.getElementById("fbp-input") as HTMLInputElement | null;
  if (orderForm && (fbcInput || fbpInput)) {
    orderForm.addEventListener("submit", () => {
      if (fbcInput) fbcInput.value = getCookie("_fbc") ?? "";
      if (fbpInput) fbpInput.value = getCookie("_fbp") ?? "";
    });
  }

  return () => {
    unbindCustomFields();
    unbindRequiredSelects();
  };
}

onEachPage(initProductPage);
