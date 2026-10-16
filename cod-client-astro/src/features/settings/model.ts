import { REVIEW_MAX_PHOTOS, type ReviewVoiceLength } from "../../../../cod-shared/reviews/model";
import { BarChart2, Key, Languages, Mail, Palette, Search, Shield, ShieldCheck, ShoppingCart, Star, Store, Truck, type LucideIcon } from "lucide-react";
import { STORE_LOCALES, type StoreLocale } from "../../../../cod-shared/i18n/locales";
import type { StoreLanguage } from "./types";

export type CategoryId = "general" | "languages" | "branding" | "seo" | "cart" | "delivery" | "reviews" | "analytics" | "verification" | "bot_protection" | "email" | "api";

export interface SettingsCategory {
  id: CategoryId;
  icon: LucideIcon;
  /** Dot-path into the settings `store` namespace. */
  labelKey: string;
}

/** The settings categories, in sidebar order. */
export const SETTINGS_CATEGORIES: SettingsCategory[] = [
  { id: "general", icon: Store, labelKey: "general_title" },
  { id: "languages", icon: Languages, labelKey: "languages_title" },
  { id: "branding", icon: Palette, labelKey: "branding_title" },
  { id: "seo", icon: Search, labelKey: "seo_title" },
  { id: "cart", icon: ShoppingCart, labelKey: "cart_title" },
  { id: "delivery", icon: Truck, labelKey: "delivery_pricing_title" },
  { id: "reviews", icon: Star, labelKey: "reviews_title" },
  { id: "analytics", icon: BarChart2, labelKey: "tracking_title" },
  { id: "verification", icon: ShieldCheck, labelKey: "otp_title" },
  { id: "bot_protection", icon: Shield, labelKey: "bot_protection_title" },
  { id: "email", icon: Mail, labelKey: "email_title" },
  { id: "api", icon: Key, labelKey: "api_key_title" },
];

export function settingsErrorMessage(_cause: unknown, t: (key: string) => string) {
  return t("store.save_error");
}

/**
 * The store's languages while the merchant edits them (Settings → Languages).
 * The rules mirror the server's (`cod-shared/stores/settings.ts`): the
 * default language is always listed and published; the others are published
 * or drafts. The server re-checks every save.
 */
export interface LanguageDraft {
  primary: StoreLocale;
  languages: { locale: StoreLocale; published: boolean }[];
}

export function languageDraft(languages: readonly StoreLanguage[], primary: StoreLocale): LanguageDraft {
  return { primary, languages: languages.map(({ locale, published }) => ({ locale, published })) };
}

/** Languages the platform supports that the store has not added yet. */
export function addableLocales(draft: LanguageDraft): StoreLocale[] {
  return STORE_LOCALES.filter((locale) => !draft.languages.some((language) => language.locale === locale));
}

/** A new language starts unpublished, so it can be translated before shoppers see it. */
export function addLanguage(draft: LanguageDraft, locale: StoreLocale): LanguageDraft {
  if (draft.languages.some((language) => language.locale === locale)) return draft;
  return { ...draft, languages: [...draft.languages, { locale, published: false }] };
}

export function removeLanguage(draft: LanguageDraft, locale: StoreLocale): LanguageDraft {
  if (locale === draft.primary) return draft;
  return { ...draft, languages: draft.languages.filter((language) => language.locale !== locale) };
}

export function setPublished(draft: LanguageDraft, locale: StoreLocale, published: boolean): LanguageDraft {
  if (locale === draft.primary) return draft;
  return {
    ...draft,
    languages: draft.languages.map((language) => (language.locale === locale ? { ...language, published } : language)),
  };
}

/** The default language must be published; making one the default publishes it. */
export function makeDefault(draft: LanguageDraft, locale: StoreLocale): LanguageDraft {
  if (!draft.languages.some((language) => language.locale === locale)) return draft;
  return {
    primary: locale,
    languages: draft.languages.map((language) => (language.locale === locale ? { ...language, published: true } : language)),
  };
}

/** The `PATCH /api/stores/me` body for a language save. */
export function languagesPayload(draft: LanguageDraft): { lang: StoreLocale; languages: LanguageDraft["languages"] } {
  return { lang: draft.primary, languages: draft.languages };
}

// ─── Reviews ─────────────────────────────────────────────────────────────────

/** What a shopper may send with a review, as the merchant chooses it. */
export const SHOPPER_REVIEW_MEDIA = ["text", "photos", "voice", "photos_voice"] as const;
export type ShopperReviewMedia = (typeof SHOPPER_REVIEW_MEDIA)[number];

export function shopperReviewMedia(store: { reviewMaxPhotos: number; reviewVoiceMaxSeconds: number | null }): ShopperReviewMedia {
  const photos = store.reviewMaxPhotos > 0;
  const voice = store.reviewVoiceMaxSeconds !== null;
  return photos && voice ? "photos_voice" : photos ? "photos" : voice ? "voice" : "text";
}

/** The store columns a choice saves: photos and voice length kept only when the choice takes them. */
export function reviewMediaSettings(
  choice: ShopperReviewMedia,
  photos: number,
  voiceSeconds: ReviewVoiceLength,
): { reviewMaxPhotos: number; reviewVoiceMaxSeconds: ReviewVoiceLength | null } {
  return {
    reviewMaxPhotos: choice === "photos" || choice === "photos_voice" ? Math.min(Math.max(Math.trunc(photos), 1), REVIEW_MAX_PHOTOS) : 0,
    reviewVoiceMaxSeconds: choice === "voice" || choice === "photos_voice" ? voiceSeconds : null,
  };
}
