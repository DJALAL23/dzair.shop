/**
 * A carrier's amounts as DZD. Carriers' APIs write them as numbers or as
 * numeric strings, and write 0 for a delivery they give no price for (a stop
 * desk a wilaya lacks).
 */
import type { CarrierRate } from "./contract";

/** A place the carrier gives no price for. */
export const NO_RATE: CarrierRate = { home: null, stopDesk: null, homeReturn: null, stopDeskReturn: null };

/** An amount, or null when it is not one. */
export function amount(value: unknown): number | null {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : null;
}

/** A delivery price: 0 is the carrier saying it gives none. */
export function deliveryPrice(value: unknown): number | null {
  return amount(value) || null;
}

/** How EcoTrack and NOEST price a wilaya: a home (`tarif`) and a stop-desk (`tarif_stopdesk`) amount. */
export interface TarifPair {
  tarif: string | number | null;
  tarif_stopdesk: string | number | null;
}

/** A wilaya's rate from its delivery and return pairs: no price where the carrier lists none. */
export function tarifRate(delivery: TarifPair | undefined, returned: TarifPair | undefined): CarrierRate {
  return {
    home: deliveryPrice(delivery?.tarif),
    stopDesk: deliveryPrice(delivery?.tarif_stopdesk),
    homeReturn: amount(returned?.tarif),
    stopDeskReturn: amount(returned?.tarif_stopdesk),
  };
}
