/**
 * Algeria's places — the one list every surface reads: 69 wilayas and 1541
 * communes (law 26-06, 2026). D1's `wilayas` and `communes` tables hold the
 * same rows for their foreign keys; a test holds them to this list.
 *
 * A carrier names places its own way, often on an older map: ZR Express
 * files Aflou under Laghouat (03), its 1984 wilaya; Yalidine writes "Aït
 * Yenni" for Beni Yenni. `communeNamed` is the one rule that reads a
 * carrier's commune as one of ours: an exact spelling (accents, case and
 * punctuation aside) known for a commune filed under that carrier wilaya.
 * Nothing is guessed: a spelling that is not known matches nothing.
 */

import { COMMUNE_ROWS, WILAYA_ROWS } from "./algeria";

export interface Wilaya {
  readonly id: number;
  readonly name: string;
  readonly nameAr: string;
}

export interface Commune {
  readonly id: string;
  readonly wilayaId: number;
  readonly name: string;
  readonly nameAr: string;
}

export const WILAYAS: readonly Wilaya[] = WILAYA_ROWS.map(([id, name, nameAr]) => ({ id, name, nameAr }));

/** The highest wilaya number; wilayas are numbered 1 to this, with no gap. */
export const LAST_WILAYA_ID = WILAYAS.length;

export const COMMUNES: readonly Commune[] = COMMUNE_ROWS.map(([id, wilayaId, name, nameAr]) => ({ id, wilayaId, name, nameAr }));

const wilayaById = new Map(WILAYAS.map((w) => [w.id, w]));
const communeById = new Map(COMMUNES.map((c) => [c.id, c]));
const communesByWilaya = new Map<number, Commune[]>();
for (const c of COMMUNES) communesByWilaya.set(c.wilayaId, [...(communesByWilaya.get(c.wilayaId) ?? []), c]);

export function isWilayaId(value: unknown): value is number {
  return typeof value === "number" && wilayaById.has(value);
}

export function wilaya(id: number): Wilaya | undefined {
  return wilayaById.get(id);
}

export function commune(id: string): Commune | undefined {
  return communeById.get(id);
}

/** A wilaya's communes, by name. */
export function communesOf(wilayaId: number): readonly Commune[] {
  return communesByWilaya.get(wilayaId) ?? [];
}

/** How two spellings of a place are compared: letters and digits only, without accents or case. */
export function placeKey(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** Every commune filed under a wilaya number on any map (its own, 2019, 1984, or a carrier's), by spelling. */
const bySpelling = new Map<number, Map<string, Commune>>();
for (const [id, wilayaId, name, , alsoUnder, spellings] of COMMUNE_ROWS) {
  const place = communeById.get(id)!;
  for (const number of [wilayaId, ...alsoUnder]) {
    const index = bySpelling.get(number) ?? new Map<string, Commune>();
    for (const spelling of [name, ...spellings]) index.set(placeKey(spelling), place);
    bySpelling.set(number, index);
  }
}

/**
 * The commune a carrier means by `name` in its wilaya `wilayaNumber`, or
 * `null` when no commune filed under that number has that spelling.
 */
export function communeNamed(wilayaNumber: number, name: string): Commune | null {
  return bySpelling.get(wilayaNumber)?.get(placeKey(name)) ?? null;
}
