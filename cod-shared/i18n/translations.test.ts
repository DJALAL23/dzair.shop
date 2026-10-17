import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  TRANSLATABLE,
  TRANSLATABLE_RESOURCES,
  indistinctOptions,
  optionKey,
  overlayTranslations,
  parseVariantOptions,
  sourceDigest,
  translatableField,
  translatableSources,
  translateOptions,
  translationView,
  variantLabel,
  type VariantOption,
} from "./translations";

describe("the translatable registry", () => {
  it("knows each resource's fields, and nothing from Object.prototype", () => {
    expect(translatableField("product", "name")?.kind).toBe("text");
    expect(translatableField("product", "description")?.kind).toBe("html");
    for (const key of ["price", "handle", "id", "constructor", "__proto__", "toString"]) {
      expect(translatableField("product", key)).toBeNull();
    }
    expect(TRANSLATABLE_RESOURCES.sort()).toEqual(["category", "menuItem", "offer", "product", "store"]);
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
      options: [],
      translations: {
        fr: { name: { value: "Téléphone", outdated: true }, description: { value: "<p>D</p>", outdated: false } },
      },
    });
  });
});

const shirt: VariantOption[] = [
  { name: "اللون", values: [{ value: "أحمر", hexColor: "#f00" }, { value: "أزرق" }] },
  { name: "المقاس", values: [{ value: "M" }, { value: "XL" }] },
];

describe("option keys", () => {
  it("never give two different names, or name-value pairs, the same key", () => {
    fc.assert(
      fc.property(fc.string(), fc.option(fc.string(), { nil: undefined }), fc.string(), fc.option(fc.string(), { nil: undefined }), (a, av, b, bv) => {
        if (a === b && av === bv) return;
        expect(optionKey(a, av)).not.toBe(optionKey(b, bv));
      }),
      { numRuns: 2000 },
    );
    expect(optionKey("Size/Color", "M")).not.toBe(optionKey("Size", "Color/M"));
  });

  it("are never a registry field, so the field overlay cannot spread them onto a product", () => {
    expect(translatableField("product", optionKey("Color"))).toBeNull();
    expect(overlayTranslations("product", [{ id: "p", name: "x" }], [{ resourceId: "p", key: optionKey("Color"), value: "Couleur" }])).toEqual([
      { id: "p", name: "x" },
    ]);
  });
});

describe("parseVariantOptions", () => {
  it("reads stored JSON or an array, and reads anything malformed as no options", () => {
    expect(parseVariantOptions(JSON.stringify(shirt))).toEqual(shirt);
    expect(parseVariantOptions(shirt)).toEqual(shirt);
    for (const raw of [null, undefined, "", "{", "{}", "[1]", JSON.stringify([{ name: "x" }]), JSON.stringify([{ name: "x", values: [{}] }])]) {
      expect(parseVariantOptions(raw)).toEqual([]);
    }
  });
});

describe("translatableSources", () => {
  it("adds a product's option names and values to its registry fields", () => {
    const fields = translatableSources("product", { name: "قميص", description: null, variantOptions: JSON.stringify(shirt) });
    expect(fields.map(({ key, source, field }) => [key, source, field.maxLength])).toEqual([
      ["name", "قميص", 255],
      ["description", null, TRANSLATABLE.product.description.maxLength],
      [optionKey("اللون"), "اللون", 255],
      [optionKey("اللون", "أحمر"), "أحمر", 255],
      [optionKey("اللون", "أزرق"), "أزرق", 255],
      [optionKey("المقاس"), "المقاس", 255],
      [optionKey("المقاس", "M"), "M", 255],
      [optionKey("المقاس", "XL"), "XL", 255],
    ]);
  });

  it("gives no other resource option fields", () => {
    expect(translatableSources("category", { name: "x", variantOptions: JSON.stringify(shirt) }).map(({ key }) => key)).toEqual(
      Object.keys(TRANSLATABLE.category),
    );
  });
});

describe("translateOptions", () => {
  const french = {
    [optionKey("اللون")]: "Couleur",
    [optionKey("اللون", "أحمر")]: "Rouge",
    [optionKey("المقاس", "XL")]: "TG",
  };

  it("translates names and values field by field, keeping colours and untranslated text", () => {
    const { options, variations } = translateOptions(shirt, french);
    expect(options).toEqual([
      { name: "Couleur", values: [{ value: "Rouge", hexColor: "#f00" }, { value: "أزرق" }] },
      { name: "المقاس", values: [{ value: "M" }, { value: "TG" }] },
    ]);
    expect(variations({ اللون: "أحمر", المقاس: "XL" })).toEqual({ Couleur: "Rouge", المقاس: "TG" });
    expect(variantLabel(variations({ اللون: "أحمر", المقاس: "XL" }))).toBe("Rouge / TG");
  });

  it("keeps a set in its source text when a translation would make two read the same", () => {
    const clash = { ...french, [optionKey("المقاس")]: "Couleur", [optionKey("اللون", "أزرق")]: "Rouge" };
    expect(indistinctOptions(shirt, clash)).toEqual([null, "اللون"]);
    const { options, variations } = translateOptions(shirt, clash);
    expect(options.map((option) => option.name)).toEqual(["اللون", "المقاس"]);
    expect(options[0]!.values.map(({ value }) => value)).toEqual(["أحمر", "أزرق"]);
    expect(options[1]!.values.map(({ value }) => value)).toEqual(["M", "TG"]);
    expect(variations({ اللون: "أزرق", المقاس: "XL" })).toEqual({ اللون: "أزرق", المقاس: "TG" });
  });

  it("leaves an option or value it does not know as it is", () => {
    expect(translateOptions(shirt, french).variations({ Material: "Coton", اللون: "أخضر" })).toEqual({ Material: "Coton", Couleur: "أخضر" });
  });

  const optionsArb = fc
    .uniqueArray(fc.string({ maxLength: 3 }), { minLength: 1, maxLength: 3 })
    .chain((names) =>
      fc.tuple(...names.map((name) => fc.uniqueArray(fc.string({ maxLength: 3 }), { minLength: 1, maxLength: 4 }).map((values) => ({ name, values: values.map((value) => ({ value })) })))),
    );

  it("keeps every variant findable: a selection matches the translated options exactly when it matched the source", () => {
    fc.assert(
      fc.property(
        optionsArb,
        fc.dictionary(fc.string({ maxLength: 3 }), fc.string({ maxLength: 3 })),
        fc.array(fc.nat(), { maxLength: 3 }),
        (options, words, picks) => {
          const translated: Record<string, string> = {};
          options.forEach((option, index) => {
            const name = words[option.name];
            if (name !== undefined) translated[optionKey(option.name)] = name;
            option.values.forEach(({ value }) => {
              const text = words[`${index}:${value}`] ?? words[value];
              if (text !== undefined) translated[optionKey(option.name, value)] = text;
            });
          });
          const served = translateOptions(options, translated);
          const selection = Object.fromEntries(options.map((option, index) => [option.name, option.values[(picks[index] ?? 0) % option.values.length]!.value]));
          const renamed = served.variations(selection);
          expect(Object.keys(renamed).sort()).toEqual(served.options.map((option) => option.name).sort());
          served.options.forEach((option, index) => {
            const chosen = renamed[option.name]!;
            expect(option.values.filter(({ value }) => value === chosen)).toHaveLength(1);
            expect(option.values.findIndex(({ value }) => value === chosen)).toBe(
              options[index]!.values.findIndex(({ value }) => value === selection[options[index]!.name]),
            );
          });
          expect(new Set(served.options.map((option) => option.name)).size).toBe(options.length);
        },
      ),
      { numRuns: 2000 },
    );
  });

  it("never reads Object.prototype as a translation", () => {
    expect(translateOptions([{ name: "constructor", values: [{ value: "toString" }] }], {}).options).toEqual([
      { name: "constructor", values: [{ value: "toString" }] },
    ]);
  });
});

describe("translationView — options", () => {
  it("lists a product's options with their keys and pairs option translations with their source", async () => {
    const view = await translationView("product", { id: "p", name: "قميص", description: null, variantOptions: JSON.stringify(shirt) }, [
      { locale: "fr", key: optionKey("اللون", "أحمر"), value: "Rouge", sourceDigest: await sourceDigest("أحمر") },
      { locale: "fr", key: optionKey("Ancien"), value: "Old", sourceDigest: await sourceDigest("Ancien") },
    ]);
    expect(view.options[0]).toEqual({
      name: "اللون",
      key: optionKey("اللون"),
      values: [
        { value: "أحمر", key: optionKey("اللون", "أحمر") },
        { value: "أزرق", key: optionKey("اللون", "أزرق") },
      ],
    });
    expect(view.source[optionKey("المقاس", "XL")]).toBe("XL");
    expect(view.translations).toEqual({ fr: { [optionKey("اللون", "أحمر")]: { value: "Rouge", outdated: false } } });
  });
});
