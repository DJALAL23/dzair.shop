// @vitest-environment node
/// <reference types="vitest/globals" />
/**
 * The home page in the store's language (ADR 0005), proven through the real
 * renderer. Saved copy can hold one value per language; switching the store's
 * language must switch every word on the page, never leave one section in the
 * old language next to a pack in the new one.
 */
import { describe, expect, it } from "vitest";
import type { LocalizedText } from "@wocart/theme";
import { theme00 } from "@/theme/theme";
import { ar } from "@/theme/content/ar";
import { fr } from "@/theme/content/fr";
import { fakeStorefront, renderSections } from "../support/home-render";

const storefront = fakeStorefront([]);

/** Text as Astro writes it into HTML (it escapes `& < > " '`). */
const html = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
const languages = { ar, fr } as const;

const renderHero = (locale: "ar" | "fr", heroTitle?: unknown) =>
  renderSections(
    [{ id: "h", type: "hero", ...(heroTitle === undefined ? {} : { props: { heroTitle: heroTitle as never } }) }],
    storefront,
    { locale, content: languages[locale] },
  );

describe("saved copy follows the store's language", () => {
  it("renders the saved translation for each language", async () => {
    const saved = { ar: "توصيل مجاني لكل الولايات", fr: "Livraison gratuite partout" };
    expect(await renderHero("ar", saved)).toContain(saved.ar);
    expect(await renderHero("fr", saved)).toContain(saved.fr);
  });

  it("switching to a language with no saved translation shows that language's pack, never the old text", async () => {
    const savedInArabicOnly = { ar: "توصيل مجاني لكل الولايات" };
    const french = await renderHero("fr", savedInArabicOnly);
    expect(french).not.toContain(savedInArabicOnly.ar);
    expect(french).toContain(html(fr.heroTitle));
  });

  it("the rest of the section follows the language too", async () => {
    const french = await renderHero("fr", { ar: "عنوان", fr: "Titre" });
    expect(french).toContain(html(fr.heroSubtitle));
    expect(french).not.toContain(html(ar.heroSubtitle));
  });

  it("a plain saved string means the same in every language (a brand name)", async () => {
    expect(await renderHero("ar", "CodFlow")).toContain("CodFlow");
    expect(await renderHero("fr", "CodFlow")).toContain("CodFlow");
  });
});

describe("the editor speaks every language the theme ships", () => {
  const isTranslated = (value: LocalizedText | undefined) =>
    typeof value === "object" && theme00.locales!.every((locale) => (value[locale] ?? "") !== "");

  it("declares the languages its packs cover", () => {
    expect(theme00.locales).toEqual(["ar", "fr", "en"]);
  });

  it("translates every section, group, field label and surface label", () => {
    const untranslated: string[] = [];
    for (const [type, definition] of Object.entries(theme00.components)) {
      if (!isTranslated(definition.label)) untranslated.push(`${type}.label`);
      if (!isTranslated(definition.group)) untranslated.push(`${type}.group`);
      for (const field of definition.fields ?? []) {
        if (!isTranslated(field.label)) untranslated.push(`${type}.${field.key}.label`);
      }
    }
    for (const surface of theme00.surfaces ?? []) {
      if (!isTranslated(surface.label)) untranslated.push(`surface ${surface.key}.label`);
    }
    expect(untranslated).toEqual([]);
  });
});
