/**
 * A delivery company's map of places (`carrier_places`): which of our
 * communes it delivers to, under its own ids and spellings, and what it
 * charges the store there (its Carrier Rate and Return Fee, ADR 0024).
 *
 * The map is built from the carrier's own list, read through its adapter, and
 * matched with the one rule in cod-shared/places (`communeNamed`). A parcel is
 * addressed from the map alone: a commune the map lacks is refused before
 * anything is sent, and the merchant is told which, so nothing reaches a
 * carrier under a name it did not give us.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import type { AppDb } from "../db/client";
import { carrierPlaces, deliveryCompanies } from "../db/schema";
import { COMMUNES, commune as communeById, communeNamed } from "../places";
import { chunkIds } from "../queries/d1-limits";

/**
 * What the carrier charges the store for one parcel to a place, in DZD, as its
 * own API states it for the merchant's account: by delivery type, and for a
 * parcel that comes back. `null` where the carrier gives no price.
 */
export interface CarrierRate {
  readonly home: number | null;
  readonly stopDesk: number | null;
  readonly homeReturn: number | null;
  readonly stopDeskReturn: number | null;
}

/** A place as the carrier lists it: its wilaya (on its own map), its commune, and its rate there. */
export interface CarrierPlace {
  readonly wilaya: { readonly ref: string; readonly number: number; readonly name: string };
  readonly commune: { readonly ref: string; readonly name: string };
  /** The carrier delivers to the door there. */
  readonly home: boolean;
  readonly rate: CarrierRate;
}

/** Where a parcel goes, in the carrier's terms — what an adapter sends. */
export type CarrierDestination = Pick<CarrierPlace, "wilaya" | "commune">;

/** A carrier place no commune of ours has the spelling of: shown to the merchant, never sent. */
export interface UnmatchedPlace {
  readonly wilaya: string;
  readonly commune: string;
}

export interface PlacesSyncResult {
  readonly syncedAt: string;
  /** Our communes the carrier names. */
  readonly communes: number;
  /** Of those, the ones it delivers to the door. */
  readonly home: number;
  /** Of those, the ones it gives a price for. */
  readonly priced: number;
  readonly unmatched: readonly UnmatchedPlace[];
}

export interface PlacesSummary {
  readonly syncedAt: string | null;
  readonly communes: number;
  readonly home: number;
  readonly priced: number;
  readonly total: number;
  readonly unmatched: readonly UnmatchedPlace[];
}

type Row = typeof carrierPlaces.$inferInsert;
type BatchStatement = Parameters<AppDb["batch"]>[0][number];

/** Rows per INSERT: twelve columns each, under D1's 100 bound parameters. */
const ROWS_PER_INSERT = 8;

/**
 * Replace a company's map with the carrier's list, matched to our communes.
 * Two carrier places naming one commune keep the first (the carrier's list
 * order), the other is reported unmatched, so a duplicate is never silent.
 */
export async function syncCarrierPlaces(db: AppDb, companyId: string, places: readonly CarrierPlace[], now = new Date()): Promise<PlacesSyncResult> {
  const rows = new Map<string, Row>();
  const unmatched: UnmatchedPlace[] = [];
  for (const place of places) {
    const commune = communeNamed(place.wilaya.number, place.commune.name);
    if (!commune || rows.has(commune.id)) {
      unmatched.push({ wilaya: place.wilaya.name, commune: place.commune.name });
      continue;
    }
    rows.set(commune.id, {
      companyId,
      communeId: commune.id,
      wilayaRef: place.wilaya.ref,
      wilayaNumber: place.wilaya.number,
      wilayaName: place.wilaya.name,
      communeRef: place.commune.ref,
      communeName: place.commune.name,
      home: place.home,
      homeRate: place.rate.home,
      stopDeskRate: place.rate.stopDesk,
      homeReturnFee: place.rate.homeReturn,
      stopDeskReturnFee: place.rate.stopDeskReturn,
    });
  }
  const syncedAt = now.toISOString();
  const all = [...rows.values()];
  const statements: BatchStatement[] = [db.delete(carrierPlaces).where(eq(carrierPlaces.companyId, companyId))];
  for (let i = 0; i < all.length; i += ROWS_PER_INSERT) statements.push(db.insert(carrierPlaces).values(all.slice(i, i + ROWS_PER_INSERT)));
  statements.push(
    db.update(deliveryCompanies).set({ placesSyncedAt: syncedAt, placesUnmatched: JSON.stringify(unmatched) }).where(eq(deliveryCompanies.id, companyId)),
  );
  await db.batch(statements as [BatchStatement, ...BatchStatement[]]);
  return { syncedAt, communes: all.length, home: all.filter((r) => r.home).length, priced: all.filter((r) => r.homeRate != null || r.stopDeskRate != null).length, unmatched };
}

export interface MappedPlace extends CarrierDestination {
  readonly communeId: string;
  readonly home: boolean;
  readonly rate: CarrierRate;
}

/**
 * What a parcel to this place costs the store, sent this way: its Shipping
 * Cost and the Return Fee if it comes back, as the map holds them now.
 * A shipment freezes both when it is handed off.
 */
export function costAt(place: MappedPlace, deliveryType: "home" | "stop_desk"): { shippingCost: number | null; returnFee: number | null } {
  return deliveryType === "home"
    ? { shippingCost: place.rate.home, returnFee: place.rate.homeReturn }
    : { shippingCost: place.rate.stopDesk, returnFee: place.rate.stopDeskReturn };
}

const placeColumns = {
  communeId: carrierPlaces.communeId,
  wilayaRef: carrierPlaces.wilayaRef,
  wilayaNumber: carrierPlaces.wilayaNumber,
  wilayaName: carrierPlaces.wilayaName,
  communeRef: carrierPlaces.communeRef,
  communeName: carrierPlaces.communeName,
  home: carrierPlaces.home,
  homeRate: carrierPlaces.homeRate,
  stopDeskRate: carrierPlaces.stopDeskRate,
  homeReturnFee: carrierPlaces.homeReturnFee,
  stopDeskReturnFee: carrierPlaces.stopDeskReturnFee,
};

function mapped(row: Omit<typeof carrierPlaces.$inferSelect, "companyId">): MappedPlace {
  return {
    communeId: row.communeId,
    wilaya: { ref: row.wilayaRef, number: row.wilayaNumber, name: row.wilayaName },
    commune: { ref: row.communeRef, name: row.communeName },
    home: row.home,
    rate: { home: row.homeRate, stopDesk: row.stopDeskRate, homeReturn: row.homeReturnFee, stopDeskReturn: row.stopDeskReturnFee },
  };
}

/** Each of these communes as the company's carrier knows it; a commune it does not know is absent. */
export async function carrierPlacesOf(db: AppDb, companyId: string, communeIds: readonly string[]): Promise<Map<string, MappedPlace>> {
  const out = new Map<string, MappedPlace>();
  for (const ids of chunkIds([...new Set(communeIds)])) {
    const rows = await db.select(placeColumns).from(carrierPlaces).where(and(eq(carrierPlaces.companyId, companyId), inArray(carrierPlaces.communeId, ids))).all();
    for (const row of rows) out.set(row.communeId, mapped(row));
  }
  return out;
}

/** The commune of ours a carrier means by its own commune id, when its map has it. */
export async function communeOfCarrierRef(db: AppDb, companyId: string, communeRef: string): Promise<string | null> {
  const row = await db
    .select({ communeId: carrierPlaces.communeId })
    .from(carrierPlaces)
    .where(and(eq(carrierPlaces.companyId, companyId), eq(carrierPlaces.communeRef, communeRef)))
    .get();
  return row?.communeId ?? null;
}

/** What the company's map holds, for the dashboard. */
export async function carrierPlacesSummary(db: AppDb, companyId: string): Promise<PlacesSummary> {
  const [company, counts] = await Promise.all([
    db.select({ syncedAt: deliveryCompanies.placesSyncedAt, unmatched: deliveryCompanies.placesUnmatched }).from(deliveryCompanies).where(eq(deliveryCompanies.id, companyId)).get(),
    db
      .select({
        communes: sql<number>`count(*)`,
        home: sql<number>`coalesce(sum(${carrierPlaces.home}), 0)`,
        priced: sql<number>`coalesce(sum(${carrierPlaces.homeRate} is not null or ${carrierPlaces.stopDeskRate} is not null), 0)`,
      })
      .from(carrierPlaces)
      .where(eq(carrierPlaces.companyId, companyId))
      .get(),
  ]);
  return {
    syncedAt: company?.syncedAt ?? null,
    communes: counts?.communes ?? 0,
    home: counts?.home ?? 0,
    priced: counts?.priced ?? 0,
    total: COMMUNES.length,
    unmatched: company?.unmatched ? (JSON.parse(company.unmatched) as UnmatchedPlace[]) : [],
  };
}

/** The lowest and highest price among a wilaya's communes; equal when one price covers them all. */
export interface PriceRange {
  readonly min: number;
  readonly max: number;
}

/** What the company charges for a parcel to one of our wilayas, across the communes of it that it serves. */
export interface WilayaRates {
  readonly wilayaId: number;
  /** Our communes of the wilaya on the company's map. */
  readonly communes: number;
  readonly home: PriceRange | null;
  readonly stopDesk: PriceRange | null;
  /** Its Return Fee, whichever way the parcel was sent. */
  readonly returnFee: PriceRange | null;
}

function widen(range: PriceRange | null, price: number | null): PriceRange | null {
  if (price == null) return range;
  return range ? { min: Math.min(range.min, price), max: Math.max(range.max, price) } : { min: price, max: price };
}

/** The company's rates by our wilaya of today, in wilaya order: only the wilayas its map reaches. */
export async function carrierRatesByWilaya(db: AppDb, companyId: string): Promise<WilayaRates[]> {
  const rows = await db
    .select({
      communeId: carrierPlaces.communeId,
      homeRate: carrierPlaces.homeRate,
      stopDeskRate: carrierPlaces.stopDeskRate,
      homeReturnFee: carrierPlaces.homeReturnFee,
      stopDeskReturnFee: carrierPlaces.stopDeskReturnFee,
    })
    .from(carrierPlaces)
    .where(eq(carrierPlaces.companyId, companyId))
    .all();
  const byWilaya = new Map<number, { communes: number; home: PriceRange | null; stopDesk: PriceRange | null; returnFee: PriceRange | null }>();
  for (const row of rows) {
    const wilayaId = communeById(row.communeId)!.wilayaId;
    const w = byWilaya.get(wilayaId) ?? { communes: 0, home: null, stopDesk: null, returnFee: null };
    byWilaya.set(wilayaId, {
      communes: w.communes + 1,
      home: widen(w.home, row.homeRate),
      stopDesk: widen(w.stopDesk, row.stopDeskRate),
      returnFee: widen(widen(w.returnFee, row.homeReturnFee), row.stopDeskReturnFee),
    });
  }
  return [...byWilaya].sort(([a], [b]) => a - b).map(([wilayaId, w]) => ({ wilayaId, ...w }));
}

/** A stop desk as its carrier places it: by the carrier's commune id, or by its words for where it stands (its commune, its name) under its wilaya number. */
export interface DeskPlace {
  readonly communeRef: string | null;
  readonly commune: string | null;
  readonly name: string;
  readonly wilayaNumber: number | null;
}

/**
 * Each desk's commune of ours, through the company's map of places (by the
 * carrier's commune id) or the one spelling rule (its commune, then its own
 * name — carriers name a desk after its town — under the carrier's wilaya
 * number), and that commune's wilaya. A desk neither places
 * has no commune and no wilaya: it is never offered under a guessed one.
 */
export async function placeStopDesks(db: AppDb, companyId: string, desks: readonly DeskPlace[]): Promise<Array<{ communeId: string | null; wilayaId: number | null }>> {
  const refs = new Map(
    (await db.select({ ref: carrierPlaces.communeRef, communeId: carrierPlaces.communeId }).from(carrierPlaces).where(eq(carrierPlaces.companyId, companyId)).all()).map(
      (r) => [r.ref, r.communeId],
    ),
  );
  return desks.map((desk) => {
    const byRef = desk.communeRef ? refs.get(desk.communeRef) : undefined;
    const words = [desk.commune, desk.name].filter((w): w is string => !!w);
    const byName = !byRef && desk.wilayaNumber != null ? words.map((w) => communeNamed(desk.wilayaNumber!, w)?.id).find(Boolean) : undefined;
    const communeId = byRef ?? byName ?? null;
    const placed = communeId ? communeById(communeId) : undefined;
    return { communeId, wilayaId: placed?.wilayaId ?? null };
  });
}
