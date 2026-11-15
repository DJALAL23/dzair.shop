/**
 * The URL parameters a touch keeps, and what each one says on its own. One
 * table: the touch parameters, the click ids, the ad rule and the platform a
 * click names are all read from it. The storefront SDK carries the same table
 * (`@wocart/storefront`, `signals.ts`); its parity check compares them entry by
 * entry, so adding a platform is one row on each side.
 *
 * - `click`: a per-click id, kept byte for byte up to 1,000 characters.
 * - `platform`: who adds it.
 * - `means`: `ad` when only an ad's URL carries it, `organic` when only a free
 *   listing's does; absent when it says nothing about paid or not on its own
 *   (`fbclid` is added to every link leaving Facebook and Instagram).
 * - `kind`: the channel family a click from it belongs to.
 *
 * Sources: Google Ads' `gad_*` parameters (support.google.com/google-ads/answer/16193746),
 * Merchant Center's `srsltid` (support.google.com/analytics/answer/11479699),
 * Snap's `ScCid` (developers.snap.com, Conversions API parameters), GA4's
 * manual tags (support.google.com/analytics/answer/11242870), and the click
 * ids PostHog and AnyTrack read.
 */
export const SIGNALS = {
  utm_source: {},
  utm_medium: {},
  utm_campaign: {},
  utm_term: {},
  utm_content: {},
  utm_id: {},
  utm_source_platform: {},
  wc_cn: { means: "ad" },
  wc_an: { means: "ad" },
  wc_pl: {},
  wc_ss: {},
  fbclid: { click: true, platform: "meta", kind: "social" },
  ttclid: { click: true, platform: "tiktok", means: "ad", kind: "social" },
  gclid: { click: true, platform: "google", means: "ad", kind: "search" },
  gbraid: { click: true, platform: "google", means: "ad", kind: "search" },
  wbraid: { click: true, platform: "google", means: "ad", kind: "search" },
  gad_source: { platform: "google", means: "ad" },
  gad_campaignid: { platform: "google", means: "ad" },
  msclkid: { click: true, platform: "bing", means: "ad", kind: "search" },
  ScCid: { click: true, platform: "snapchat", means: "ad", kind: "social" },
  sccid: { click: true, platform: "snapchat", means: "ad", kind: "social" },
  srsltid: { click: true, platform: "google", means: "organic", kind: "search" },
} as const;
