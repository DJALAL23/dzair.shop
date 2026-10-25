/**
 * Meta conversions as a Consumer Kind (plan, Phase 7). The store has one
 * built-in Consumer of this kind (migration 0061), subscribed to the four
 * events a conversion can follow:
 *
 *   order.created              — the checkout stage, for a shopper's order
 *   order.confirmed            — the phone-confirmation stage, from any surface
 *   shipment.delivered         — the delivered stage
 *   shipment.out_for_delivery  — the delivered stage, for a long-haul wilaya
 *                                whose delivery would land past Meta's 7 days
 *
 * Whether a conversion is sent is the merchant's tracking settings' to say,
 * read when it is delivered (`conversion-model.ts`); every other reason not
 * to send is a Skipped Delivery with that reason. The business facts come from
 * the event itself; only the private attribution (the ad click's cookies, the
 * shopper's address and browser) is read from the order.
 *
 * `capi_event_log` stays Meta's sent-once ledger: a conversion is claimed by
 * the Delivery that sends it, so an order delivered after a long-haul
 * out-for-delivery already counted, or a conversion the old Workflow sent, is
 * never sent twice; a retry of the claiming Delivery may send again, and Meta
 * deduplicates it by `event_id`.
 */

import { eq, sql } from "drizzle-orm";
import { capiEventLog, communes, landingPages, orders, stores } from "@/db/schema";
import { sendCapiEvent } from "@/lib/capi";
import { resolveCapiDispatch, resolveConversionForStage, conversionSourceUrl, shouldTriggerCapiPurchase, type ConversionStage } from "@/workflows/capi-helpers";
import { resolveTrackingConfig } from "../../../../cod-shared/queries/tracking-config";
import type { DeliverableEvent } from "../../../../cod-shared/events/deliveries";
import type { ConsumerKind } from "./kind";

export const META_CAPI_KIND = "meta_capi";

/** Meta refuses an event whose `event_time` is seven days old or more. */
const META_WINDOW_MS = 7 * 24 * 60 * 60_000;

/** The conversion stage an event can be, or null when it is none. */
function stageOf(event: DeliverableEvent): ConversionStage | null {
  switch (event.type) {
    case "order.created":
      return event.origin === "storefront" ? "checkout" : null;
    case "order.confirmed":
      return "confirmed";
    case "shipment.delivered":
      return "delivered";
    case "shipment.out_for_delivery":
      return shouldTriggerCapiPurchase("out_for_delivery", event.data.order.destination.wilaya?.id) ? "delivered" : null;
    default:
      return null;
  }
}

function splitName(customerName: string): { firstName?: string; lastName?: string } {
  const parts = customerName.trim().split(/\s+/);
  return { firstName: parts[0] || undefined, lastName: parts.length > 1 ? parts[parts.length - 1] : undefined };
}

export const metaCapi: ConsumerKind = {
  kind: META_CAPI_KIND,
  cost: { external: 1, services: 10 },

  async deliver({ deliveryId, event, db, fetch }) {
    const stage = stageOf(event);
    if (!stage || !("order" in event.data)) return { kind: "skipped", reason: `${event.type} is not a conversion here` };
    const order = event.data.order;

    const attribution = await db
      .select({ fbc: orders.fbc, fbp: orders.fbp, ipAddress: orders.ipAddress, userAgent: orders.userAgent, landingPageId: orders.landingPageId, landingPageSlug: landingPages.slug })
      .from(orders)
      .leftJoin(landingPages, eq(orders.landingPageId, landingPages.id))
      .where(eq(orders.id, order.id))
      .get();
    if (!attribution) return { kind: "skipped", reason: "The order no longer exists" };
    const store = await db.select({ id: stores.id, domain: stores.domain }).from(stores).limit(1).get();
    if (!store) return { kind: "skipped", reason: "The store has no settings yet" };

    // The order decides the pixel, not the store: a sale from a landing page with its own pixel is that pixel's.
    const tracking = await resolveTrackingConfig(db, { storeId: store.id, landingPageId: attribution.landingPageId });
    const decision = resolveConversionForStage(tracking?.conversionEvent, stage);
    if (!decision.shouldFire || !decision.eventName) return { kind: "skipped", reason: decision.reason ?? `No conversion at the ${stage} stage` };
    const dispatch = resolveCapiDispatch(tracking, decision.eventName, stage);
    if (!dispatch.send) return { kind: "skipped", reason: dispatch.message };
    const pixel = tracking!;

    if (Date.now() - Date.parse(event.occurredAt) >= META_WINDOW_MS) {
      return { kind: "skipped", reason: `The ${stage} happened on ${event.occurredAt}, outside Meta's 7-day window` };
    }

    const now = new Date().toISOString();
    await db.run(
      sql`insert into capi_event_log (id, order_id, event_name, stage, status, pixel_id, sent_at)
          values (${deliveryId}, ${order.id}, ${decision.eventName}, ${stage}, 'claimed', ${pixel.pixelId}, ${now})
          on conflict do nothing`,
    );
    const claim = await db
      .select({ id: capiEventLog.id, status: capiEventLog.status })
      .from(capiEventLog)
      .where(sql`${capiEventLog.orderId} = ${order.id} and ${capiEventLog.stage} = ${stage} and ${capiEventLog.eventName} = ${decision.eventName}`)
      .get();
    if (claim?.id !== deliveryId) return { kind: "skipped", reason: `This order's ${stage} ${decision.eventName} was already sent to Meta` };
    if (claim.status === "sent") return { kind: "delivered" };

    const commune = order.destination.commune ? await db.select({ postalCode: communes.postalCode }).from(communes).where(eq(communes.id, order.destination.commune.id)).get() : null;
    const { firstName, lastName } = splitName(order.customer.name);
    const result = await sendCapiEvent(
      pixel.pixelId,
      pixel.accessToken,
      {
        eventName: decision.eventName,
        eventId: order.id,
        eventTime: Math.floor(Date.parse(event.occurredAt) / 1000),
        eventSourceUrl: conversionSourceUrl(store.domain, attribution.landingPageSlug),
        userData: {
          phone: order.customer.phone,
          email: order.customer.email,
          firstName,
          lastName,
          externalId: order.customer.id,
          city: order.destination.commune?.name ?? null,
          postalCode: commune?.postalCode ?? null,
          fbc: attribution.fbc,
          fbp: attribution.fbp,
          clientIpAddress: attribution.ipAddress,
          clientUserAgent: attribution.userAgent,
        },
        value: decision.eventName === "Purchase" ? Number(order.total.amount) : undefined,
        currency: order.total.currency,
        contentIds: [...new Set(order.lines.flatMap((line) => (line.productId ? [line.productId] : [])))],
        testEventCode: dispatch.testEventCode,
      },
      fetch,
    );

    const settled = new Date().toISOString();
    if (!result.success) {
      await db.update(capiEventLog).set({ status: "failed", error: result.error ?? null, sentAt: settled }).where(eq(capiEventLog.id, deliveryId));
      return { kind: "reject", error: `Meta refused the event: ${result.error ?? "no reason given"}` };
    }
    await db.update(capiEventLog).set({ status: "sent", metaEventId: result.fbtrace_id ?? null, error: null, sentAt: settled }).where(eq(capiEventLog.id, deliveryId));
    return { kind: "delivered" };
  },
};
