/**
 * An order's attribution as the API shows it (ADR 0026, attribution v2): the
 * order's channel, the ad it credits, and this visit, kept apart. A row
 * written before v2 has no channel: it is read by the same rules from what it
 * stored, so an `_fbc`-only row shows as Facebook, not as an ad.
 */
import { classifyTouch } from "./channel";
import { PAID_CHANNELS, type OrderChannel, type Touch, type TouchParam } from "./model";
import type { orderAttribution } from "../db/schema";

type Row = typeof orderAttribution.$inferSelect;

function names(row: Row): { campaign?: string; ad?: string } {
  try {
    return row.namesJson ? (JSON.parse(row.namesJson) as { campaign?: string; ad?: string }) : {};
  } catch {
    return {};
  }
}

/** The touch a pre-v2 row stored, rebuilt from its columns, to classify it by today's rules. */
function storedTouch(row: Row): Pick<Touch, "params" | "ref"> {
  const params: Partial<Record<TouchParam, string>> = {};
  const set = (key: TouchParam, value: string | null | undefined) => {
    if (value) params[key] = value;
  };
  set("utm_source", row.utmSource);
  set("utm_medium", row.utmMedium);
  set("utm_campaign", row.utmCampaign);
  set("utm_term", row.utmTerm);
  set("utm_content", row.utmContent);
  set("wc_ss", row.siteSource);
  const { campaign, ad } = names(row);
  set("wc_cn", campaign);
  set("wc_an", ad);
  if (row.clickIdType && row.clickId) params[row.clickIdType] = row.clickId;
  return { params, ref: row.referrerHost };
}

/** The channel of a row written without one: a pre-v2 row read by today's rules, or null when it stored nothing to read. */
function legacyChannel(row: Row): OrderChannel | null {
  if (row.method === "merchant") return "dashboard";
  const touch = storedTouch(row);
  if (Object.keys(touch.params).length === 0 && !touch.ref) return null;
  return classifyTouch(touch).channel;
}

export function orderAttributionView(row: Row) {
  const channel = row.channel ?? legacyChannel(row);
  const isAd = row.method === "captured" && channel !== null && PAID_CHANNELS.includes(channel);
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
