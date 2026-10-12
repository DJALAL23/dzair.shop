/**
 * `resolveContent` — the content-override contract.
 *
 * The merchant override blob (`stores.content_json`) arrives from the platform
 * as free-form JSON. These tests pin the rule the theme now enforces: the
 * override vocabulary is the pack's key set, values must be strings, and
 * anything else degrades to the pack instead of leaking into a component or
 * replacing a headline with a nested object.
 */
import { describe, expect, it, vi } from "vitest";
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
    const content = resolveContent("ar", JSON.stringify({ heroTitle: "عرض اليوم" }));

    expect(content.heroTitle).toBe("عرض اليوم");
    // Untouched keys survive the merge.
    expect(content.heroSubtitle).toBe(ar.heroSubtitle);
  });

  it("ignores the nested shape a live store carries", () => {
    // Captured from a live store config fixture: {"hero":{"title":…,"cta":…}}.
    // It matches no flat pack key; before this rule it was merged in as an
    // unknown key and silently did nothing (or worse, polluted the object).
    const nested = JSON.stringify({ hero: { title: "عرض اليوم", cta: "اطلب الآن" } });
    const content = resolveContent("ar", nested) as unknown as Record<string, unknown>;

    expect(content.heroTitle).toBe(ar.heroTitle);
    expect(content.hero).toBeUndefined();
  });

  it("ignores non-string values instead of rendering them", () => {
    const bad = JSON.stringify({ heroTitle: 42, heroSubtitle: null, promoTitle: ["a"] });
    const content = resolveContent("ar", bad);

    expect(content.heroTitle).toBe(ar.heroTitle);
    expect(content.heroSubtitle).toBe(ar.heroSubtitle);
    expect(content.promoTitle).toBe(ar.promoTitle);
  });

  it("ignores unknown keys", () => {
    const extra = JSON.stringify({ totallyUnknown: "x", heroTitle: "عنوان" });
    const content = resolveContent("ar", extra) as unknown as Record<string, unknown>;

    expect(content.totallyUnknown).toBeUndefined();
    expect(content.heroTitle).toBe("عنوان");
  });

  it("keeps an intentional empty string (a merchant clearing a headline)", () => {
    expect(resolveContent("ar", JSON.stringify({ heroEyebrow: "" })).heroEyebrow).toBe("");
  });

  it("falls back to the pack on malformed JSON", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const content = resolveContent("ar", "{not json");

    expect(content).toBe(ar);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
