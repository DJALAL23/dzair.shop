/**
 * Delivery details, shared by the product order form and the checkout page.
 *
 * Both surfaces render the same `CustomerFields.astro` block, so both need the
 * same three behaviours: pick a wilaya and its communes load, pick a delivery
 * type and the address field appears or disappears with it, and either change
 * re-prices delivery. This module owns all three so the two pages cannot drift
 * apart — a commune list that loads on one page and not the other is the kind
 * of difference nobody notices until an order arrives with no address.
 *
 * What stays with the caller is what genuinely differs: the product form has to
 * consider a free-shipping offer tier, and checkout has to price a whole
 * basket. Both get told "something changed, re-price" and decide for themselves.
 */

import {
  communesForWilaya,
  isWilayaId,
  readShippingRates,
  storefrontApiPath,
  type DeliveryDestination,
  type DeliverySelection,
  type ShippingRates,
  type WilayaRates,
} from "@wocart/storefront";

/** The rate table's shape, and the delivery-mode enum, are the SDK's. */
export type ShippingRate = WilayaRates;
export type { ShippingRates };
export type DeliveryType = DeliverySelection["deliveryType"];

export interface DeliveryCopy {
  communeLoading: string;
  communePlaceholder: string;
  communeDisabled: string;
}

// `window.__selectPopulate` and friends are declared in env.d.ts and installed
// by Select.astro. They are called optionally here because this module can run
// before that script has: a missing helper degrades to an unpopulated field,
// never to a thrown error mid-checkout.

export function parseShippingRates(raw: string | null | undefined): ShippingRates {
  if (!raw) return {};
  try {
    // The shape check is the SDK's reader, which accepts what its schema does: a
    // bridge from an older shape degrades to "to be calculated", never to a NaN
    // the shopper can see.
    return readShippingRates(JSON.parse(raw)) ?? {};
  } catch {
    // A malformed bridge must not take the page down: delivery simply shows as
    // "to be calculated" until the shopper is told a real number.
    return {};
  }
}

/**
 * Read the rates the server put on the page, now or whenever they arrive.
 *
 * `ShippingIsland.astro` can be a deferred server island, so the element may
 * not exist yet when this runs. Returns a disposer.
 */
export function watchShippingRates(onRates: (rates: ShippingRates) => void): () => void {
  let disposed = false;

  const read = (): boolean => {
    const el = document.getElementById("shipping-rates-data");
    const rates = parseShippingRates(el?.dataset.rates);
    if (Object.keys(rates).length === 0) return false;
    if (!disposed) onRates(rates);
    return true;
  };

  const observer = new MutationObserver(() => {
    if (read()) observer.disconnect();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  // Never leave a permanent observer behind if the island never lands.
  const timer = window.setTimeout(() => observer.disconnect(), 10_000);

  // The bridge can already be in the DOM when this runs (ShippingIsland.astro
  // renders it inline), and a synchronous first delivery would re-enter the
  // caller in the middle of its own initialization — while its later `const`
  // bindings are still in the temporal dead zone. That crash killed the
  // product page's whole init, so the first read is always a microtask: it
  // runs only after the caller's synchronous setup has finished.
  queueMicrotask(() => {
    if (read()) {
      observer.disconnect();
      window.clearTimeout(timer);
    }
  });

  return () => {
    disposed = true;
    observer.disconnect();
    window.clearTimeout(timer);
  };
}

export function currentDeliveryType(): DeliveryType {
  // The live `checked` property, not the `:checked` selector: a radio's
  // `checked` attribute can still match the selector after another radio of
  // its group has been chosen, which would read the old choice back.
  const checked = Array.from(document.querySelectorAll<HTMLInputElement>(".delivery-radio-input")).find(
    (radio) => radio.checked,
  );
  return checked?.value === "stop_desk" ? "stop_desk" : "home";
}

export function selectedWilayaId(): string {
  const select = document.getElementById("f-wilaya") as HTMLInputElement | null;
  return select?.value ?? "";
}

export function selectedCommuneId(): string {
  const select = document.getElementById("f-commune") as HTMLInputElement | null;
  return select?.value ?? "";
}

/**
 * Where the shopper has asked to be delivered, as the server quotes it — or
 * `undefined` until a wilaya is chosen.
 */
export function deliveryDestination(): DeliveryDestination | undefined {
  const wilayaId = Number(selectedWilayaId());
  if (!selectedWilayaId() || !isWilayaId(wilayaId)) return undefined;
  const communeId = selectedCommuneId();
  return {
    wilayaId,
    ...(communeId ? { communeId } : {}),
    deliveryType: currentDeliveryType(),
  };
}

/** NaN means "no rate known yet", which the caller shows as "to be calculated". */
export function rateFor(
  rates: ShippingRates,
  wilayaId: string,
  deliveryType: DeliveryType,
): number {
  if (!wilayaId) return NaN;
  const rate = rates[wilayaId];
  if (!rate) return NaN;
  const value = deliveryType === "stop_desk" ? rate.stopDesk : rate.home;
  return typeof value === "number" && Number.isFinite(value) ? value : NaN;
}

/** Home delivery needs a street address; a stop desk does not. */
export function toggleAddressFields(): void {
  const container = document.getElementById("address-field-container");
  if (!container) return;
  const hidden = currentDeliveryType() !== "home";
  container.classList.toggle("hidden", hidden);

  // A `required` field inside a hidden container makes the form unsubmittable:
  // the browser refuses to submit, tries to focus what it cannot show, and the
  // shopper gets a form that does nothing when tapped with no message to read.
  //
  // That is reachable as soon as a merchant makes the address required, because
  // every stop-desk order then hides a required field. The requirement is
  // restored the moment home delivery is chosen again — and cod-server applies
  // the same rule regardless (required for home delivery only), so this stays
  // UX rather than a second definition of it.
  const input = document.getElementById("f-address") as HTMLInputElement | null;
  if (input?.dataset.addressRequired === "true") input.required = !hidden;
}

/** The chosen delivery card wears `is-on`; the theme's CSS draws it. */
function paintDeliveryRadios(): void {
  document.querySelectorAll<HTMLInputElement>(".delivery-radio-input").forEach((radio) => {
    (radio.nextElementSibling as HTMLElement | null)?.classList.toggle("is-on", radio.checked);
  });
}

async function loadCommunes(
  wilayaId: string,
  copy: DeliveryCopy,
  isRTL: boolean,
  isCurrent: () => boolean,
): Promise<void> {
  const numericId = parseInt(wilayaId, 10);
  const localCommunes = communesForWilaya(numericId);

  // 1. Zero-network instant resolution (Shopify-grade: 0ms latency, zero network failure)
  //    The rows are the SDK's bundled reference dataset, parity-checked against
  //    the server's seed rows before every SDK release, so they are the same
  //    list the API would return — minus the round-trip.
  if (localCommunes.length > 0) {
    if (!isCurrent()) return;
    const communes = localCommunes.map((commune) => ({
      value: commune.id,
      // Some rows carry no Arabic spelling (Talmine, c-01-024); the Latin name
      // is the label then.
      label: isRTL ? (commune.nameAr || commune.name) : commune.name,
    }));
    window.__selectPopulate?.("f-commune", communes, copy.communePlaceholder);
    return;
  }

  // 2. Graceful network fallback if an unknown / custom wilayaId is provided
  window.__selectSetLoading?.("f-commune", true, copy.communeLoading);
  try {
    const res = await fetch(storefrontApiPath("communes", { wilayaId }));
    const json = (await res.json()) as {
      data?: Array<{ id: string; name: string; nameAr: string }>;
    };
    if (!isCurrent()) return;
    const communes = (json.data ?? []).map((c) => ({
      value: c.id,
      label: isRTL ? (c.nameAr || c.name) : c.name,
    }));
    window.__selectPopulate?.("f-commune", communes, copy.communePlaceholder);
  } catch {
    if (!isCurrent()) return;
    // An empty list still tells the shopper the field is theirs to fill in
    // again, rather than leaving a spinner that never resolves.
    window.__selectPopulate?.("f-commune", [], copy.communePlaceholder);
  }
}

/**
 * Wire the delivery block. Returns a disposer.
 *
 * `onChange` fires whenever the delivery price could have moved — a new wilaya,
 * commune (a merchant can price one apart from its wilaya) or delivery type —
 * and never for anything else.
 */
export function bindDeliveryFields(
  copy: DeliveryCopy,
  options: { isRTL: boolean; onChange: () => void },
): () => void {
  const aborter = new AbortController();
  const { signal } = aborter;
  let communeRequest = 0;

  document.querySelectorAll<HTMLInputElement>(".delivery-radio-input").forEach((radio) => {
    radio.addEventListener(
      "change",
      () => {
        paintDeliveryRadios();
        toggleAddressFields();
        options.onChange();
      },
      { signal },
    );
  });

  const wilaya = document.getElementById("f-wilaya") as HTMLInputElement | null;
  wilaya?.addEventListener(
    "change",
    (event) => {
      const wilayaId = (event.target as HTMLInputElement).value;
      const id = ++communeRequest;
      if (wilayaId) {
        void loadCommunes(wilayaId, copy, options.isRTL, () => id === communeRequest);
      } else {
        // A cleared wilaya must clear the commune with it, or the shopper
        // submits a commune belonging to a wilaya they no longer selected.
        communeRequest += 1;
        window.__selectSetDisabled?.("f-commune", copy.communeDisabled);
      }
      options.onChange();
    },
    { signal },
  );

  document.getElementById("f-commune")?.addEventListener("change", () => options.onChange(), { signal });

  toggleAddressFields();

  return () => aborter.abort();
}
