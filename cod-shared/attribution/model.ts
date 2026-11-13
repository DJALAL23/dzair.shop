/**
 * The words of order attribution (ADR 0026, attribution v2).
 *
 * A **touch** is one arrival on the store from outside it: the URL parameters
 * it carried, the page it landed on, the site that linked to it. The
 * storefront keeps four: the **first touch**; the **last paid touch** (the
 * latest arrival from an ad); the **last source** (the latest arrival that is
 * neither direct nor an ad); and **this visit** (the latest arrival, direct
 * included).
 *
 * An order's **source** is the ad it credits (the last paid touch, clicked at
 * most `AD_CREDIT_WINDOW_DAYS` before the order); else the last source, at
 * most `SOURCE_LOOKBACK_DAYS` old; else this visit. A direct visit never takes
 * the credit from where the shopper first came from, as Google Analytics,
 * Shopify and WooCommerce rule; an ad within its window never loses it.
 */

import { SIGNALS } from "./signals";

/** A URL parameter a touch keeps. Anything else in a URL is never read. */
export type TouchParam = keyof typeof SIGNALS;

/** What one signal says on its own (see `SIGNALS`). */
export interface Signal {
  readonly click?: true;
  readonly platform?: AttributionPlatform;
  readonly means?: "ad" | "organic";
  readonly kind?: "search" | "social";
}

const signal = (param: TouchParam): Signal => SIGNALS[param];

/** The URL parameters a touch keeps, in `SIGNALS`' order. */
export const TOUCH_PARAMS = Object.keys(SIGNALS) as [TouchParam, ...TouchParam[]];

/** The per-click ids among them. */
export type ClickIdType = { [K in TouchParam]: (typeof SIGNALS)[K] extends { click: true } ? K : never }[TouchParam];

export const CLICK_ID_TYPES = TOUCH_PARAMS.filter((param) => signal(param).click) as [ClickIdType, ...ClickIdType[]];

/** The parameters only an ad's URL carries. */
export const AD_PARAMS: readonly TouchParam[] = TOUCH_PARAMS.filter((param) => signal(param).means === "ad");

/** What a parameter says on its own. */
export function signalOf(param: TouchParam): Signal {
  return signal(param);
}

/**
 * Who a touch came from. `referral` is another site, `direct` nothing at all,
 * `none` an order entered by staff, the API or the AI agent. `phone` is only
 * on rows written before attribution v2.
 */
export const ATTRIBUTION_PLATFORMS = ["meta", "tiktok", "google", "bing", "snapchat", "other", "referral", "direct", "none", "phone"] as const;

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
  "ai_assistant",
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

/** How long a visit that was neither direct nor an ad stays an order's source: 30 days, the visits Shopify's order summary counts. */
export const SOURCE_LOOKBACK_DAYS = 30;

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
  /** The last arrival that was neither direct nor an ad. Absent from storefronts before `@wocart/storefront` 4.7.0. */
  readonly source?: Touch | null;
  /** The latest arrival: how the shopper came to the store this time. */
  readonly visit: Touch | null;
}
