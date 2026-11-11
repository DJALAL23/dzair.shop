/**
 * An order's **source** as a person reads it: Facebook, Instagram, WhatsApp,
 * a phone call. The merchant names one on a dashboard order (`merchant`
 * attribution); a captured attribution is named the same way from its
 * platform and Meta's site source. One list for the server, the AI tools and
 * the dashboard (ADR 0026).
 */
import type { AttributionPlatform } from "./model";
import type { OrderAttributionRow } from "./resolve";
import type { orderAttribution } from "../db/schema";

/** The sources a merchant can name on an order. */
export const ORDER_SOURCES = ["facebook", "instagram", "messenger", "whatsapp", "tiktok", "phone", "other"] as const;

export type OrderSource = (typeof ORDER_SOURCES)[number];

/** Every source an order can show: the merchant's, and the ones only a captured visit has. */
export const ORDER_SOURCE_LABELS = [...ORDER_SOURCES, "google", "referral", "direct"] as const;

export type OrderSourceLabel = (typeof ORDER_SOURCE_LABELS)[number];

const SOURCE_ATTRIBUTION: Readonly<Record<OrderSource, { platform: AttributionPlatform; siteSource: string | null }>> = {
  facebook: { platform: "meta", siteSource: "fb" },
  instagram: { platform: "meta", siteSource: "ig" },
  messenger: { platform: "meta", siteSource: "msg" },
  whatsapp: { platform: "meta", siteSource: "wa" },
  tiktok: { platform: "tiktok", siteSource: null },
  phone: { platform: "phone", siteSource: null },
  other: { platform: "other", siteSource: null },
};

const META_SITE_SOURCE_LABELS: Readonly<Record<string, OrderSourceLabel>> = {
  ig: "instagram",
  msg: "messenger",
  wa: "whatsapp",
};

/** What a merchant says of an order's source: the source, and the campaign or ad when known. */
export interface MerchantSourceChoice {
  readonly source: OrderSource;
  readonly campaignId?: string | null | undefined;
  readonly adId?: string | null | undefined;
}

/** The `order_attribution` row of a source the merchant named. */
export function merchantAttributionRow(orderId: string, choice: MerchantSourceChoice, now: string): OrderAttributionRow {
  const { platform, siteSource } = SOURCE_ATTRIBUTION[choice.source];
  return {
    orderId,
    method: "merchant",
    capturedAt: null,
    platform,
    siteSource,
    campaignId: choice.campaignId ?? null,
    adId: choice.adId ?? null,
    createdAt: now,
    updatedAt: now,
  };
}

/** The source an attribution shows as. */
export function orderSourceOf(attribution: Pick<OrderAttributionRow, "platform" | "siteSource">): OrderSourceLabel {
  if (attribution.platform === "meta") return META_SITE_SOURCE_LABELS[attribution.siteSource ?? ""] ?? "facebook";
  return attribution.platform;
}

/** An order's attribution as the API shows it: what it credits, never the raw click id or first touch. */
export function orderAttributionView(row: typeof orderAttribution.$inferSelect) {
  let names: { campaign?: string; ad?: string } = {};
  try {
    names = row.namesJson ? (JSON.parse(row.namesJson) as typeof names) : {};
  } catch {
    names = {};
  }
  return {
    method: row.method,
    source: orderSourceOf(row),
    platform: row.platform,
    capturedAt: row.capturedAt,
    clickIdType: row.clickIdType,
    campaignId: row.campaignId,
    campaignName: names.campaign ?? null,
    adsetId: row.adsetId,
    adId: row.adId,
    adName: names.ad ?? null,
    placement: row.placement,
    siteSource: row.siteSource,
    utmSource: row.utmSource,
    utmMedium: row.utmMedium,
    utmCampaign: row.utmCampaign,
    utmTerm: row.utmTerm,
    utmContent: row.utmContent,
    landingPath: row.landingPath,
    landingPageType: row.landingPageType,
    referrerHost: row.referrerHost,
    firstTouchAt: row.firstTouchAt,
  };
}

export type OrderAttributionView = ReturnType<typeof orderAttributionView>;
