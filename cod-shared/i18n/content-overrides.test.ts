import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { CONTENT_OVERRIDE_LIMITS, overridesForLocales, parseContentOverrides } from "./content-overrides";

describe("parseContentOverrides", () => {
  it("reads one map per supported language", () => {
    expect(
      parseContentOverrides('{"ar":{"heroTitle":"توصيل مجاني"},"fr":{"heroTitle":"Livraison gratuite"}}'),
    ).toEqual({ ar: { heroTitle: "توصيل مجاني" }, fr: { heroTitle: "Livraison gratuite" } });
  });

  it.each([
    ["null", null],
    ["empty", ""],
    ["malformed JSON", "{"],
    ["an array", "[]"],
    ["a string", '"hello"'],
  ])("degrades %s to no overrides", (_name, json) => {
    expect(parseContentOverrides(json)).toEqual({});
  });

  it("drops unknown languages, non-string values, empty and over-long keys and values, and __proto__", () => {
    const long = "x".repeat(CONTENT_OVERRIDE_LIMITS.valueLength + 1);
    const parsed = parseContentOverrides(
      JSON.stringify({
        de: { heroTitle: "Kostenlos" },
        FR: { heroTitle: "Gratuit" },
        ar: { heroTitle: "عنوان", count: 3, nested: { a: "b" }, "": "empty key", long },
        fr: "not a map",
      }).replace('"ar":{', '"ar":{"__proto__":"polluted",'),
    );
    expect(parsed).toEqual({ ar: { heroTitle: "عنوان" } });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("never throws, and every kept value is a string under a supported language", () => {
    fc.assert(
      fc.property(fc.oneof(fc.string(), fc.json(), fc.jsonValue().map((v) => JSON.stringify(v))), (json) => {
        const parsed = parseContentOverrides(json);
        for (const [locale, entries] of Object.entries(parsed)) {
          expect(["ar", "fr", "en"]).toContain(locale);
          for (const value of Object.values(entries ?? {})) expect(typeof value).toBe("string");
        }
      }),
      { numRuns: 2000 },
    );
  });

  it("caps the number of keys per language", () => {
    const many = Object.fromEntries(
      Array.from({ length: CONTENT_OVERRIDE_LIMITS.keysPerLocale + 5 }, (_, i) => [`k${i}`, "v"]),
    );
    const parsed = parseContentOverrides(JSON.stringify({ ar: many }));
    expect(Object.keys(parsed.ar ?? {})).toHaveLength(CONTENT_OVERRIDE_LIMITS.keysPerLocale);
  });
});

describe("overridesForLocales", () => {
  it("keeps only the languages a store serves", () => {
    expect(
      overridesForLocales({ ar: { a: "1" }, fr: { a: "2" }, en: { a: "3" } }, ["fr", "ar"]),
    ).toEqual({ fr: { a: "2" }, ar: { a: "1" } });
  });
});
