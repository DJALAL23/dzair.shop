import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_STORE_LOCALE,
  STORE_LOCALES,
  STORE_LOCALE_INFO,
  isStoreLocale,
  localeChain,
  pickByLocale,
  storeLocales,
  textDirection,
  type StoreLocale,
} from "./locales";

const locale = fc.constantFrom(...STORE_LOCALES);

describe("the language registry", () => {
  it("describes every supported language exactly once", () => {
    expect(Object.keys(STORE_LOCALE_INFO).sort()).toEqual([...STORE_LOCALES].sort());
    for (const code of STORE_LOCALES) expect(STORE_LOCALE_INFO[code].code).toBe(code);
  });

  it("knows Arabic is right-to-left and the others are not", () => {
    expect(textDirection("ar")).toBe("rtl");
    expect(textDirection("fr")).toBe("ltr");
    expect(textDirection("en")).toBe("ltr");
  });

  it("accepts only supported codes", () => {
    expect(isStoreLocale("fr")).toBe(true);
    for (const value of ["FR", "fr-FR", "de", "", null, 1, "constructor"]) {
      expect(isStoreLocale(value)).toBe(false);
    }
  });

  it("defaults to a supported language", () => {
    expect(isStoreLocale(DEFAULT_STORE_LOCALE)).toBe(true);
  });
});

describe("storeLocales", () => {
  it("is the primary alone when nothing else is enabled", () => {
    expect(storeLocales("fr", null)).toEqual(["fr"]);
    expect(storeLocales("fr", [])).toEqual(["fr"]);
  });

  it("puts the primary first, then the others in registry order", () => {
    expect(storeLocales("en", ["fr", "ar", "en"])).toEqual(["en", "ar", "fr"]);
  });

  it("always serves the primary, drops unknown and repeated entries", () => {
    fc.assert(
      fc.property(locale, fc.array(fc.oneof(locale, fc.string(), fc.integer())), (primary, enabled) => {
        const result = storeLocales(primary, enabled);
        expect(result[0]).toBe(primary);
        expect(new Set(result).size).toBe(result.length);
        expect(result.every((code) => isStoreLocale(code))).toBe(true);
        for (const code of result.slice(1)) expect(enabled).toContain(code);
      }),
      { numRuns: 1000 },
    );
  });
});

describe("localeChain and pickByLocale", () => {
  it("looks at the requested language, then the primary, then the platform default", () => {
    expect(localeChain("en", "fr")).toEqual(["en", "fr", "ar"]);
    expect(localeChain("ar", "ar")).toEqual(["ar"]);
  });

  it("returns the first available value along the chain, then any, and says which", () => {
    fc.assert(
      fc.property(
        locale,
        locale,
        fc.subarray([...STORE_LOCALES]),
        (requested, primary, present) => {
          const available = new Map<StoreLocale, string>(present.map((code) => [code, `value-${code}`]));
          const picked = pickByLocale(available, localeChain(requested, primary));
          if (present.length === 0) {
            expect(picked).toBeNull();
            return;
          }
          const expected =
            localeChain(requested, primary).find((code) => available.has(code)) ??
            STORE_LOCALES.find((code) => available.has(code));
          expect(picked).toEqual({ locale: expected, value: `value-${expected}` });
        },
      ),
      { numRuns: 1000 },
    );
  });
});
