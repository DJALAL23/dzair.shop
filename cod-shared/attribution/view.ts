/**
 * An order's attribution as the API shows it (ADR 0026, attribution v2): the
 * order's channel, the ad it credits, the earlier visit it comes from when
 * that is not this visit, this visit, and the first visit, kept apart. The
 * stored channel decides: a row written before v2 has none, and its source
 * is unknown.
 */
import { classifyTouch } from "./channel";
import { PAID_CHANNELS, type OrderChannel, type Touch } from "./model";
import { landingOf } from "./resolve";
import { parseTouch } from "./touch";
import type { orderAttribution } from "../db/schema";

type Row = typeof orderAttribution.$inferSelect;

function names(row: Row): { campaign?: string; ad?: string } {
  try {
    return row.namesJson ? (JSON.parse(row.namesJson) as { campaign?: string; ad?: string }) : {};
  } catch {
    return {};
  }
}

/**
 * The channel a row is listed under. The stored channel is the one truth the
 * list, its filter and the order agree on; a source a merchant chose before
 * v2 is the dashboard's. A row written before v2 has no channel: what it
 * stored came from rules v2 replaced (an `_fbc` cookie could name an ad), so
 * it is not read again and its source is unknown.
 */
function channelOf(row: Pick<Row, "channel" | "method">): OrderChannel | null {
  return row.channel ?? (row.method === "merchant" ? "dashboard" : null);
}

/** The first touch a row keeps, read back. Its age was checked when the order was written, so it is read as of its own time. */
function storedTouch(json: string | null): Touch | null {
  if (!json) return null;
  try {
    const raw: unknown = JSON.parse(json);
    const at = typeof raw === "object" && raw !== null ? (raw as { at?: unknown }).at : null;
    return typeof at === "string" ? parseTouch(raw, new Date(at)) : null;
  } catch {
    return null;
  }
}

/** The first visit, as the API shows a visit. */
function firstVisit(row: Pick<Row, "firstTouchJson">) {
  const touch = storedTouch(row.firstTouchJson);
  if (!touch) return null;
  const { channel, platform, app } = classifyTouch(touch);
  return {
    at: touch.at,
    channel,
    platform,
    app,
    referrerHost: touch.ref,
    landingPath: touch.path,
    landingPageType: landingOf(touch.path).type,
    utmSource: touch.params.utm_source ?? null,
    utmMedium: touch.params.utm_medium ?? null,
    utmCampaign: touch.params.utm_campaign ?? null,
  };
}

export function orderAttributionView(row: Row) {
  const channel = channelOf(row);
  const isAd = row.method === "captured" && channel !== null && PAID_CHANNELS.includes(channel);
  const earlier = row.method === "captured" && channel !== null && !isAd && row.capturedAt !== null && row.visitAt !== null && row.capturedAt !== row.visitAt;
  const { campaign, ad } = names(row);
  return {
    method: row.method,
    channel,
    platform: row.platform,
    app: row.siteSource,
    /** Written before attribution v2, or by a storefront that sent no visit: this visit is not known. */
    legacy: row.channel === null,
    ad: isAd
      ? {
          platform: row.platform,
          app: row.siteSource,
          clickedAt: row.capturedAt,
          clickIdType: row.clickIdType,
          campaignId: row.campaignId,
          campaignName: campaign ?? null,
          adsetId: row.adsetId,
          adId: row.adId,
          adName: ad ?? null,
          placement: row.placement,
          utmSource: row.utmSource,
          utmCampaign: row.utmCampaign,
          landingPath: row.landingPath,
          landingPageType: row.landingPageType,
        }
      : null,
    visit:
      row.visitChannel != null
        ? {
            at: row.visitAt,
            channel: row.visitChannel,
            platform: row.visitPlatform,
            app: row.visitSiteSource,
            referrerHost: row.visitReferrerHost,
            landingPath: row.visitLandingPath,
            landingPageType: row.visitLandingPageType,
            utmSource: row.visitUtmSource,
            utmMedium: row.visitUtmMedium,
            utmCampaign: row.visitUtmCampaign,
          }
        : null,
    earlier: earlier
      ? {
          at: row.capturedAt,
          channel: channel!,
          platform: row.platform,
          app: row.siteSource,
          referrerHost: row.referrerHost,
          landingPath: row.landingPath,
          landingPageType: row.landingPageType,
          utmSource: row.utmSource,
          utmMedium: row.utmMedium,
          utmCampaign: row.utmCampaign,
        }
      : null,
    first: firstVisit(row),
    firstTouchAt: row.firstTouchAt,
  };
}

export type OrderAttributionView = ReturnType<typeof orderAttributionView>;

/** The columns an order list reads to show each order's source. */
export type OrderSourceColumns = Pick<
  Row,
  "method" | "channel" | "platform" | "siteSource" | "clickId" | "clickIdType" | "utmSource" | "utmMedium" | "utmCampaign" | "utmTerm" | "utmContent" | "namesJson" | "referrerHost" | "orderId"
>;

/** An order's source in a list: its channel, platform and Meta app, and the ad's name when it credits one. Null when nothing is known. */
export function orderSourceSummary(row: OrderSourceColumns | null) {
  if (!row) return null;
  const view = orderAttributionView({ ...(row as Row) });
  if (view.channel === null) return null;
  return { channel: view.channel, platform: view.platform, app: view.app, adName: view.ad?.adName ?? null, campaignName: view.ad?.campaignName ?? null };
}

export type OrderSourceSummary = NonNullable<ReturnType<typeof orderSourceSummary>>;
