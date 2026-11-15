/**
 * Reading a carrier's lists: its places (where it delivers, under its own ids,
 * with its prices), then its stop desks, which are placed through those
 * places. Connecting a company, the company page's "Read again" and the hourly
 * refresh all read them here, so a company always has both or neither.
 */
import type { AppDb } from "@/db";
import type { CarrierAdapter } from "@/carriers/contract";
import { syncCarrierPlaces, type PlacesSyncResult } from "../../../../cod-shared/carriers/places";
import { storeStopDesks, type StopDeskSync } from "./stop-desks";

export interface CarrierListsRead {
  readonly places: PlacesSyncResult;
  /** Null for a carrier that lists no desks, or whose desks could not be read this time (its places are kept). */
  readonly desks: StopDeskSync | null;
}

/**
 * Read the carrier's places into the company's map, then its desks. A list of
 * places that cannot be read throws, and nothing changes; desks that cannot be
 * read are logged and left as they were, since the map they hang on is saved.
 */
export async function readCarrierLists(db: AppDb, companyId: string, carrier: Pick<CarrierAdapter, "places" | "stopDesks" | "capabilities">, now = new Date()): Promise<CarrierListsRead> {
  const places = await syncCarrierPlaces(db, companyId, await carrier.places(), now);
  if (!carrier.capabilities.stopDeskList || !carrier.stopDesks) return { places, desks: null };
  try {
    return { places, desks: await storeStopDesks(db, companyId, await carrier.stopDesks(), now) };
  } catch (error) {
    console.warn(`[carrier-lists] company=${companyId}: desks not read`, error instanceof Error ? error.message : error);
    return { places, desks: null };
  }
}
