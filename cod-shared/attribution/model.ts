/**
 * The words of order attribution (ADR 0026).
 *
 * A **touch** is one visit that arrived with something worth crediting: the
 * URL parameters of an ad or a tagged link, the page it landed on, the site
 * that referred it. The storefront keeps two: the **first touch** of the
 * visit history and the **last ad touch**, the latest one whose URL carried
 * an ad parameter. The order credits the last ad touch, else the first.
 */

/** The URL parameters a touch keeps. Anything else in a URL is never read. */
export const TOUCH_PARAMS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "wc_cn",
  "wc_an",
  "wc_pl",
  "wc_ss",
  "fbclid",
  "ttclid",
  "gclid",
] as const;

export type TouchParam = (typeof TOUCH_PARAMS)[number];

/** The click ids an ad platform appends to its links, and the platform each names. */
export const CLICK_ID_PLATFORMS = { fbclid: "meta", ttclid: "tiktok", gclid: "google" } as const;

export type ClickIdType = keyof typeof CLICK_ID_PLATFORMS;

export const CLICK_ID_TYPES = Object.keys(CLICK_ID_PLATFORMS) as [ClickIdType, ...ClickIdType[]];

/**
 * Where an order came from. `referral` is another site's link, `direct` a
 * visit with nothing to credit, `phone` an order the merchant took by phone.
 */
export const ATTRIBUTION_PLATFORMS = ["meta", "tiktok", "google", "other", "referral", "direct", "phone"] as const;

export type AttributionPlatform = (typeof ATTRIBUTION_PLATFORMS)[number];

export const ATTRIBUTION_METHODS = ["captured", "merchant"] as const;

export type AttributionMethod = (typeof ATTRIBUTION_METHODS)[number];

/** One visit worth crediting, as the storefront captured it. */
export interface Touch {
  /** When the visit landed, ISO 8601. */
  readonly at: string;
  readonly params: Readonly<Partial<Record<TouchParam, string>>>;
  /** The pathname it landed on, with its language prefix if it had one. */
  readonly path: string | null;
  /** The other site that linked to it, by host. Never the store's own. */
  readonly ref: string | null;
}

/** What a storefront sends with an order: its visit's two touches. */
export interface CapturedTouches {
  readonly first: Touch | null;
  readonly last: Touch | null;
}
