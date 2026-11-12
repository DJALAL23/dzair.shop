/**
 * What an order's attribution says: the ad it credits (the last paid touch,
 * within the click window), how the shopper came this time, and the order's
 * channel. Pure: the storefront's touches in, one `order_attribution` row
 * out (ADR 0026, attribution v2). The `_fbc` cookie never decides anything
 * here; it is only passed on to Meta.
 */
import { STORE_LOCALES } from "../i18n/locales";
import { matchStorefrontPath } from "../storefront/routes";
import type { Origin } from "../events/actor";
import { classifyTouch, isPaidTouch } from "./channel";
import { AD_CREDIT_WINDOW_DAYS, CLICK_ID_TYPES, type CapturedTouches, type ClickIdType, type OrderChannel, type Touch } from "./model";
import type { orderAttribution } from "../db/schema";

export type OrderAttributionRow = typeof orderAttribution.$inferInsert;

const AD_ID = /^\d{1,32}$/;
const MAX_PLACEMENT_LENGTH = 64;
const WINDOW_MS = AD_CREDIT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
const FUTURE_SKEW_MS = 5 * 60 * 1000;

function clickOf(touch: Touch): { type: ClickIdType; id: string } | null {
  for (const type of CLICK_ID_TYPES) {
    const id = touch.params[type];
    if (id) return { type, id };
  }
  return null;
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

/**
 * The ad an order credits: the latest paid touch (the last one, or this visit
 * when it is an ad) whose click is at most `AD_CREDIT_WINDOW_DAYS` before the
 * order. Null when no ad click is that recent.
 */
export function creditedTouch(touches: CapturedTouches | null, now: string): Touch | null {
  const nowMs = Date.parse(now);
  const candidates = [touches?.last, touches?.visit].filter((touch): touch is Touch => Boolean(touch && isPaidTouch(touch)));
  const recent = candidates.filter((touch) => {
    const age = nowMs - Date.parse(touch.at);
    return age >= -FUTURE_SKEW_MS && age <= WINDOW_MS;
  });
  return recent.sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0] ?? null;
}

/** The page a touch landed on, for an order's landing-page fallback: the credited ad's, else this visit's. */
export function landingTouch(touches: CapturedTouches | null, now: string): Touch | null {
  return creditedTouch(touches, now) ?? touches?.visit ?? null;
}

function touchColumns(touch: Touch) {
  const { params } = touch;
  const click = clickOf(touch);
  const { platform, app } = classifyTouch(touch);
  const names = { campaign: params.wc_cn, ad: params.wc_an };
  return {
    capturedAt: touch.at,
    platform,
    clickId: click?.id ?? null,
    clickIdType: click?.type ?? null,
    campaignId: adId(params.utm_campaign),
    adsetId: adId(params.utm_term),
    adId: adId(params.utm_content),
    placement: params.wc_pl && params.wc_pl.length <= MAX_PLACEMENT_LENGTH ? params.wc_pl : null,
    siteSource: app,
    utmSource: params.utm_source ?? null,
    utmMedium: params.utm_medium ?? null,
    utmCampaign: params.utm_campaign ?? null,
    utmTerm: params.utm_term ?? null,
    utmContent: params.utm_content ?? null,
    namesJson: names.campaign || names.ad ? JSON.stringify(names) : null,
    landingPath: touch.path,
    landingPageType: landingOf(touch.path).type,
    referrerHost: touch.ref,
  };
}

function visitColumns(visit: Touch | null) {
  if (!visit) return {};
  const { channel, platform, app } = classifyTouch(visit);
  return {
    visitAt: visit.at,
    visitChannel: channel,
    visitPlatform: platform,
    visitSiteSource: app,
    visitReferrerHost: visit.ref,
    visitLandingPath: visit.path,
    visitLandingPageType: landingOf(visit.path).type,
    visitUtmSource: visit.params.utm_source ?? null,
    visitUtmMedium: visit.params.utm_medium ?? null,
    visitUtmCampaign: visit.params.utm_campaign ?? null,
  };
}

/**
 * The `order_attribution` row of a storefront order, or null when its
 * storefront sent nothing (a theme on an older SDK, cookies off). The touch
 * columns describe the credited ad, else this visit; `channel` is the ad's,
 * else this visit's, else unknown. The credit window counts back from
 * `orderedAt` (when the shopper submitted it), else `now`.
 */
export function capturedAttributionRow(orderId: string, touches: CapturedTouches | null, context: { now: string; orderedAt?: string }): OrderAttributionRow | null {
  if (!touches) return null;
  const ad = creditedTouch(touches, context.orderedAt ?? context.now);
  const visit = touches.visit;
  const shown = ad ?? visit;
  const first = touches.first;
  const channel: OrderChannel | null = ad ? classifyTouch(ad).channel : visit ? classifyTouch(visit).channel : null;
  return {
    orderId,
    method: "captured",
    channel,
    ...(shown ? touchColumns(shown) : { platform: "direct", capturedAt: null }),
    ...visitColumns(visit),
    firstTouchAt: first?.at ?? null,
    firstTouchJson: first ? JSON.stringify(first) : null,
    createdAt: context.now,
    updatedAt: context.now,
  };
}

const ENTERED_CHANNELS: Partial<Record<Origin, OrderChannel>> = { dashboard: "dashboard", api: "api", agent: "agent" };

/** The row of an order staff entered (the dashboard, the API, the AI agent), or null for any other origin. */
export function enteredAttributionRow(orderId: string, origin: Origin, now: string): OrderAttributionRow | null {
  const channel = ENTERED_CHANNELS[origin];
  if (!channel) return null;
  return { orderId, method: "entered", channel, platform: "none", capturedAt: null, createdAt: now, updatedAt: now };
}
