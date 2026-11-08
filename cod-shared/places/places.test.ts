/**
 * The list of places, held to the laws that draw it, and the one rule that
 * reads a carrier's commune as one of ours.
 */
import { describe, expect, it } from "vitest";
import { COMMUNE_ROWS } from "./algeria";
import { COMMUNES, LAST_WILAYA_ID, WILAYAS, commune, communeNamed, communesOf, isWilayaId, placeKey, wilaya } from "./index";

describe("the list", () => {
  it("is law 26-06's: 69 wilayas, numbered 1 to 69, and 1541 communes", () => {
    expect(WILAYAS.map((w) => w.id)).toEqual(Array.from({ length: 69 }, (_, i) => i + 1));
    expect(LAST_WILAYA_ID).toBe(69);
    expect(COMMUNES).toHaveLength(1541);
    expect(new Set(COMMUNES.map((c) => c.id)).size).toBe(1541);
  });

  it("gives every wilaya its communes, as many as the laws list", () => {
    for (const w of WILAYAS) expect(communesOf(w.id).length, `wilaya ${w.id}`).toBeGreaterThan(0);
    // Law 26-06 (2026), law 19-12 (2019): the wilayas they redraw.
    const counts: Record<number, number> = {
      3: 12, 5: 53, 7: 22, 12: 24, 13: 49, 14: 36, 17: 18, 26: 43, 28: 24, 32: 15,
      59: 12, 60: 8, 61: 5, 62: 4, 63: 4, 64: 6, 65: 10, 66: 8, 67: 21, 68: 23, 69: 7,
      1: 16, 8: 11, 11: 5, 30: 7, 33: 4, 39: 22, 47: 10,
      49: 10, 50: 2, 51: 6, 52: 10, 53: 3, 54: 2, 55: 14, 56: 2, 57: 8, 58: 3,
    };
    for (const [id, count] of Object.entries(counts)) expect(communesOf(Number(id)), `wilaya ${id}`).toHaveLength(count);
  });

  it("names every place in French and in Arabic script", () => {
    for (const place of [...WILAYAS, ...COMMUNES]) {
      expect(place.name.trim(), JSON.stringify(place)).toBe(place.name);
      expect(place.name).toMatch(/^[\p{L}][\p{L}' -]*$/u);
      expect(place.nameAr).toMatch(/^[؀-ۿ ]+$/);
    }
  });

  it("puts the communes where the laws put them", () => {
    const at = (id: string) => [commune(id)?.name, commune(id)?.wilayaId];
    expect(at("c-07-007")).toEqual(["Besbes", 51]); // law 19-12: Ouled Djellal
    expect(at("c-08-012")).toEqual(["Tabelbala", 52]); // law 19-12: Béni Abbès
    expect(at("c-30-021")).toEqual(["El Borma", 55]); // law 19-12: Touggourt
    expect(at("c-01-009")).toEqual(["Timimoun", 49]);
    expect(at("c-12-015")).toEqual(["El Ogla El Malha", 62]); // law 26-06: Bir El Ater
    expect(at("c-28-034")?.[1]).toBe(68); // Mohamed Boudiaf (ex-Oued Chair): law 26-06, Bou Saâda
    expect(at("c-03-019")?.[1]).toBe(59); // Aflou
    expect(wilaya(59)?.name).toBe("Aflou");
    expect(wilaya(69)?.name).toBe("El Abiodh Sidi Cheikh");
  });

  it("has one place per id: the 2019 placeholder copies are gone", () => {
    for (const copy of ["c-49-001", "c-50-001", "c-51-001", "c-52-001", "c-53-001", "c-54-001", "c-55-001", "c-56-001", "c-57-001", "c-58-001"]) {
      expect(commune(copy)).toBeUndefined();
    }
  });
});

describe("a carrier's commune", () => {
  it("is found by any spelling a carrier uses, under any map's wilaya", () => {
    expect(communeNamed(7, "Besbes")?.id).toBe("c-07-007"); // the 1984 map
    expect(communeNamed(51, "Besbes")?.id).toBe("c-07-007"); // the 2019 map
    expect(communeNamed(3, "Aflou")?.id).toBe("c-03-019"); // carriers today
    expect(communeNamed(59, "Aflou")?.id).toBe("c-03-019"); // law 26-06
    expect(communeNamed(15, "Aït Yenni")?.id).toBe(communeNamed(15, "Beni Yenni")?.id);
    expect(communeNamed(16, "Bains Romains")?.name).toBe("El Hammamet");
    expect(communeNamed(55, "EL BORMA")?.id).toBe("c-30-021"); // Yalidine, as the law
    expect(communeNamed(30, "El Borma")?.id).toBe("c-30-021"); // ZR and NOEST, as before
  });

  it("is never one of another wilaya, and never a guess", () => {
    expect(communeNamed(7, "Besbes")).not.toEqual(communeNamed(36, "Besbes")); // El Tarf has its own Besbes
    expect(communeNamed(36, "Besbes")?.wilayaId).toBe(36);
    expect(communeNamed(16, "Besbes")).toBeNull();
    expect(communeNamed(3, "Aflo")).toBeNull();
    expect(communeNamed(99, "Aflou")).toBeNull();
  });

  it("has one meaning: no spelling belongs to two communes filed under one wilaya", () => {
    const owners = new Map<string, Set<string>>();
    for (const [id, wilayaId, name, , alsoUnder, spellings] of COMMUNE_ROWS) {
      for (const number of [wilayaId, ...alsoUnder]) {
        for (const spelling of [name, ...spellings]) {
          const k = `${number}:${placeKey(spelling)}`;
          owners.set(k, new Set([...(owners.get(k) ?? []), id]));
        }
      }
    }
    expect([...owners].filter(([, ids]) => ids.size > 1)).toEqual([]);
  });

  it("is compared without accents, case or punctuation, and nothing else", () => {
    expect(placeKey("Aïn M'Lila")).toBe(placeKey("ain mlila"));
    expect(placeKey("Bordj Bou-Arréridj")).toBe("bordjbouarreridj");
    expect(placeKey("Ain Mlila")).not.toBe(placeKey("Ain Milia"));
  });
});

describe("wilaya ids", () => {
  it("are 1 to 69", () => {
    expect(isWilayaId(1)).toBe(true);
    expect(isWilayaId(69)).toBe(true);
    expect(isWilayaId(0)).toBe(false);
    expect(isWilayaId(70)).toBe(false);
    expect(isWilayaId("16")).toBe(false);
    expect(isWilayaId(1.5)).toBe(false);
  });
});
