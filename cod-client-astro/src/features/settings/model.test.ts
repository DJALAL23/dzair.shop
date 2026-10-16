import { describe, expect, it } from "vitest";
import { SETTINGS_CATEGORIES, settingsErrorMessage, reviewMediaSettings, shopperReviewMedia } from "./model";

const t = (key: string) => key;

describe("settings model", () => {
  it("exposes the categories in sidebar order", () => {
    expect(SETTINGS_CATEGORIES.map((category) => category.id)).toEqual([
      "general",
      "languages",
      "branding",
      "seo",
      "cart",
      "delivery",
      "reviews",
      "analytics",
      "verification",
      "bot_protection",
      "email",
      "api",
    ]);

    // Keyed by id rather than by index: inserting a category should require
    // updating the order above and nothing else, instead of renumbering every
    // assertion underneath it.
    const labelById = Object.fromEntries(
      SETTINGS_CATEGORIES.map((category) => [category.id, category.labelKey]),
    );
    expect(labelById).toMatchObject({
      general: "general_title",
      cart: "cart_title",
      delivery: "delivery_pricing_title",
      verification: "otp_title",
      bot_protection: "bot_protection_title",
      email: "email_title",
      api: "api_key_title",
    });
  });

  it("maps every save failure to the store save error", () => {
    expect(settingsErrorMessage({ code: "VALIDATION_FAILED" }, t)).toBe("store.save_error");
    expect(settingsErrorMessage(new Error("boom"), t)).toBe("store.save_error");
  });
});

import { STORE_LOCALES, type StoreLocale } from "../../../../cod-shared/i18n/locales";
import {
  addLanguage,
  addableLocales,
  languagesPayload,
  makeDefault,
  removeLanguage,
  setPublished,
  type LanguageDraft,
} from "./model";

/** Every draft a store can be in: any default, any set of other languages, any publish state. */
function everyDraft(): LanguageDraft[] {
  const drafts: LanguageDraft[] = [];
  for (const primary of STORE_LOCALES) {
    const others = STORE_LOCALES.filter((locale) => locale !== primary);
    // Each other language is absent, a draft, or published: 3^n combinations.
    for (let mask = 0; mask < 3 ** others.length; mask++) {
      const languages: LanguageDraft["languages"] = [{ locale: primary, published: true }];
      others.forEach((locale, index) => {
        const state = Math.floor(mask / 3 ** index) % 3;
        if (state > 0) languages.push({ locale, published: state === 2 });
      });
      drafts.push({ primary, languages });
    }
  }
  return drafts;
}

/** What every save must satisfy — the same rule the server enforces. */
function expectValid(draft: LanguageDraft) {
  const locales = draft.languages.map((language) => language.locale);
  expect(new Set(locales).size).toBe(locales.length);
  expect(draft.languages.find((language) => language.locale === draft.primary)?.published).toBe(true);
}

describe("editing the store's languages", () => {
  const drafts = everyDraft();
  const operations: [string, (draft: LanguageDraft, locale: StoreLocale) => LanguageDraft][] = [
    ["add", addLanguage],
    ["remove", removeLanguage],
    ["publish", (draft, locale) => setPublished(draft, locale, true)],
    ["unpublish", (draft, locale) => setPublished(draft, locale, false)],
    ["make default", makeDefault],
  ];

  it("covers every reachable state", () => {
    expect(drafts).toHaveLength(27);
  });

  it.each(operations)("%s always leaves a draft the server accepts", (_name, operation) => {
    for (const draft of drafts) {
      for (const locale of STORE_LOCALES) expectValid(operation(draft, locale));
    }
  });

  it("adds a language unpublished, and only one the store does not have", () => {
    const draft: LanguageDraft = { primary: "ar", languages: [{ locale: "ar", published: true }] };
    expect(addableLocales(draft)).toEqual(["fr", "en"]);
    const added = addLanguage(draft, "fr");
    expect(added.languages).toEqual([
      { locale: "ar", published: true },
      { locale: "fr", published: false },
    ]);
    expect(addLanguage(added, "fr")).toBe(added);
    expect(addableLocales(added)).toEqual(["en"]);
  });

  it("never removes or unpublishes the default", () => {
    for (const draft of drafts) {
      expect(removeLanguage(draft, draft.primary)).toBe(draft);
      expect(setPublished(draft, draft.primary, false)).toBe(draft);
    }
  });

  it("publishes a language when it becomes the default, keeping the old default", () => {
    const draft: LanguageDraft = {
      primary: "ar",
      languages: [
        { locale: "ar", published: true },
        { locale: "fr", published: false },
      ],
    };
    expect(makeDefault(draft, "fr")).toEqual({
      primary: "fr",
      languages: [
        { locale: "ar", published: true },
        { locale: "fr", published: true },
      ],
    });
    expect(makeDefault(draft, "en")).toBe(draft);
  });

  it("saves the default and the whole list", () => {
    const draft: LanguageDraft = { primary: "fr", languages: [{ locale: "fr", published: true }] };
    expect(languagesPayload(draft)).toEqual({ lang: "fr", languages: [{ locale: "fr", published: true }] });
  });
});

describe("what shoppers can send with a review", () => {
  it("is read from the store's photo and voice settings", () => {
    expect(shopperReviewMedia({ reviewMaxPhotos: 0, reviewVoiceMaxSeconds: null })).toBe("text");
    expect(shopperReviewMedia({ reviewMaxPhotos: 3, reviewVoiceMaxSeconds: null })).toBe("photos");
    expect(shopperReviewMedia({ reviewMaxPhotos: 0, reviewVoiceMaxSeconds: 60 })).toBe("voice");
    expect(shopperReviewMedia({ reviewMaxPhotos: 2, reviewVoiceMaxSeconds: 30 })).toBe("photos_voice");
  });

  it("saves only what the choice takes, within the limits", () => {
    expect(reviewMediaSettings("text", 4, 90)).toEqual({ reviewMaxPhotos: 0, reviewVoiceMaxSeconds: null });
    expect(reviewMediaSettings("photos", 4, 90)).toEqual({ reviewMaxPhotos: 4, reviewVoiceMaxSeconds: null });
    expect(reviewMediaSettings("voice", 4, 90)).toEqual({ reviewMaxPhotos: 0, reviewVoiceMaxSeconds: 90 });
    expect(reviewMediaSettings("photos_voice", 9, 120)).toEqual({ reviewMaxPhotos: 6, reviewVoiceMaxSeconds: 120 });
    expect(reviewMediaSettings("photos", 0, 30)).toEqual({ reviewMaxPhotos: 1, reviewVoiceMaxSeconds: null });
  });
});
