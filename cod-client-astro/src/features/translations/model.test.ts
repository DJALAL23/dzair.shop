import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TRANSLATABLE, TRANSLATABLE_RESOURCES } from "../../../../cod-shared/i18n/translations";
import { draftFor, languageInfo, patchFor, pendingCount, translationFields, translationsPath } from "./model";
import type { TranslationView } from "./types";

const view = (overrides: Partial<TranslationView> = {}): TranslationView => ({
  resource: "product",
  id: "p-1",
  sourceLocale: "ar",
  targetLocales: [{ locale: "fr", published: true }],
  source: { name: "هاتف", description: "<p>وصف</p>" },
  options: [],
  translations: { fr: { name: { value: "Téléphone", outdated: false } } },
  ...overrides,
});

const color = { name: "اللون", key: 'option:["اللون"]', values: [{ value: "أحمر", key: 'option:["اللون","أحمر"]' }] };
const withOptions = view({
  source: { name: "هاتف", description: null, [color.key]: "اللون", [color.values[0]!.key]: "أحمر" },
  options: [color],
});

describe("translationsPath", () => {
  it("routes each resource through its own router, encoding the id", () => {
    expect(translationsPath("product", "p/1")).toBe("/api/products/p%2F1/translations");
    expect(translationsPath("category", "c-1")).toBe("/api/product-groups/c-1/translations");
    expect(translationsPath("offer", "o-1")).toBe("/api/offers/o-1/translations");
    expect(translationsPath("store", "me")).toBe("/api/stores/me/translations");
    expect(translationsPath("menuItem", "i 1")).toBe("/api/menus/items/i%201/translations");
  });
});

describe("translationFields", () => {
  it("lists every translatable field, with the control its kind needs", () => {
    expect(translationFields(view()).map(({ key, control }) => [key, control])).toEqual([
      ["name", "input"],
      ["description", "rich"],
    ]);
    expect(translationFields(view({ resource: "category" })).find(({ key }) => key === "metaTitle")?.control).toBe("input");
    expect(translationFields(view({ resource: "store" })).find(({ key }) => key === "announcementBar")?.control).toBe("textarea");
  });

  it("follows the product's fields with each option's name and values, as short inputs", () => {
    expect(translationFields(withOptions).slice(2)).toEqual([
      { key: color.key, kind: "text", maxLength: 255, control: "input", part: { kind: "option", option: "اللون" } },
      { key: color.values[0]!.key, kind: "text", maxLength: 255, control: "input", part: { kind: "value", option: "اللون" } },
    ]);
  });

  it("drafts, patches and counts option fields like any other", () => {
    expect(draftFor(withOptions, "fr")).toEqual({ name: "Téléphone", description: "", [color.key]: "", [color.values[0]!.key]: "" });
    expect(pendingCount(withOptions, "fr")).toBe(2);
    expect(patchFor(withOptions, "fr", { ...draftFor(withOptions, "fr"), [color.values[0]!.key]: " Rouge " })).toEqual({
      locale: "fr",
      values: { [color.values[0]!.key]: "Rouge" },
    });
  });

  it("has a label for every translatable field in every dashboard language", () => {
    for (const lang of ["en", "ar", "fr"]) {
      const dict = JSON.parse(readFileSync(join(__dirname, `../../../locales/${lang}/translations.json`), "utf8"));
      for (const resource of TRANSLATABLE_RESOURCES) {
        for (const key of Object.keys(TRANSLATABLE[resource])) {
          expect(dict.fields?.[resource]?.[key], `${lang}: fields.${resource}.${key}`).toBeTruthy();
        }
      }
    }
  });
});

describe("draftFor / patchFor — a merge patch of one language", () => {
  it("starts from the stored translations, empty where there is none", () => {
    expect(draftFor(view(), "fr")).toEqual({ name: "Téléphone", description: "" });
    expect(draftFor(view(), "en")).toEqual({ name: "", description: "" });
  });

  it("sends nothing when nothing changed, whitespace included", () => {
    expect(patchFor(view(), "fr", { name: "Téléphone", description: "" })).toBeNull();
    expect(patchFor(view(), "fr", { name: "  Téléphone ", description: "   " })).toBeNull();
  });

  it("sends changed fields only, trimmed", () => {
    expect(patchFor(view(), "fr", { name: "Téléphone", description: " <p>Desc</p> " })).toEqual({
      locale: "fr",
      values: { description: "<p>Desc</p>" },
    });
  });

  it("removes a translation the editor cleared, and never removes one that does not exist", () => {
    expect(patchFor(view(), "fr", { name: "", description: "" })).toEqual({ locale: "fr", values: { name: null } });
    expect(patchFor(view(), "en", { name: "", description: "" })).toBeNull();
  });
});

describe("pendingCount", () => {
  it("counts fields with source text that are untranslated or outdated", () => {
    expect(pendingCount(view(), "fr")).toBe(1);
    const outdated = view({ translations: { fr: { name: { value: "T", outdated: true }, description: { value: "D", outdated: false } } } });
    expect(pendingCount(outdated, "fr")).toBe(1);
    expect(pendingCount(view({ source: { name: "هاتف", description: null } }), "fr")).toBe(0);
  });
});

describe("languageInfo", () => {
  it("comes from the shared registry", () => {
    expect(languageInfo("ar")).toMatchObject({ nativeName: "العربية", direction: "rtl" });
    expect(languageInfo("fr").direction).toBe("ltr");
  });
});
