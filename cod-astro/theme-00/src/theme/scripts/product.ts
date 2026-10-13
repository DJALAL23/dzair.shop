/**
 * Product Page Logic
 * Handles variant selection, gallery interactions, offer tiers,
 * shipping calculations, and commune loading.
 */

import { embeddedMessage } from "@/theme/content/messages";
import {
  bindDeliveryFields,
  watchShippingRates,
  rateFor,
  selectedWilayaId,
  currentDeliveryType,
  toggleAddressFields,
} from "./delivery-fields";
// fbq only exists when the merchant configured a pixel — one shared guard.
import { trackProductInitiateCheckout, trackViewContent } from "./pixel";
import { initCustomFields } from "./custom-fields";
import { initRequiredSelects } from "./select-required";
// One money formatter for the whole theme — see utils/money.ts.
import { formatAmount } from "../utils/money";
// The product page's one SSR→browser contract — see bridges/.
import { readProductPageData } from "../bridges/product-page-data";
import { getOfferTierView, toLocalAlgerianMobile } from "@wocart/storefront";
import { onEachPage } from "./page-lifecycle";

export function initProductPage(): () => void {
  // ── DATA BRIDGE ────────────────────────────────────────────────────────────
  // Server-computed values arrive on one hidden element; the contract (writer
  // and reader) lives in `theme/bridges/product-page-data.ts`.
  const data = readProductPageData();
  if (!data) return () => {};

  const variants = data.variants;
  
  /** @type {Record<string, Object>} Shipping rates per wilaya: { wilayaId: { home, stopDesk } } */
  let rates: Record<string, { home: number; stopDesk: number }> = {};

  // Localized strings and configuration. Labels come from the bridge and are
  // null when the markup did not carry them — the UI then keeps its
  // server-rendered text instead of inventing copy.
  const cur                = data.currencySymbol;
  const shippingCalc       = data.shippingCalculated ?? "";
  const shippingFree       = data.shippingFree ?? "";
  const communePlaceholder = data.communePlaceholder ?? "";
  const communeLoading     = data.communeLoading ?? "";
  const communeDisabled    = data.communeDisabled ?? "";
  const isRTL              = data.isRTL;
  const trackInventory     = data.trackInventory;
  const outOfStockLabel    = data.outOfStock;
  const qtyMaxStockLabel   = data.qtyMaxStock;
  const productInventory   = data.inventory || 100;

  const allOffers = data.offers;

  // ── STATE ──────────────────────────────────────────────────────────────────
  /** Tracks selected values for each variant option (e.g., { "Color": "Red" }) */
  const selectedOpts: Record<string, string> = {};

  /** Current unit price based on selected variant */
  let currentPrice        = data.basePrice || 0;

  /** Current calculated shipping cost */
  let currentShipping     = NaN;

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

    // 5. Handle special offer types (e.g. Free Shipping)
    const selOffer = allOffers.find(o => o.id === offId);
    if (selOffer?.discountType === "free_shipping") {
      currentShipping = 0;
      updateVariantSelectionsInput();
      updatePriceUI();
    } else {
      updateVariantSelectionsInput();
      refreshShipping(); // Recalculate based on wilaya
    }
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

  /**
   * Reads active `.tier-unit-opt` pill buttons for the current offer and builds
   * the variantSelections JSON. No select elements — purely data-active driven.
   */
  function updateVariantSelectionsInput() {
    if (!variantSelectionsInput) return;
    if (!currentOfferId) { variantSelectionsInput.value = "[]"; return; }

    const tierCard = document.getElementById(`tier-card-${currentOfferId}`);
    const unitCount = tierCard ? (parseInt(tierCard.dataset.qty || "1") || 1) : 1;

    const selections: Array<{ variantId: string; variantLabel: string }> = [];
    for (let i = 0; i < unitCount; i++) {
      const selectedValues: Record<string, string> = {};
      document.querySelectorAll<HTMLButtonElement>(
        `.tier-unit-opt[data-tier-id="${currentOfferId}"][data-unit="${i}"][data-active="1"]`
      ).forEach(btn => {
        selectedValues[btn.dataset.option!] = btn.dataset.value!;
      });

      if (Object.keys(selectedValues).length === 0) continue;

      const match = variants.find(v =>
        Object.entries(v.variations as Record<string, string>)
          .every(([k, val]) => selectedValues[k] === val)
      );
      if (match) {
        selections.push({
          variantId: match.id,
          variantLabel: Object.values(match.variations as Record<string, string>).join(" / "),
        });
      }
    }

    variantSelectionsInput.value = selections.length > 0 ? JSON.stringify(selections) : "[]";
  }

  // Per-unit variant pill buttons inside offer tier cards
  document.querySelectorAll<HTMLButtonElement>(".tier-unit-opt").forEach((btn) => {
    btn.addEventListener("click", () => {
      const { tierId, unit, option } = btn.dataset;
      // Deactivate siblings in the same option group, then activate the clicked pill
      document.querySelectorAll<HTMLButtonElement>(
        `.tier-unit-opt[data-tier-id="${tierId}"][data-unit="${unit}"][data-option="${option}"]`
      ).forEach(b => {
        b.dataset.active = "0";
        b.classList.remove("is-selected");
      });
      btn.dataset.active = "1";
      btn.classList.add("is-selected");
      updateVariantSelectionsInput();
    });
  });

  // ── PRICE & SUMMARY UI ─────────────────────────────────────────────────────

  /**
   * Refreshes all price-related text in the UI (product price, summary rows, total).
   */
  function updatePriceUI() {
    const qty = Math.max(1, parseInt(qtyInput?.value || "1") || 1);
    const itemTotal = currentPrice * qty;

    // 1. Update main price displays
    document.querySelectorAll<HTMLElement>("#price-display-desktop, #price-display-mobile, #sticky-price").forEach((el) => {
      el.innerHTML = `${formatAmount(currentPrice)} <span style="font-size:.6em;font-weight:700"> ${cur}</span>`;
    });

    // 2. Update order summary rows
    const summaryItemPrice = document.getElementById("summary-item-price");
    if (summaryItemPrice) summaryItemPrice.textContent = `${formatAmount(itemTotal)} ${cur}`;
    
    const summaryQtyLabel = document.getElementById("summary-qty-label");
    if (summaryQtyLabel) summaryQtyLabel.textContent = `${qty} ×`;

    const shippingEl = document.getElementById("summary-shipping");
    const totalEl    = document.getElementById("summary-total");

    // 3. Handle shipping logic in summary
    if (shippingEl && totalEl) {
      if (isNaN(currentShipping)) {
        shippingEl.textContent = shippingCalc;
        totalEl.textContent = `${formatAmount(itemTotal)} ${cur}`;
      } else if (currentShipping === 0) {
        shippingEl.textContent = shippingFree;
        totalEl.textContent = `${formatAmount(itemTotal)} ${cur}`;
      } else {
        shippingEl.textContent = `${formatAmount(currentShipping)} ${cur}`;
        totalEl.textContent = `${formatAmount(itemTotal + currentShipping)} ${cur}`;
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

  // ── VARIANT OPTION CLICKS ──────────────────────────────────────────────────

  /**
   * Attach listeners to "pill" style variant buttons (Size, Color, etc.)
   */
  document.querySelectorAll<HTMLButtonElement>(".variant-opt").forEach((btn) => {
    // Initialize default selections
    if (btn.dataset.first === "1") {
      selectVariantBtn(btn);
      selectedOpts[btn.dataset.option!] = btn.dataset.value!;
    }

    btn.addEventListener("click", () => {
      if (btn.dataset.oos === "1") return; // ignore out-of-stock pills
      const opt = btn.dataset.option!;
      selectedOpts[opt] = btn.dataset.value!;
      selectVariantBtn(btn);
      updateVariant();
    });
  });

  /** Marks one option of its group as chosen; the group's other options are cleared. */
  function selectVariantBtn(btn: HTMLButtonElement) {
    document.querySelectorAll<HTMLButtonElement>(`.variant-opt[data-option="${btn.dataset.option}"]`).forEach((b) => {
      b.classList.remove("is-selected");
    });
    btn.classList.add("is-selected");
  }

  /**
   * Toggles the submit button between normal and out-of-stock states.
   * Called whenever the selected variant combination changes.
   */
  function setVariantOosState(oos: boolean) {
    if (!submitBtn) return;
    submitBtn.disabled = oos;
    submitBtn.style.background = oos ? "var(--clr-disabled)" : "";
    submitBtn.style.cursor     = oos ? "not-allowed" : "";
    // A null label means the markup did not carry one: keep the server-rendered
    // text instead of inventing copy in the script.
    if (!oos) submitBtn.textContent = submitLabel;
    else if (outOfStockLabel != null) submitBtn.textContent = outOfStockLabel;
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

  /**
   * Finds the variant object matching all selected options and updates price/state.
   */
  function updateVariant() {
    const match = variants.find((v) =>
      Object.entries(v.variations).every(([k, val]) => selectedOpts[k] === val)
    );
    if (!match) return;

    currentPrice = match.price;
    if (priceInput) priceInput.value = String(match.price);
    if (variantIdInput) variantIdInput.value = match.id;
    if (variantLabelInput) {
      variantLabelInput.value = Object.values(match.variations).join(" / ");
    }

    // Combination-level OOS: disable submit if this exact variant is sold out
    setVariantOosState(trackInventory && match.inventory === 0);

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
      if (curQty > currentVariantMax) qtyInput.value = String(currentVariantMax);
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
    updatePriceUI();
  }

  // ── QUANTITY STEPPER ───────────────────────────────────────────────────────
  
  document.getElementById("qty-minus")?.addEventListener("click", () => {
    if (!qtyInput) return;
    const v = Math.max(1, parseInt(qtyInput.value) || 1);
    if (v > 1) { qtyInput.value = String(v - 1); updatePriceUI(); updateQtyState(); }
  });

  document.getElementById("qty-plus")?.addEventListener("click", () => {
    if (!qtyInput) return;
    const v = Math.max(1, parseInt(qtyInput.value) || 1);
    if (v < currentVariantMax) { qtyInput.value = String(v + 1); updatePriceUI(); updateQtyState(); }
  });

  qtyInput?.addEventListener("input", () => {
    if (!qtyInput) return;
    const max = currentVariantMax;
    let v = parseInt(qtyInput.value) || 1;
    if (v > max) { v = max; qtyInput.value = String(max); }
    if (v < 1)   { v = 1;   qtyInput.value = "1"; }
    updatePriceUI();
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
   * Recalculates shipping cost based on selected wilaya and delivery type.
   */
  function refreshShipping() {
    // 1. Check for free shipping offers
    const selOffer = allOffers.find(o => o.id === currentOfferId);
    if (selOffer?.discountType === "free_shipping") {
      currentShipping = 0;
      updatePriceUI();
      return;
    }

    // 2. Otherwise the merchant's rate table decides.
    currentShipping = rateFor(rates, selectedWilayaId(), currentDeliveryType());
    updatePriceUI();
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

  // ── META PIXEL EVENTS ─────────────────────────────────────────────────────
  const pixelId   = data.pixelId;
  const productId = data.productId;

  function getCookie(name: string): string | null {
    return (
      document.cookie
        .split("; ")
        .find((r) => r.startsWith(name + "="))
        ?.split("=")[1] ?? null
    );
  }

  // 1. ViewContent — fires once immediately after page init
  if (pixelId) {
    trackViewContent(pixelId, productId, currentPrice);
  }

  // 2. InitiateCheckout — fires once when the shopper STARTS the checkout:
  //    first focus, keystroke, or selection inside the order form. Seeing the
  //    form is not starting checkout — Meta's event means the process began.
  if (pixelId) {
    const orderSection = document.getElementById("order-section");
    if (orderSection) {
      let checkoutStarted = false;
      const fireInitiateCheckout = () => {
        if (checkoutStarted) return;
        checkoutStarted = true;
        trackProductInitiateCheckout(pixelId, productId, currentPrice);
        orderSection.removeEventListener("focusin", fireInitiateCheckout);
        orderSection.removeEventListener("input", fireInitiateCheckout);
        orderSection.removeEventListener("change", fireInitiateCheckout);
      };
      orderSection.addEventListener("focusin", fireInitiateCheckout);
      orderSection.addEventListener("input", fireInitiateCheckout);
      orderSection.addEventListener("change", fireInitiateCheckout);
    }
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
