/**
 * WhatsApp Widget — storage access.
 *
 * Two rules live here. The default config is stored as NULL, never as an
 * equivalent blob: "never configured" and "configured back to nothing" are
 * the same row state, and the documented rollback
 * (`UPDATE stores SET whatsapp_widget_json = NULL`) is what a merchant can do
 * from the dashboard. And a text the merchant empties takes its translations
 * with it, in the same batch: a translation translates the merchant's text,
 * and an empty text is the theme's words in every language.
 *
 * There is deliberately no read function here. The storefront already selects
 * the whole `stores` row in `getStoreConfig`, and the dashboard already looks
 * the store up by `getStore` — a read helper would add a query to one of them
 * to avoid a `parse` call in the other.
 */

import { and, eq, inArray } from "drizzle-orm";
import { stores, translations } from "../db/schema";
import type { AppDb } from "../db/client";
import {
  WIDGET_TRANSLATED_FIELDS,
  isDefaultWhatsAppWidgetConfig,
  serializeWhatsAppWidgetConfig,
  type WhatsAppWidgetConfig,
} from "../whatsapp-widget/config";

/** Deletes the widget's translations of these texts, every language. */
export const forgetWidgetTranslations = (db: AppDb, storeId: string, keys: readonly string[] = WIDGET_TRANSLATED_FIELDS) =>
  db
    .delete(translations)
    .where(and(eq(translations.resourceType, "whatsappWidget"), eq(translations.resourceId, storeId), inArray(translations.key, [...keys])));

export async function saveWhatsAppWidgetConfig(
  db: AppDb,
  storeId: string,
  config: WhatsAppWidgetConfig,
): Promise<WhatsAppWidgetConfig> {
  const stored = isDefaultWhatsAppWidgetConfig(config) ? null : serializeWhatsAppWidgetConfig(config);
  const emptied = WIDGET_TRANSLATED_FIELDS.filter((key) => stored === null || config[key] === null);
  const update = db.update(stores).set({ whatsappWidgetJson: stored, updatedAt: new Date().toISOString() }).where(eq(stores.id, storeId));
  if (emptied.length === 0) await update.run();
  else await db.batch([update, forgetWidgetTranslations(db, storeId, emptied)]);
  return config;
}
