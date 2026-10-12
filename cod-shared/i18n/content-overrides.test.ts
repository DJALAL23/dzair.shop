import { describe, expect, it } from "vitest";
import { THEME_KEY_RE, groupOverrides } from "./content-overrides";

describe("THEME_KEY_RE", () => {
  it("accepts lowercase kebab-case keys up to 64 characters", () => {
    for (const key of ["theme-00", "aurora", "a1-b2-c3", "x".repeat(64)]) expect(THEME_KEY_RE.test(key)).toBe(true);
  });

  it("refuses anything else", () => {
    for (const key of ["", "Theme-00", "theme 00", "-theme", "theme-", "theme--00", "00-theme", "x".repeat(65)]) {
      expect(THEME_KEY_RE.test(key)).toBe(false);
    }
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
