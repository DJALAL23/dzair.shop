import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { STORE_LOCALES, type StoreLocale } from "../i18n/locales";
import { planStoreLanguages, servedLanguageInfo, storeLanguages, type LocaleRow } from "./settings";

const locale = fc.constantFrom(...STORE_LOCALES);
const rows = fc
  .uniqueArray(fc.record({ locale, published: fc.boolean() }), { selector: (row) => row.locale })
  .map((list) => list as LocaleRow[]);

describe("storeLanguages", () => {
  it("lists the primary first and published, then the others in registry order", () => {
    expect(
      storeLanguages("fr", [
        { locale: "en", published: false },
        { locale: "ar", published: true },
      ]),
    ).toEqual([
      { locale: "fr", published: true, primary: true },
      { locale: "ar", published: true, primary: false },
      { locale: "en", published: false, primary: false },
    ]);
  });

  it("serves the primary even when its row is missing or unpublished, and drops unknown codes", () => {
    expect(
      storeLanguages("ar", [
        { locale: "ar", published: false },
        { locale: "de", published: true },
      ]),
    ).toEqual([{ locale: "ar", published: true, primary: true }]);
  });

  it("gives a storefront each served language's name and direction", () => {
    const languages = storeLanguages("ar", [{ locale: "fr", published: true }, { locale: "en", published: false }]);
    expect(servedLanguageInfo(languages)).toEqual([
      { code: "ar", nativeName: "العربية", direction: "rtl" },
      { code: "fr", nativeName: "Français", direction: "ltr" },
    ]);
  });
});

describe("planStoreLanguages", () => {
  it("leaves languages alone when a save does not mention them", () => {
    expect(planStoreLanguages({}, { lang: "ar", rows: [] })).toEqual({ ok: true, rows: null });
  });

  it("whatever is saved, the primary that results is listed first and published, or the save is refused", () => {
    fc.assert(
      fc.property(
        locale,
        rows,
        fc.record({ lang: locale, languages: rows.filter((list) => list.length > 0) }, { requiredKeys: [] }),
        (currentLang, currentRows, input) => {
          const plan = planStoreLanguages(input, { lang: currentLang, rows: currentRows });
          const primary: StoreLocale = input.lang ?? currentLang;
          const primaryPublished = input.languages?.find((row) => row.locale === primary)?.published === true;
          expect(plan.ok).toBe(input.languages === undefined || primaryPublished);
          if (!plan.ok) return;
          if (plan.rows === null) {
            expect(input).toEqual({});
            return;
          }
          expect(plan.rows[0]).toEqual({ locale: primary, published: true });
          expect(new Set(plan.rows.map((row) => row.locale)).size).toBe(plan.rows.length);
          const kept = input.languages ?? currentRows;
          for (const row of plan.rows.slice(1)) expect(kept).toContainEqual(row);
          for (const row of kept) if (row.locale !== primary) expect(plan.rows).toContainEqual(row);
        },
      ),
      { numRuns: 2000 },
    );
  });
});
