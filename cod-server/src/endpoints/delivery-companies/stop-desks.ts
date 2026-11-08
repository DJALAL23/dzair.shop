/**
 * A company's stop desks, as its carrier lists them, stored with our commune
 * and wilaya for each (read through the company's map of places, so a desk is
 * offered under the wilaya shoppers know). Used by the sync route and the
 * hourly refresh.
 */
import { and, eq, lt, sql } from "drizzle-orm";
import type { AppDb } from "@/db";
import { companyStopDesks } from "@/db/schema";
import type { CarrierStopDesk } from "@/carriers/contract";
import { placeStopDesks } from "../../../../cod-shared/carriers/places";

export interface StopDeskSync {
  total: number;
  removed: number;
  /** Desks the company's map of places cannot put in a commune: kept, but offered under no wilaya. */
  unplaced: number;
  /** `null` when nothing was stored (the carrier listed no desk). */
  syncedAt: string | null;
}

/** Rows per D1 batch. */
const BATCH_SIZE = 50;

export async function storeStopDesks(db: AppDb, companyId: string, desks: readonly CarrierStopDesk[], now = new Date()): Promise<StopDeskSync> {
  // An empty list from a carrier that had desks is far likelier an outage
  // dressed as success than every desk closing at once; deleting on it would
  // wipe the merchant's desks and their on/off choices.
  if (desks.length === 0) return { total: 0, removed: 0, unplaced: 0, syncedAt: null };

  const syncedAt = now.toISOString();
  const placed = await placeStopDesks(db, companyId, desks);

  // `active` is the merchant's choice: set on a new desk, never overwritten.
  const upserts = desks.map((desk, index) =>
    db
      .insert(companyStopDesks)
      .values({
        id: crypto.randomUUID(),
        companyId,
        code: desk.code,
        name: desk.name,
        commune: desk.commune ?? null,
        communeId: placed[index]!.communeId,
        wilayaId: placed[index]!.wilayaId,
        address: desk.address ?? null,
        phones: desk.phones ? JSON.stringify(desk.phones) : null,
        active: true,
        syncedAt,
      })
      .onConflictDoUpdate({
        target: [companyStopDesks.companyId, companyStopDesks.code],
        set: {
          name: sql`excluded.name`,
          commune: sql`excluded.commune`,
          communeId: sql`excluded.commune_id`,
          wilayaId: sql`excluded.wilaya_id`,
          address: sql`excluded.address`,
          phones: sql`excluded.phones`,
          syncedAt: sql`excluded.synced_at`,
        },
      }),
  );
  for (let i = 0; i < upserts.length; i += BATCH_SIZE) {
    const chunk = upserts.slice(i, i + BATCH_SIZE);
    await db.batch(chunk as [(typeof chunk)[0], ...typeof chunk]);
  }

  // A desk this sync did not list is gone at the carrier.
  const removed = await db
    .delete(companyStopDesks)
    .where(and(eq(companyStopDesks.companyId, companyId), lt(companyStopDesks.syncedAt, syncedAt)))
    .returning({ code: companyStopDesks.code });

  return { total: desks.length, removed: removed.length, unplaced: placed.filter((p) => p.wilayaId === null).length, syncedAt };
}
