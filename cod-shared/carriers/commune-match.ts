/**
 * Matching our communes to a carrier's own list of communes.
 *
 * Carriers that check an address by commune name refuse a spelling that is not
 * theirs, and Algerian place names have many Latin spellings (Baba Hassen /
 * Baba Hesen, Staoueli / Setaouali). A wrong match is worse than none — the
 * parcel would go to another town — so a commune is matched only when the name
 * says so, in steps from the surest to the loosest, inside its own wilaya:
 *
 *   1. the same string;
 *   2. the same string once accents, case, spaces and punctuation are gone;
 *   3. the same name once the usual transliteration variants are folded;
 *   4. the same consonants (Arabic does not write short vowels, so Latin
 *      spellings differ by them): only for a unique pair in the wilaya;
 *   5. the closest unclaimed pair above a similarity bar, each carrier commune
 *      going to one of ours (the closest pair claims it first). A postal code
 *      that agrees lowers the bar, but never replaces the name.
 */

export interface OurCommune {
  id: string;
  name: string;
  wilayaId: number;
  postalCode?: string | null;
}

export interface TheirCommune {
  id: number;
  name: string;
  wilayaId: number;
  postalCode?: string | null;
}

export type MatchKind = "exact" | "normalized" | "folded" | "consonants" | "close";

export interface CommuneMatch {
  id: number;
  name: string;
  kind: MatchKind;
}

/** Closeness (0–1) two names need on their own to be one commune. */
const NAME_BAR = 0.75;
/** The same with an agreeing postal code. */
const NAME_BAR_WITH_POSTAL_CODE = 0.6;
/** A name that is the first words of the other counts only from this length. */
const MIN_PREFIX_LENGTH = 6;

const accentsOff = (name: string) => name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Accents, case, spaces, hyphens, apostrophes and periods removed. */
export function normalizeGeoName(name: string): string {
  return accentsOff(name).replace(/[\s\-'’.]/g, "");
}

/**
 * The name with Latin-spelling variants folded together: the Arabic article
 * and "Beni"/"Ben", "ou"/"u", "dj"/"j", "kh"/"h", the vowels e/i/y and a/o,
 * and doubled letters.
 */
function folded(name: string): string {
  const words = accentsOff(name)
    .replace(/[\-'’.]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b(el|al|ed|es|en|ech|ez|er|ess|et)\b ?/g, "")
    .replace(/\bbeni\b/g, "ben")
    .replace(/\bould?\b/g, "ouled");
  return words
    .replace(/\s+/g, "")
    .replace(/dj/g, "j")
    .replace(/ou/g, "u")
    .replace(/kh/g, "h")
    .replace(/gh/g, "g")
    .replace(/ch/g, "c")
    .replace(/th/g, "t")
    .replace(/ss/g, "s")
    .replace(/[ey]/g, "i")
    .replace(/[ao]/g, "a")
    .replace(/(.)\1+/g, "$1");
}

/** The name's consonants alone, once folded. */
function consonants(name: string): string {
  return folded(name).replace(/[aiu]/g, "");
}

/** A consonant skeleton shorter than this is too common to identify a commune. */
const MIN_CONSONANTS = 3;

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return row[b.length];
}

function closeness(a: string, b: string): number {
  const x = folded(a);
  const y = folded(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  const firstWords = short.length >= MIN_PREFIX_LENGTH && long.startsWith(short) ? 0.9 : 0;
  return Math.max(firstWords, 1 - distance(x, y) / Math.max(x.length, y.length));
}

/**
 * For each of our communes, the carrier commune it is — or nothing. Never
 * crosses wilayas and never gives one carrier commune to two of ours.
 */
export function matchCommunes(ours: readonly OurCommune[], theirs: readonly TheirCommune[]): Map<string, CommuneMatch> {
  const matches = new Map<string, CommuneMatch>();
  const claimed = new Set<number>();
  const theirsIn = new Map<number, TheirCommune[]>();
  for (const t of theirs) theirsIn.set(t.wilayaId, [...(theirsIn.get(t.wilayaId) ?? []), t]);

  const keyed: Array<[MatchKind, (name: string) => string]> = [
    ["exact", (name) => name],
    ["normalized", normalizeGeoName],
    ["folded", folded],
    ["consonants", (name) => { const skeleton = consonants(name); return skeleton.length >= MIN_CONSONANTS ? skeleton : `\u0000${name}`; }],
  ];
  for (const [kind, key] of keyed) {
    for (const c of ours) {
      if (matches.has(c.id)) continue;
      const candidates = (theirsIn.get(c.wilayaId) ?? []).filter((t) => !claimed.has(t.id) && key(t.name) === key(c.name));
      const rivals = ours.filter((o) => !matches.has(o.id) && o.wilayaId === c.wilayaId && key(o.name) === key(c.name));
      if (candidates.length !== 1 || rivals.length !== 1) continue;
      matches.set(c.id, { id: candidates[0].id, name: candidates[0].name, kind });
      claimed.add(candidates[0].id);
    }
  }

  const pairs: Array<{ ours: OurCommune; theirs: TheirCommune; score: number }> = [];
  for (const c of ours) {
    if (matches.has(c.id)) continue;
    for (const t of theirsIn.get(c.wilayaId) ?? []) {
      if (claimed.has(t.id)) continue;
      const score = closeness(c.name, t.name);
      const samePostalCode = !!c.postalCode && c.postalCode === t.postalCode;
      if (score >= NAME_BAR || (samePostalCode && score >= NAME_BAR_WITH_POSTAL_CODE)) {
        pairs.push({ ours: c, theirs: t, score: score + (samePostalCode ? 0.2 : 0) });
      }
    }
  }
  pairs.sort((a, b) => b.score - a.score || a.ours.name.localeCompare(b.ours.name) || a.theirs.name.localeCompare(b.theirs.name));
  for (const pair of pairs) {
    if (matches.has(pair.ours.id) || claimed.has(pair.theirs.id)) continue;
    matches.set(pair.ours.id, { id: pair.theirs.id, name: pair.theirs.name, kind: "close" });
    claimed.add(pair.theirs.id);
  }
  return matches;
}
