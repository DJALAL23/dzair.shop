import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { groupOverrides, isOverrideKey, isThemeKey, planOverridePatch } from "./content-overrides";

describe("isThemeKey", () => {
  it("accepts lowercase kebab-case keys up to 64 characters", () => {
    for (const key of ["theme-00", "aurora", "a1-b2-c3", "x".repeat(64)]) expect(isThemeKey(key)).toBe(true);
  });

  it("refuses anything else", () => {
    for (const key of ["", "Theme-00", "theme 00", "-theme", "theme-", "theme--00", "00-theme", "x".repeat(65), 7, null]) {
      expect(isThemeKey(key)).toBe(false);
    }
  });
});

describe("isOverrideKey", () => {
  it("refuses empty, over-long and prototype keys", () => {
    expect(isOverrideKey("heroTitle")).toBe(true);
    expect(isOverrideKey("x".repeat(100))).toBe(true);
    for (const key of ["", "x".repeat(101), "__proto__"]) expect(isOverrideKey(key)).toBe(false);
  });
});

describe("groupOverrides", () => {
  it("groups rows per language, in the order given, leaving other languages out", () => {
    const grouped = groupOverrides(
      [
        { locale: "ar", key: "heroTitle", value: "عنوان" },
        { locale: "en", key: "heroTitle", value: "Draft" },
        { locale: "fr", key: "heroTitle", value: "Titre" },
        { locale: "fr", key: "promo", value: "Promo" },
      ],
      ["fr", "ar"],
    );
    expect(grouped).toEqual({ fr: { heroTitle: "Titre", promo: "Promo" }, ar: { heroTitle: "عنوان" } });
    expect(Object.keys(grouped)).toEqual(["fr", "ar"]);
  });

  it("keeps a __proto__ row as data, never as a prototype", () => {
    const grouped = groupOverrides([{ locale: "ar", key: "__proto__", value: "x" }], ["ar"]);
    expect(Object.hasOwn(grouped.ar!, "__proto__")).toBe(true);
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });
});

describe("planOverridePatch — a JSON Merge Patch over one language", () => {
  const key = fc.constantFrom<string>("a", "b", "c", "d", "e");

  it("matches applying the patch to a plain map", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(key),
        fc.dictionary(key, fc.option(fc.string(), { nil: null })),
        (existing, patch) => {
          const plan = planOverridePatch(existing, patch);
          const after = new Set(existing);
          for (const [k, v] of Object.entries(patch)) v === null ? after.delete(k) : after.add(k);
          expect(plan.keyCount).toBe(after.size);
          expect(new Set(plan.set.map(([k]) => k))).toEqual(
            new Set(Object.entries(patch).filter(([, v]) => v !== null).map(([k]) => k)),
          );
          expect(new Set(plan.remove)).toEqual(
            new Set(Object.entries(patch).filter(([k, v]) => v === null && existing.includes(k)).map(([k]) => k)),
          );
        },
      ),
      { numRuns: 1000 },
    );
  });
});
