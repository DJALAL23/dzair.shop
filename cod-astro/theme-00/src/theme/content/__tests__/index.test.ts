/**
 * `resolveContent` — the content-override contract.
 *
 * The store's overrides for the rendered language (`StoreConfig.contentOverrides[lang]`)
 * arrive parsed from the SDK. These tests pin the rule the theme enforces on
 * top: the override vocabulary is the pack's key set, values must be strings,
 * and anything else degrades to the pack instead of leaking into a component.
 */
import { describe, expect, it } from "vitest";
import { resolveContent, type SupportedLanguage } from "../index";
import { ar } from "../ar";
import { fr } from "../fr";

describe("resolveContent", () => {
  it("returns the pack for the requested language", () => {
    expect(resolveContent("fr").heroTitle).toBe(fr.heroTitle);
  });

  it("falls back to Arabic for a language the packs do not carry", () => {
    // The store's `lang` column is platform-owned; an unknown value must not
    // produce an undefined content object at render time.
    expect(resolveContent("de" as SupportedLanguage).heroTitle).toBe(ar.heroTitle);
  });

  it("applies a string override whose key the pack declares", () => {
    const content = resolveContent("ar", { heroTitle: "عرض اليوم" });

    expect(content.heroTitle).toBe("عرض اليوم");
    // Untouched keys survive the merge.
    expect(content.heroSubtitle).toBe(ar.heroSubtitle);
  });

  it("ignores a nested shape that matches no pack key", () => {
    const nested = { hero: { title: "عرض اليوم", cta: "اطلب الآن" } };
    const content = resolveContent("ar", nested) as unknown as Record<string, unknown>;

    expect(content.heroTitle).toBe(ar.heroTitle);
    expect(content.hero).toBeUndefined();
  });

  it("ignores non-string values instead of rendering them", () => {
    const bad = { heroTitle: 42, heroSubtitle: null, promoTitle: ["a"] };
    const content = resolveContent("ar", bad);

    expect(content.heroTitle).toBe(ar.heroTitle);
    expect(content.heroSubtitle).toBe(ar.heroSubtitle);
    expect(content.promoTitle).toBe(ar.promoTitle);
  });

  it("ignores unknown keys", () => {
    const extra = { totallyUnknown: "x", heroTitle: "عنوان" };
    const content = resolveContent("ar", extra) as unknown as Record<string, unknown>;

    expect(content.totallyUnknown).toBeUndefined();
    expect(content.heroTitle).toBe("عنوان");
  });

  it("keeps an intentional empty string (a merchant clearing a headline)", () => {
    expect(resolveContent("ar", { heroEyebrow: "" }).heroEyebrow).toBe("");
  });

  it("returns the pack itself when the language has no overrides", () => {
    expect(resolveContent("ar", undefined)).toBe(ar);
    expect(resolveContent("ar", null)).toBe(ar);
  });
});
