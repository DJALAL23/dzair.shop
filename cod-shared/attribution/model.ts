/**
 * The words of order attribution (ADR 0026, attribution v2).
 *
 * A **touch** is one arrival on the store from outside it: the URL parameters
 * it carried, the page it landed on, the site that linked to it. The
 * storefront keeps three: the **first touch**, the **last paid touch** (the
 * latest arrival from an ad), and **this visit** (the latest arrival, an ad or
 * not, direct included). An order credits the last paid touch when its click
 * is at most `AD_CREDIT_WINDOW_DAYS` before the order; its **channel** is that
 * ad's, else this visit's.
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
  "gbraid",
  "wbraid",
] as const;

export type TouchParam = (typeof TOUCH_PARAMS)[number];

/**
 * The click ids a platform appends to its links, and the platform each names.
 * Meta adds `fbclid` to every link leaving Facebook and Instagram, an ad or
 * not; TikTok and Google add theirs to ad clicks only.
 */
export const CLICK_ID_PLATFORMS = { fbclid: "meta", ttclid: "tiktok", gclid: "google", gbraid: "google", wbraid: "google" } as const;

export type ClickIdType = keyof typeof CLICK_ID_PLATFORMS;

export const CLICK_ID_TYPES = Object.keys(CLICK_ID_PLATFORMS) as [ClickIdType, ...ClickIdType[]];

/** The click ids only an ad click carries. */
export const AD_ONLY_CLICK_IDS: readonly ClickIdType[] = ["ttclid", "gclid", "gbraid", "wbraid"];

/**
 * Who a touch came from. `referral` is another site, `direct` nothing at all,
 * `none` an order entered by staff, the API or the AI agent. `phone` is only
 * on rows written before attribution v2.
 */
export const ATTRIBUTION_PLATFORMS = ["meta", "tiktok", "google", "bing", "other", "referral", "direct", "none", "phone"] as const;

export type AttributionPlatform = (typeof ATTRIBUTION_PLATFORMS)[number];

/** How a row was made: from the shopper's visit, or for an order staff entered. `merchant` is only on rows written before v2. */
export const ATTRIBUTION_METHODS = ["captured", "entered", "merchant"] as const;

export type AttributionMethod = (typeof ATTRIBUTION_METHODS)[number];

/**
 * Where an order came from, as a person reads it. The visit channels follow
 * Google Analytics' default channel group; the last three are orders no
 * shopper's visit placed.
 */
export const ORDER_CHANNELS = [
  "paid_social",
  "paid_search",
  "paid_other",
  "organic_social",
  "organic_search",
  "email",
  "referral",
  "tagged",
  "direct",
  "dashboard",
  "api",
  "agent",
] as const;

export type OrderChannel = (typeof ORDER_CHANNELS)[number];

export const PAID_CHANNELS: readonly OrderChannel[] = ["paid_social", "paid_search", "paid_other"];

/** How long after a click an order still credits its ad: Meta's default 7-day click window. */
export const AD_CREDIT_WINDOW_DAYS = 7;

/** One arrival, as the storefront captured it. */
export interface Touch {
  /** When it landed, ISO 8601. */
  readonly at: string;
  readonly params: Readonly<Partial<Record<TouchParam, string>>>;
  /** The pathname it landed on, with its language prefix if it had one. */
  readonly path: string | null;
  /** The other site that linked to it, by host. Never the store's own. */
  readonly ref: string | null;
}

/** What a storefront sends with an order. */
export interface CapturedTouches {
  readonly first: Touch | null;
  /** The last paid touch. */
  readonly last: Touch | null;
  /** The latest arrival: how the shopper came to the store this time. */
  readonly visit: Touch | null;
}
