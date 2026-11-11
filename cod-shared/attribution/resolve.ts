/**
 * Which touch an order credits, and what it says: the platform, the click,
 * the ad ids and the landing page. Pure: the storefront's touches and the
 * order's `fbc` in, one `order_attribution` row out (ADR 0026).
 */
import { STORE_LOCALES } from "../i18n/locales";
import { matchStorefrontPath } from "../storefront/routes";
import { CLICK_ID_PLATFORMS, type AttributionPlatform, type CapturedTouches, type ClickIdType, type Touch } from "./model";
import { metaClickId } from "./meta-ids";
import type { orderAttribution } from "../db/schema";

export type OrderAttributionRow = typeof orderAttribution.$inferInsert;

const AD_ID = /^\d{1,32}$/;
const SITE_SOURCE = /^[a-z0-9_]{1,16}$/;
const MAX_PLACEMENT_LENGTH = 64;

const SOURCE_PLATFORMS: Readonly<Record<string, AttributionPlatform>> = {
  facebook: "meta",
  fb: "meta",
  instagram: "meta",
  ig: "meta",
  messenger: "meta",
  meta: "meta",
  whatsapp: "meta",
  threads: "meta",
  tiktok: "tiktok",
  google: "google",
};

/** Meta's `{{site_source_name}}`: Facebook, Instagram, Messenger, Audience Network, Threads. */
const META_SITE_SOURCES = new Set(["fb", "ig", "msg", "an", "th"]);

const REFERRER_PLATFORMS: ReadonlyArray<readonly [string, AttributionPlatform]> = [
  ["facebook.com", "meta"],
  ["fb.com", "meta"],
  ["instagram.com", "meta"],
  ["messenger.com", "meta"],
  ["whatsapp.com", "meta"],
  ["threads.net", "meta"],
  ["tiktok.com", "tiktok"],
  ["google.com", "google"],
];

function referrerPlatform(host: string): AttributionPlatform {
  for (const [domain, platform] of REFERRER_PLATFORMS) {
    if (host === domain || host.endsWith(`.${domain}`)) return platform;
  }
  if (/(^|\.)google\.[a-z.]+$/.test(host)) return "google";
  return "referral";
}

function clickOf(touch: Touch): { type: ClickIdType; id: string } | null {
  for (const type of Object.keys(CLICK_ID_PLATFORMS) as ClickIdType[]) {
    const id = touch.params[type];
    if (id) return { type, id };
  }
  return null;
}

function platformOf(touch: Touch): AttributionPlatform {
  const click = clickOf(touch);
  if (click) return CLICK_ID_PLATFORMS[click.type];
  const siteSource = touch.params.wc_ss?.toLowerCase();
  if (siteSource && META_SITE_SOURCES.has(siteSource)) return "meta";
  const source = touch.params.utm_source?.toLowerCase();
  if (source) return SOURCE_PLATFORMS[source] ?? "other";
  if (Object.keys(touch.params).length > 0) return "other";
  return touch.ref ? referrerPlatform(touch.ref) : "direct";
}

function adId(value: string | undefined): string | null {
  return value && AD_ID.test(value) ? value : null;
}

/** The pathname without a leading language segment: `/fr/products/robe` is the product page. */
function unprefixed(path: string): string {
  const [, first, ...rest] = path.split("/");
  return (STORE_LOCALES as readonly string[]).includes(first ?? "") ? `/${rest.join("/")}` : path;
}

/** The page type a landing path is, and its slug when it is a landing page. */
export function landingOf(path: string | null): { type: string | null; landingSlug: string | null } {
  if (!path) return { type: null, landingSlug: null };
  const match = matchStorefrontPath(unprefixed(path));
  if (!match) return { type: null, landingSlug: null };
  return { type: match.type, landingSlug: match.type === "landing" ? (match.params.slug ?? null) : null };
}

/** The touch an order credits: the last ad touch, else the first touch. */
export function creditedTouch(touches: CapturedTouches | null): Touch | null {
  return touches?.last ?? touches?.first ?? null;
}

/** The click an `_fbc` names, and when it was made, for an order whose visit left no touch. */
function fbcClick(fbc: string | null | undefined): { id: string; at: string } | null {
  const value = metaClickId(fbc);
  if (!value) return null;
  const [, , created, id] = value.split(".");
  const ms = Number(created);
  return id ? { id, at: new Date(ms).toISOString() } : null;
}

/**
 * The `order_attribution` row of a storefront order, or null when its visit
 * left nothing to credit. With no touch, a well-formed `_fbc` still names the
 * Meta click and its time.
 */
export function capturedAttributionRow(
  orderId: string,
  touches: CapturedTouches | null,
  context: { fbc?: string | null; now: string },
): OrderAttributionRow | null {
  const touch = creditedTouch(touches);
  const first = touches?.first ?? null;
  const base = { orderId, method: "captured" as const, createdAt: context.now, updatedAt: context.now };

  if (!touch) {
    const click = fbcClick(context.fbc);
    if (!click) return null;
    return { ...base, capturedAt: click.at, platform: "meta", clickId: click.id, clickIdType: "fbclid" };
  }

  const { params } = touch;
  const click = clickOf(touch);
  const names = { campaign: params.wc_cn, ad: params.wc_an };
  const placement = params.wc_pl && params.wc_pl.length <= MAX_PLACEMENT_LENGTH ? params.wc_pl : null;
  const siteSource = params.wc_ss?.toLowerCase();
  return {
    ...base,
    capturedAt: touch.at,
    platform: platformOf(touch),
    clickId: click?.id ?? null,
    clickIdType: click?.type ?? null,
    campaignId: adId(params.utm_campaign),
    adsetId: adId(params.utm_term),
    adId: adId(params.utm_content),
    placement,
    siteSource: siteSource && SITE_SOURCE.test(siteSource) ? siteSource : null,
    utmSource: params.utm_source ?? null,
    utmMedium: params.utm_medium ?? null,
    utmCampaign: params.utm_campaign ?? null,
    utmTerm: params.utm_term ?? null,
    utmContent: params.utm_content ?? null,
    namesJson: names.campaign || names.ad ? JSON.stringify(names) : null,
    landingPath: touch.path,
    landingPageType: landingOf(touch.path).type,
    referrerHost: touch.ref,
    firstTouchAt: first?.at ?? null,
    firstTouchJson: first ? JSON.stringify(first) : null,
  };
}
