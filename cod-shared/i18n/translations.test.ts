import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  TRANSLATABLE,
  TRANSLATABLE_RESOURCES,
  overlayTranslations,
  sourceDigest,
  translatableField,
  translationView,
} from "./translations";

describe("the translatable registry", () => {
  it("knows each resource's fields, and nothing from Object.prototype", () => {
    expect(translatableField("product", "name")?.kind).toBe("text");
    expect(translatableField("product", "description")?.kind).toBe("html");
    for (const key of ["price", "handle", "id", "constructor", "__proto__", "toString"]) {
      expect(translatableField("product", key)).toBeNull();
    }
    expect(TRANSLATABLE_RESOURCES.sort()).toEqual(["category", "offer", "product", "store"]);
  });
});

describe("sourceDigest", () => {
  it("is SHA-256 hex, stable, and treats a missing source as empty", async () => {
    expect(await sourceDigest("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(await sourceDigest(null)).toBe(await sourceDigest(""));
    expect(await sourceDigest("هاتف")).toBe(await sourceDigest("هاتف"));
    expect(await sourceDigest("هاتف")).not.toBe(await sourceDigest("هاتف "));
  });
});

describe("overlayTranslations", () => {
  const productKeys = Object.keys(TRANSLATABLE.product);
  const record = fc.record({
    id: fc.constantFrom("p-1", "p-2", "p-3"),
    name: fc.string(),
    description: fc.option(fc.string(), { nil: null }),
    price: fc.integer(),
    handle: fc.string(),
  });
  const row = fc.record({
    resourceId: fc.constantFrom("p-1", "p-2", "p-3", "p-9"),
    key: fc.constantFrom("name", "description", "price", "handle", "constructor"),
    value: fc.string(),
  });

  it("replaces exactly the translated, translatable fields — everything else keeps its source", () => {
    fc.assert(
      fc.property(fc.uniqueArray(record, { selector: (r) => r.id }), fc.array(row), (records, rows) => {
        const result = overlayTranslations("product", records, rows);
        expect(result.map((r) => r.id)).toEqual(records.map((r) => r.id));
        result.forEach((translated, index) => {
          const source = records[index]!;
          for (const [key, value] of Object.entries(source)) {
            const last = rows.filter((r) => r.resourceId === source.id && r.key === key).at(-1);
            const expected = last !== undefined && productKeys.includes(key) ? last.value : value;
            expect((translated as Record<string, unknown>)[key]).toEqual(expected);
          }
          expect(Object.keys(translated).sort()).toEqual(Object.keys(source).sort());
        });
      }),
      { numRuns: 1000 },
    );
  });

  it("never mutates its input", () => {
    const records = [{ id: "p-1", name: "هاتف" }];
    overlayTranslations("product", records, [{ resourceId: "p-1", key: "name", value: "Téléphone" }]);
    expect(records[0]!.name).toBe("هاتف");
  });
});

describe("translationView", () => {
  it("pairs every translation with its source and flags the outdated ones", async () => {
    const view = await translationView(
      "product",
      { id: "p-1", name: "هاتف جديد", description: null, price: 100 },
      [
        { locale: "fr", key: "name", value: "Téléphone", sourceDigest: await sourceDigest("هاتف") },
        { locale: "fr", key: "description", value: "<p>D</p>", sourceDigest: await sourceDigest(null) },
        { locale: "en", key: "price", value: "1", sourceDigest: "x" },
      ],
    );
    expect(view).toEqual({
      source: { name: "هاتف جديد", description: null },
      translations: {
        fr: { name: { value: "Téléphone", outdated: true }, description: { value: "<p>D</p>", outdated: false } },
      },
    });
  });
});
