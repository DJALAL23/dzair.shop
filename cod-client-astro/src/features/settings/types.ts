import type { MediaImage } from "../../../../cod-shared/media/model";
import type { ReviewAutoPublish, ReviewVoiceLength } from "../../../../cod-shared/reviews/model";
import type { StoreLocale } from "../../../../cod-shared/i18n/locales";
import type { LocaleRow, StoreLanguage } from "../../../../cod-shared/stores/settings";

export type { StoreLanguage };

/** A store language (`cod-shared/i18n/locales.ts`). */
export type StoreLang = StoreLocale;
export type StoreStatus = "active" | "inactive";

/** The single tenant's configuration as returned by the stores API. */
export interface StoreConfig {
  id: string;
  name: string;
  domain: string | null;
  logo: MediaImage | null;
  themeId: string;
  /** The primary language: the storefront's language and first fallback. */
  lang: StoreLang;
  /** Every language the store has added, primary first, published or not. */
  languages: StoreLanguage[];
  currency: string;
  currencySymbol: string;
  metaTitle: string | null;
  metaDescription: string | null;
  ogImage: MediaImage | null;
  reviewsEnabled: boolean;
  /** Photos a shopper may add to a review: 0 (none) to 6. */
  reviewMaxPhotos: number;
  /** Longest voice note a shopper may add, in seconds; null = no voice notes. */
  reviewVoiceMaxSeconds: ReviewVoiceLength | null;
  /** Which shopper reviews publish without the merchant checking them. */
  reviewAutoPublish: ReviewAutoPublish;
  /** Shopping cart opt-in. False keeps the storefront exactly as it is. */
  cartEnabled: boolean;
  /** Order subtotal (DZD) at or above which delivery is free. null = off. */
  freeShippingThreshold: number | null;
  /** Which rate a basket spanning several shipping profiles pays. */
  cartShippingMode: "highest" | "default_profile";
  status: StoreStatus;
  storeApiKey: string | null;
}

export type UpdateStoreData = Partial<
  Pick<
    StoreConfig,
    | "name"
    | "domain"
    | "lang"
    | "currencySymbol"
    | "metaTitle"
    | "metaDescription"
    | "reviewsEnabled"
    | "reviewMaxPhotos"
    | "reviewVoiceMaxSeconds"
    | "reviewAutoPublish"
    | "cartEnabled"
    | "freeShippingThreshold"
    | "cartShippingMode"
    | "status"
  >
> & {
  /** Replaces the store's languages; must publish the primary. */
  languages?: LocaleRow[];
};
