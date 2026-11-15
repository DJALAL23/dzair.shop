/**
 * A shipping profile built from a delivery company's rates (ADR 0024): what
 * the customer pays, made once from what the carrier charges the store, plus
 * the merchant's amount. The two never follow each other afterwards; the
 * merchant copies again when the carrier's prices change.
 *
 * One rule for every carrier: each adapter puts its prices on its map of
 * places, one row per commune (a carrier that prices per wilaya repeats the
 * wilaya's price on each of its communes), so nothing here knows which
 * company it reads.
 *
 * - A wilaya takes the carrier's most common price there; a commune priced
 *   otherwise gets its own price.
 * - Home delivery is off in a commune the carrier does not reach at the door.
 * - Stop desk is the wilaya's: the parcel goes to a desk the merchant picks, so
 *   it is on wherever the carrier gives a stop-desk price in the wilaya.
 * - A wilaya the carrier neither delivers to nor prices is left out: the
 *   profile does not deliver there.
 */
import { commune as communeById, communesOf } from "../places";
import type { ProfileCommuneInput, ProfileRuleInput } from "../queries/shipping-profiles";

/** One commune on a carrier's map, as `carrier_places` holds it. */
export interface CarrierPlaceRate {
  readonly communeId: string;
  /** The carrier delivers to the door there. */
  readonly home: boolean;
  readonly homeRate: number | null;
  readonly stopDeskRate: number | null;
}

/** How the customer's price is made from the carrier's. */
export interface CarrierPricing {
  /** Added to every carrier price, in DZD (0: the carrier's price as it is). */
  readonly add: number;
  /** Prices are rounded up to a multiple of this (0: not rounded). */
  readonly roundTo: 0 | 10 | 50 | 100;
}

export const CARRIER_PRICING_ROUNDINGS = [0, 10, 50, 100] as const;
/** The most a merchant may add to a carrier's price, in DZD. */
export const CARRIER_PRICING_MAX_ADD = 5000;

export interface ProfileFromRates {
  readonly rules: ProfileRuleInput[];
  /** Each served wilaya's commune overrides (an empty list for none). */
  readonly communes: Map<number, ProfileCommuneInput[]>;
}

/** The customer's price for a carrier price. */
export function customerPrice(carrierPrice: number, pricing: CarrierPricing): number {
  const price = Math.max(0, carrierPrice + pricing.add);
  return pricing.roundTo > 0 ? Math.ceil(price / pricing.roundTo) * pricing.roundTo : Math.round(price);
}

/** The most common value; on a tie, the lowest, so the same map always gives the same profile. */
function mostCommon(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const counts = new Map<number, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best: number | null = null;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount || (count === bestCount && value < best!)) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

/** The profile a carrier's map of places makes, at the merchant's pricing. */
export function profileFromRates(places: readonly CarrierPlaceRate[], pricing: CarrierPricing): ProfileFromRates {
  const byWilaya = new Map<number, Map<string, CarrierPlaceRate>>();
  for (const place of places) {
    const wilayaId = communeById(place.communeId)?.wilayaId;
    if (wilayaId === undefined) continue;
    const communes = byWilaya.get(wilayaId) ?? new Map<string, CarrierPlaceRate>();
    communes.set(place.communeId, place);
    byWilaya.set(wilayaId, communes);
  }

  const rules: ProfileRuleInput[] = [];
  const communes = new Map<number, ProfileCommuneInput[]>();
  for (const wilayaId of [...byWilaya.keys()].sort((a, b) => a - b)) {
    const map = byWilaya.get(wilayaId)!;
    const homeAt = (place: CarrierPlaceRate | undefined) => (place?.home && place.homeRate != null ? customerPrice(place.homeRate, pricing) : null);
    const deskAt = (place: CarrierPlaceRate | undefined) => (place?.stopDeskRate != null ? customerPrice(place.stopDeskRate, pricing) : null);

    const homePrice = mostCommon([...map.values()].map(homeAt).filter((price): price is number => price !== null));
    const stopDeskPrice = mostCommon([...map.values()].map(deskAt).filter((price): price is number => price !== null));
    if (homePrice === null && stopDeskPrice === null) continue;

    rules.push({ wilayaId, homePrice: homePrice ?? 0, stopDeskPrice: stopDeskPrice ?? 0, homeEnabled: homePrice !== null, stopDeskEnabled: stopDeskPrice !== null });

    const overrides: ProfileCommuneInput[] = [];
    for (const { id } of communesOf(wilayaId)) {
      const place = map.get(id);
      const home = homeAt(place);
      const desk = deskAt(place);
      const homeOff = homePrice !== null && home === null;
      const ownHome = home !== null && homePrice !== null && home !== homePrice;
      const ownDesk = desk !== null && stopDeskPrice !== null && desk !== stopDeskPrice;
      if (!homeOff && !ownHome && !ownDesk) continue;
      overrides.push({ communeId: id, homeEnabled: homeOff ? false : null, homePrice: ownHome ? home : null, stopDeskEnabled: null, stopDeskPrice: ownDesk ? desk : null });
    }
    communes.set(wilayaId, overrides);
  }
  return { rules, communes };
}
