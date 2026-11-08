/**
 * The hourly refresh of each delivery company's map of places: carriers open
 * and close communes, and a company whose list was never read (just
 * connected, or migrated) can address no parcel. A connected company whose
 * map is missing or older than a week has its places read again, then its
 * stop desks, which are placed through the map.
 */
import { and, eq, isNotNull, isNull, lt, or } from "drizzle-orm";
import type { Env } from "@/types/env";
import { getDb } from "@/db";
import { deliveryCompanies } from "@/db/schema";
import { buildCarrier } from "@/carriers/registry";
import { storeStopDesks } from "@/endpoints/delivery-companies/stop-desks";
import { syncCarrierPlaces } from "../../../cod-shared/carriers/places";

export const PLACES_STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

/** Companies refreshed per run: a carrier's list is a few calls; the rest wait an hour. */
export const PLACES_PER_RUN = 5;

export async function refreshCarrierPlaces(env: Env, now = new Date()): Promise<void> {
  const db = getDb(env.DB);
  const stale = new Date(now.getTime() - PLACES_STALE_AFTER_MS).toISOString();
  const due = await db
    .select()
    .from(deliveryCompanies)
    .where(
      and(
        eq(deliveryCompanies.active, true),
        isNotNull(deliveryCompanies.provider),
        isNotNull(deliveryCompanies.apiToken),
        or(isNull(deliveryCompanies.placesSyncedAt), lt(deliveryCompanies.placesSyncedAt, stale)),
      ),
    )
    .orderBy(deliveryCompanies.placesSyncedAt)
    .limit(PLACES_PER_RUN)
    .all();
  for (const company of due) {
    try {
      const carrier = buildCarrier(company);
      const places = await syncCarrierPlaces(db, company.id, await carrier.places(), now);
      const desks = carrier.capabilities.stopDeskList ? await storeStopDesks(db, company.id, await carrier.stopDesks!(), now) : null;
      console.info(`[places] company=${company.id} code=${company.code} communes=${places.communes} unmatched=${places.unmatched.length}${desks ? ` desks=${desks.total} unplaced=${desks.unplaced}` : ""}`);
    } catch (error) {
      console.error(`[places] company=${company.id} code=${company.code}: list not read`, error instanceof Error ? error.message : error);
    }
  }
}
