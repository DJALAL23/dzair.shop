/**
 * Carrier geo name resolution.
 *
 * Carriers that match addresses by exact name strings (Yalidine) reject
 * parcels whose wilaya/commune names differ from their own spellings.
 * These queries read/write the per-carrier name maps (carrier_wilayas /
 * carrier_communes) and resolve our reference IDs → carrier strings.
 *
 * Carriers without rows resolve to the reference-table name (callers treat
 * that as "no map, current behavior").
 */
import { eq, sql } from "drizzle-orm";
import { carrierWilayas, carrierCommunes, wilayas, communes } from "../db/schema";
import type { AppDb } from "../db/client";
import { matchCommunes, normalizeGeoName } from "../carriers/commune-match";

export interface CarrierGeoSyncResult {
  wilayasMatched: number;
  wilayasUnmapped: number;
  communesMatched: number;
  communesUnmapped: number;
  /** Our rows that found no carrier counterpart — surfaced to admins. */
  unmappedCommunes: Array<{ communeId: string; ourName: string }>;
  unmappedWilayas: Array<{ wilayaId: number; ourName: string }>;
  syncedAt: string;
}

export { normalizeGeoName };

/** Resolve one wilaya → the carrier's exact string (null = no map row). */
export async function resolveCarrierWilayaName(
  db: AppDb,
  carrierCode: string,
  wilayaId: number,
): Promise<string | null> {
  const row = await db
    .select({ carrierName: carrierWilayas.carrierName })
    .from(carrierWilayas)
    .where(
      sql`${carrierWilayas.carrierCode} = ${carrierCode} AND ${carrierWilayas.wilayaId} = ${wilayaId}`,
    )
    .get();
  return row?.carrierName ?? null;
}

/** Resolve one commune → the carrier's exact string (null = no map row). */
export async function resolveCarrierCommuneName(
  db: AppDb,
  carrierCode: string,
  communeId: string,
): Promise<string | null> {
  const row = await db
    .select({ carrierName: carrierCommunes.carrierName })
    .from(carrierCommunes)
    .where(
      sql`${carrierCommunes.carrierCode} = ${carrierCode} AND ${carrierCommunes.communeId} = ${communeId}`,
    )
    .get();
  return row?.carrierName ?? null;
}

type BatchStatement = Parameters<AppDb["batch"]>[0][number];

/**
 * Full geo sync for one carrier: wilayas by exact then normalized name;
 * communes by `matchCommunes` (exact, normalized, transliteration-folded, then
 * the closest unclaimed pair above a safety bar, inside the same wilaya),
 * and upsert the carrier's exact string for every match.
 *
 * Deletes previous rows for the carrier first — a re-sync after the carrier
 * renames a commune must not leave stale strings behind.
 *
 * Commune matching is scoped to the carrier's wilaya_id (both systems use
 * the official 1–58 numbering) — the collision space shrinks to sibling
 * communes, making distance-1 matching safe.
 *
 * @param carrierNames - the carrier's full name lists:
 *   wilayas: [{ id, name }], communes: [{ id, name, wilayaId }]
 */
export async function syncCarrierGeoNames(
  db: AppDb,
  carrierCode: string,
  carrierNames: {
    wilayas: Array<{ id: number; name: string }>;
    communes: Array<{ id: number; name: string; wilayaId: number; postalCode?: string | null }>;
  },
): Promise<CarrierGeoSyncResult> {
  const ourWilayas = await db
    .select({ id: wilayas.id, name: wilayas.name })
    .from(wilayas)
    .all();
  const ourCommunes = await db
    .select({ id: communes.id, name: communes.name, wilayaId: communes.wilayaId, postalCode: communes.postalCode })
    .from(communes)
    .all();

  // Wilayas: exact key, then normalized key.
  const yalWilayaExact = new Map(carrierNames.wilayas.map((w) => [w.name, w.id]));
  const yalWilayaNorm = new Map(carrierNames.wilayas.map((w) => [normalizeGeoName(w.name), w.id]));
  const carrierWilayaNameById = new Map(carrierNames.wilayas.map((w) => [w.id, w.name]));

  const communeMatches = matchCommunes(ourCommunes, carrierNames.communes);

  const wilayaStatements: BatchStatement[] = [];
  const communeStatements: BatchStatement[] = [];
  const result: CarrierGeoSyncResult = {
    wilayasMatched: 0,
    wilayasUnmapped: 0,
    communesMatched: 0,
    communesUnmapped: 0,
    unmappedCommunes: [],
    unmappedWilayas: [],
    syncedAt: new Date().toISOString(),
  };

  for (const w of ourWilayas) {
    const carrierId =
      yalWilayaExact.get(w.name) ?? yalWilayaNorm.get(normalizeGeoName(w.name));
    if (carrierId == null) {
      result.wilayasUnmapped++;
      result.unmappedWilayas.push({ wilayaId: w.id, ourName: w.name });
      continue;
    }
    const carrierName = carrierWilayaNameById.get(carrierId)!;
    wilayaStatements.push(
      db
        .insert(carrierWilayas)
        .values({ carrierCode, wilayaId: w.id, carrierName })
        .onConflictDoUpdate({
          target: [carrierWilayas.carrierCode, carrierWilayas.wilayaId],
          set: { carrierName: sql`excluded.carrier_name` },
        }),
    );
    result.wilayasMatched++;
  }

  for (const c of ourCommunes) {
    const hit = communeMatches.get(c.id);
    if (!hit) {
      result.communesUnmapped++;
      result.unmappedCommunes.push({ communeId: c.id, ourName: c.name });
      continue;
    }
    const carrierName = hit.name;
    communeStatements.push(
      db
        .insert(carrierCommunes)
        .values({ carrierCode, communeId: c.id, carrierName })
        .onConflictDoUpdate({
          target: [carrierCommunes.carrierCode, carrierCommunes.communeId],
          set: { carrierName: sql`excluded.carrier_name` },
        }),
    );
    result.communesMatched++;
  }

  // Replace the carrier's previous map wholesale, then insert the fresh one.
  const wipe: BatchStatement[] = [
    db.delete(carrierWilayas).where(eq(carrierWilayas.carrierCode, carrierCode)),
    db.delete(carrierCommunes).where(eq(carrierCommunes.carrierCode, carrierCode)),
  ];
  const statements = [...wipe, ...wilayaStatements, ...communeStatements] as [
    BatchStatement,
    ...BatchStatement[],
  ];
  await db.batch(statements);

  return result;
}

/** Count of mapped communes for a carrier — powers dashboard sync status. */
export async function countCarrierCommuneMappings(db: AppDb, carrierCode: string): Promise<number> {
  const rows = await db
    .select({ id: carrierCommunes.communeId })
    .from(carrierCommunes)
    .where(eq(carrierCommunes.carrierCode, carrierCode))
    .all();
  return rows.length;
}

/** Bulk resolve commune IDs → carrier names for one carrier (dispatch batch path). */
export async function resolveCarrierCommuneNames(
  db: AppDb,
  carrierCode: string,
  communeIds: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (communeIds.length === 0) return map;
  const rows = await db
    .select({ communeId: carrierCommunes.communeId, carrierName: carrierCommunes.carrierName })
    .from(carrierCommunes)
    .where(
      sql`${carrierCommunes.carrierCode} = ${carrierCode} AND ${carrierCommunes.communeId} IN (${sql.join(
        communeIds.map((id) => sql`${id}`),
        sql`, `,
      )})`,
    )
    .all();
  for (const row of rows) map.set(row.communeId, row.carrierName);
  return map;
}
