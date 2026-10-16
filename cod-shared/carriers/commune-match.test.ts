import { describe, it, expect } from "vitest";
import { matchCommunes, type OurCommune, type TheirCommune } from "./commune-match";

let n = 0;
const ours = (name: string, wilayaId = 16, postalCode: string | null = null): OurCommune => ({ id: `o${++n}`, name, wilayaId, postalCode });
const theirs = (name: string, wilayaId = 16, postalCode: string | null = null): TheirCommune => ({ id: ++n, name, wilayaId, postalCode });

/** What each of our communes was matched to, by name. */
function run(o: OurCommune[], t: TheirCommune[]) {
  const matches = matchCommunes(o, t);
  return Object.fromEntries(o.map((c) => [c.name, matches.get(c.id)?.name ?? null]));
}

describe("matching our communes to a carrier's list", () => {
  it("takes the carrier's own spelling, exact first", () => {
    expect(run([ours("Alger Centre")], [theirs("Alger Centre")])).toEqual({ "Alger Centre": "Alger Centre" });
  });

  it("ignores accents, case, spaces, hyphens and apostrophes", () => {
    expect(run([ours("Sidi Mhamed"), ours("Ain Arnat", 19)], [theirs("Sidi M'Hamed"), theirs("Aïn Arnat", 19)])).toEqual({ "Sidi Mhamed": "Sidi M'Hamed", "Ain Arnat": "Aïn Arnat" });
  });

  it("reads through the usual transliteration differences (real EcoTrack / NOEST pairs)", () => {
    const pairs: Array<[string, string]> = [
      ["Baba Hassen", "Baba Hesen"], ["Bab Azzouar", "Bab Ezzouar"], ["Staoueli", "Setaouali"], ["Haraoua", "Herraoua"],
      ["Tassala El Merdja", "Tessala El Merdja"], ["Beni Melikeche", "Beni Mallikeche"],
      ["Larba Nait Irathen", "Larba Nath Irathen"], ["Ziamma Mansouriah", "Ziama Mansouria"], ["Derradji Bousselah", "Derrahi Bousselah"],
      ["Sidi Bellater", "Sidi Belaattar"], ["Tamanghasset", "Tamanrasset"], ["Mechria", "Mecheria"], ["Boughezoul", "Boughzoul"],
    ];
    for (const [ourName, theirName] of pairs) expect(run([ours(ourName)], [theirs(theirName)]), ourName).toEqual({ [ourName]: theirName });
  });

  it("reads names that differ only by vowels, which Arabic does not write (Djmila / Djimla)", () => {
    const pairs: Array<[string, string]> = [["Djmila", "Djimla"], ["Zelmata", "Zelamta"], ["Dar Chouikh", "Dar Chioukh"]];
    for (const [ourName, theirName] of pairs) expect(run([ours(ourName, 18)], [theirs(theirName, 18)]), ourName).toEqual({ [ourName]: theirName });
  });

  it("does not read a vowel-less skeleton from a short name, nor when two of ours share it", () => {
    expect(run([ours("Bir", 5)], [theirs("Bar", 5)])).toEqual({ Bir: null });
    const a = ours("Djmila", 18);
    const b = ours("Djamla", 18);
    const matches = matchCommunes([a, b], [theirs("Djimla", 18)]);
    expect([...matches.values()].some((m) => m.kind === "consonants")).toBe(false);
  });

  it("takes a carrier's longer name when ours is its first words (Bologhine → Bologhine Ibnou Ziri)", () => {
    expect(run([ours("Bologhine")], [theirs("Bologhine Ibnou Ziri")])).toEqual({ Bologhine: "Bologhine Ibnou Ziri" });
    expect(run([ours("Djendel", 21)], [theirs("Djendel Saadi Mohamed", 21)])).toEqual({ Djendel: "Djendel Saadi Mohamed" });
  });

  it("never matches across wilayas", () => {
    expect(run([ours("Tadjmout", 3)], [theirs("Tadjmout", 4)])).toEqual({ Tadjmout: null });
  });

  it("refuses a neighbour that is a different place (two communes of one wilaya)", () => {
    expect(run([ours("Ain Sandel", 24)], [theirs("Sidi Sandel", 24)])).toEqual({ "Ain Sandel": null });
    expect(run([ours("Hassi", 17)], [theirs("Hassi Bahbah", 17)])).toEqual({ Hassi: null });
    expect(run([ours("Belouizdad")], [theirs("Hamma Anassers")])).toEqual({ Belouizdad: null });
  });

  it("gives each carrier commune to one of ours: the closer name keeps it", () => {
    expect(run([ours("Ouled Selam", 5), ours("Ouled Selama", 5)], [theirs("Ouled Sellem", 5), theirs("Ouled Slama", 5)])).toEqual({
      "Ouled Selam": "Ouled Sellem",
      "Ouled Selama": "Ouled Slama",
    });
    const single = run([ouedSelam(), ouedSelama()], [theirs("Ouled Sellem", 5)]);
    expect(Object.values(single).filter(Boolean)).toHaveLength(1);
  });

  it("an exact match is never stolen by a fuzzy one", () => {
    expect(run([ours("Ain Taya"), ours("Ain Tay")], [theirs("Ain Taya")])["Ain Taya"]).toBe("Ain Taya");
  });

  it("a postal code corroborates a looser name, and cannot replace the name", () => {
    expect(run([ours("Ouled Ahmed Tammi", 1, "01021")], [theirs("O Ahmed Timmi", 1, "01021")])).toEqual({ "Ouled Ahmed Tammi": "O Ahmed Timmi" });
    expect(run([ours("Ouled Ahmed Tammi", 1)], [theirs("O Ahmed Timmi", 1, "01021")])).toEqual({ "Ouled Ahmed Tammi": null });
    expect(run([ours("Belouizdad", 16, "16009")], [theirs("Hamma Anassers", 16, "16009")])).toEqual({ Belouizdad: null });
  });

  it("matches nothing when the carrier lacks the commune", () => {
    expect(run([ours("Charouine", 1)], [theirs("Adrar", 1), theirs("Tamest", 1)])).toEqual({ Charouine: null });
  });

  it("gives the same answer whatever order the lists come in", () => {
    const o = [ours("Ouled Selam", 5), ours("Ouled Selama", 5), ours("Baba Hassen"), ours("Mahelma")];
    const t = [theirs("Ouled Sellem", 5), theirs("Ouled Slama", 5), theirs("Baba Hesen"), theirs("Maalma")];
    expect(run([...o].reverse(), [...t].reverse())).toEqual(run(o, t));
  });
});

function ouedSelam() { return ours("Ouled Selam", 5); }
function ouedSelama() { return ours("Ouled Selama", 5); }
