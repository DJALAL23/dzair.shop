/**
 * Meta conversions: the one place that decides which stage of an order is
 * its conversion, whether the store's tracking lets it be sent, and where
 * Meta is told it happened. The thank-you page's tracking answer and the
 * Meta conversions Consumer both decide here, so the browser and the server
 * cannot disagree.
 *
 * Grounded in official Meta documentation:
 * - Conversions API deduplication (eventID === event_id, matching event_name)
 * - the Pixel's standard events (Purchase at checkout, Lead at sign-up)
 * - Conversions API offline events (delayed COD delivery conversion)
 */

import { storefrontPath } from "../../../cod-shared/storefront/routes";

export type ConversionStage = "checkout" | "confirmed" | "delivered";
export type MetaEventName = "Lead" | "Purchase";
export type ConversionMode = "Purchase" | "Purchase_Confirmed" | "Purchase_Delivered" | "Lead";

export interface ConversionDecision {
  shouldFire: boolean;
  eventName?: MetaEventName;
  stage?: ConversionStage;
  reason?: string;
}

/**
 * Maps a merchant's chosen tracking configuration to the active business stage.
 *
 * | Configuration        | Business stage       | Meta event |
 * |----------------------|----------------------|------------|
 * | Lead                 | Checkout             | Lead       |
 * | Purchase             | Checkout             | Purchase   |
 * | Purchase_Confirmed   | Phone confirmation   | Purchase   |
 * | Purchase_Delivered   | Delivery/payment     | Purchase   |
 */
export function resolveConversionForStage(
  mode: ConversionMode | null | undefined,
  stage: ConversionStage
): ConversionDecision {
  const resolvedMode: ConversionMode = mode ?? "Purchase";

  switch (stage) {
    case "checkout":
      if (resolvedMode === "Purchase") {
        return { shouldFire: true, eventName: "Purchase", stage: "checkout" };
      }
      if (resolvedMode === "Lead") {
        return { shouldFire: true, eventName: "Lead", stage: "checkout" };
      }
      return {
        shouldFire: false,
        reason: `Conversion mode is '${resolvedMode}' — checkout stage does not fire a conversion event.`,
      };

    case "confirmed":
      if (resolvedMode === "Purchase_Confirmed") {
        return { shouldFire: true, eventName: "Purchase", stage: "confirmed" };
      }
      return {
        shouldFire: false,
        reason: `Conversion mode is '${resolvedMode}' — phone confirmation stage does not fire a conversion event.`,
      };

    case "delivered":
      if (resolvedMode === "Purchase_Delivered") {
        return { shouldFire: true, eventName: "Purchase", stage: "delivered" };
      }
      return {
        shouldFire: false,
        reason: `Conversion mode is '${resolvedMode}' — delivery stage does not fire a conversion event.`,
      };

    default:
      return { shouldFire: false, reason: `Unknown stage: ${stage}` };
  }
}

/**
 * The page Meta is told an event happened on.
 *
 * Meta matches `event_source_url` against the verified domain and shows it in
 * Events Manager. For an order that came from a landing page, naming that page
 * costs nothing — it is the same domain — and says which creative produced the
 * sale, where "/thank-you" says nothing at all.
 *
 * Built in one place so every stage's conversion names the same page. Two copies would drift,
 * and an event's source URL changing between the checkout and the delivery
 * mirror is the kind of inconsistency nobody notices until attribution is
 * already wrong.
 */
export function conversionSourceUrl(
  storeDomain: string | null | undefined,
  landingPageSlug: string | null | undefined,
): string | undefined {
  if (!storeDomain) return undefined;
  const path = landingPageSlug ? storefrontPath("landing", { slug: landingPageSlug }) : storefrontPath("thankYou");
  return `https://${storeDomain}${path}`;
}

/**
 * Southern wilayas whose deliveries take 5–10 days: their delivered stage is
 * sent when the parcel goes out for delivery, so it stays inside Meta's
 * 7-day window.
 */
const LONG_HAUL_WILAYA_IDS: ReadonlySet<number> = new Set([
  1, // Adrar
  8, // Béchar
  11, // Tamanrasset
  33, // Illizi
  37, // Tindouf
  44, // Aïn Guezzam
]);

export function isLongHaulWilaya(wilayaId: number | null | undefined): boolean {
  return wilayaId != null && LONG_HAUL_WILAYA_IDS.has(wilayaId);
}

export interface CapiDispatchConfig {
  enabled: boolean;
  accessToken: string;
  conversionEvent: ConversionMode;
  testMode: boolean;
  testEventCode: string | null;
}

export type CapiSkipReason = "tracking-disabled" | "no-access-token" | "conversion-event-mismatch";

export type CapiDispatch =
  | { send: true; testEventCode: string | null }
  | { send: false; reason: CapiSkipReason; message: string };

/**
 * Single gate for every Conversions API send: the tracking must be enabled,
 * carry an access token, and the merchant's conversion mode must fire
 * `eventName` at `stage`.
 */
export function resolveCapiDispatch(
  config: CapiDispatchConfig | null | undefined,
  eventName: MetaEventName,
  stage: ConversionStage,
): CapiDispatch {
  if (!config?.enabled) {
    return { send: false, reason: "tracking-disabled", message: "Tracking disabled in store settings" };
  }
  if (!config.accessToken) {
    return { send: false, reason: "no-access-token", message: "No CAPI access token — set up the Meta App" };
  }
  const decision = resolveConversionForStage(config.conversionEvent, stage);
  if (!decision.shouldFire || decision.eventName !== eventName) {
    return {
      send: false,
      reason: "conversion-event-mismatch",
      message: decision.reason ?? `Conversion event is set to ${config.conversionEvent} — ${eventName} not sent at stage ${stage}`,
    };
  }
  return { send: true, testEventCode: config.testMode ? config.testEventCode : null };
}

/**
 * The id a sale carries to Meta, from the browser (`eventID`) and from the
 * Conversions API (`event_id`) alike: the same id is how Meta counts it once.
 */
export function conversionEventId(orderId: string): string {
  return orderId;
}
