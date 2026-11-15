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
  storefrontApiPath,
  type DeliveryDestination,
  type DeliverySelection,
} from "@wocart/storefront";

/** The delivery-mode enum is the SDK's. */
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
