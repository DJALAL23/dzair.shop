/**
 * Where each App stands for a store, and its removal (Apps context): the one
 * place an App Status is decided, from the App's own table and its Built-in
 * Consumers' health, and the one place an App's setup is forgotten. The Apps
 * page and `/api/apps` go through here, never through the tables.
 */

import { eq, inArray } from "drizzle-orm";
import type { AppDb } from "../db/client";
import { eventConsumers, landingPagePixelConfig, storeEmailConfig, storeOtpConfig, storePixelConfig, stores, storeTurnstileConfig } from "../db/schema";
import { APP_CATALOG, consumerOwner, type AppKey } from "../apps/catalog";
import { parseWhatsAppWidgetConfig, resolveStorefrontWidget } from "../whatsapp-widget/config";

export const APP_STATUSES = ["not_set_up", "on", "off", "needs_attention"] as const;
export type AppStatus = (typeof APP_STATUSES)[number];

function statusOf(row: { enabled: boolean } | undefined, troubled: boolean): AppStatus {
  if (!row) return "not_set_up";
  if (!row.enabled) return "off";
  return troubled ? "needs_attention" : "on";
}

function whatsappButtonStatus(json: string | null | undefined): AppStatus {
  if (json == null) return "not_set_up";
  if (!parseWhatsAppWidgetConfig(json).enabled) return "off";
  return resolveStorefrontWidget(json) ? "on" : "needs_attention";
}

export async function appStatuses(db: AppDb, storeId: string): Promise<Record<AppKey, AppStatus>> {
  const [meta, dzverify, turnstile, sendili, store, consumers] = await Promise.all([
    db.select({ enabled: storePixelConfig.enabled }).from(storePixelConfig).where(eq(storePixelConfig.storeId, storeId)).get(),
    db.select({ enabled: storeOtpConfig.enabled }).from(storeOtpConfig).where(eq(storeOtpConfig.storeId, storeId)).get(),
    db.select({ enabled: storeTurnstileConfig.enabled }).from(storeTurnstileConfig).where(eq(storeTurnstileConfig.storeId, storeId)).get(),
    db.select({ enabled: storeEmailConfig.enabled }).from(storeEmailConfig).where(eq(storeEmailConfig.storeId, storeId)).get(),
    db.select({ whatsappWidgetJson: stores.whatsappWidgetJson }).from(stores).where(eq(stores.id, storeId)).get(),
    db
      .select({ kind: eventConsumers.kind, failingSince: eventConsumers.failingSince, disabledReason: eventConsumers.disabledReason })
      .from(eventConsumers)
      .where(inArray(eventConsumers.kind, APP_CATALOG.flatMap((app) => app.consumerKinds)))
      .all(),
  ]);

  const troubled = (key: AppKey) =>
    consumers.some(
      (consumer) =>
        consumerOwner(consumer.kind) === key &&
        (consumer.failingSince !== null || (consumer.disabledReason !== null && consumer.disabledReason !== "merchant")),
    );

  return {
    meta: statusOf(meta, troubled("meta")),
    dzverify: statusOf(dzverify, troubled("dzverify")),
    turnstile: statusOf(turnstile, troubled("turnstile")),
    sendili: statusOf(sendili, troubled("sendili")),
    "whatsapp-button": whatsappButtonStatus(store?.whatsappWidgetJson),
  };
}

/**
 * Forget an App's setup and every key it holds, as if it had never been set
 * up: Meta loses its store pixel and every landing page's own. Its Built-in
 * Consumers stay, with nothing to send until it is set up again.
 */
export async function removeApp(db: AppDb, storeId: string, key: AppKey): Promise<void> {
  switch (key) {
    case "meta":
      await db.batch([
        db.delete(storePixelConfig).where(eq(storePixelConfig.storeId, storeId)),
        db.delete(landingPagePixelConfig),
      ]);
      return;
    case "dzverify":
      await db.delete(storeOtpConfig).where(eq(storeOtpConfig.storeId, storeId));
      return;
    case "turnstile":
      await db.delete(storeTurnstileConfig).where(eq(storeTurnstileConfig.storeId, storeId));
      return;
    case "sendili":
      await db.delete(storeEmailConfig).where(eq(storeEmailConfig.storeId, storeId));
      return;
    case "whatsapp-button":
      await db.update(stores).set({ whatsappWidgetJson: null }).where(eq(stores.id, storeId));
      return;
    default:
      throw new Error(`No removal for the App ${key satisfies never}`);
  }
}
