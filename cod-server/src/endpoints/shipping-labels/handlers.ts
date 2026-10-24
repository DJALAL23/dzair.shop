/**
 * Shipping labels for the store's own drivers: the settings, the labels of
 * driver shipments, and a driver's delivery sheet. The dashboard draws and
 * prints them; every read here is one trip to D1.
 */

import type { Context } from "hono";
import type { AppContext } from "@/types";
import { getDb } from "@/db";
import { NotFoundError, ValidationError } from "@/lib/errors/classes";
import { ERROR_CODES } from "../../../../cod-shared/errors/codes";
import { validateShippingLabelInput } from "../../../../cod-shared/shipping-label/config";
import { labelSender, loadDeliverySheet, loadDriverLabels, loadLabelSettings, saveShippingLabelConfig } from "../../../../cod-shared/queries/shipping-labels";

async function settingsOrThrow(c: Context<AppContext>) {
  const settings = await loadLabelSettings(getDb(c.env.DB));
  if (!settings) throw new NotFoundError("Store");
  return settings;
}

/** GET /shipping-labels/settings — the settings, and the sender they print. */
export async function getLabelSettings(c: Context<AppContext>) {
  const { config, sender, store, legal } = await settingsOrThrow(c);
  return c.json({ success: true, data: { config, sender, legalPhone: legal?.contactPhone ?? null, currency: { code: store.currency, symbol: store.currencySymbol } } }, 200);
}

/** PUT /shipping-labels/settings — replace them; every problem is reported at once. */
export async function putLabelSettings(c: Context<AppContext>) {
  const db = getDb(c.env.DB);
  const { store, legal } = await settingsOrThrow(c);
  const submitted = (c.req as any).valid?.("json") ?? (await c.req.json());
  const result = validateShippingLabelInput(submitted);
  if (!result.ok) {
    throw new ValidationError(result.issues[0].message, ERROR_CODES.VALIDATION_FAILED, { issues: result.issues });
  }
  const config = await saveShippingLabelConfig(db, store.id, result.config);
  return c.json({ success: true, data: { config, sender: labelSender(store, legal, config), legalPhone: legal?.contactPhone ?? null, currency: { code: store.currency, symbol: store.currencySymbol } } }, 200);
}

/** POST /shipping-labels — the labels of these driver shipments. */
export async function getDriverLabels(c: Context<AppContext>) {
  const body = (c.req as any).valid("json") as { shipmentIds: string[] };
  const loaded = await loadDriverLabels(getDb(c.env.DB), body.shipmentIds);
  if (!loaded) throw new NotFoundError("Store");
  return c.json({ success: true, data: { ...loaded.batch, missing: loaded.missing } }, 200);
}

/** GET /shipping-labels/delivery-sheet/{driverId} — the parcels still out with a driver. */
export async function getDeliverySheet(c: Context<AppContext>) {
  const driverId = c.req.param("driverId")!;
  const sheet = await loadDeliverySheet(getDb(c.env.DB), driverId);
  if (!sheet) throw new NotFoundError("Driver", driverId);
  return c.json({ success: true, data: { ...sheet.batch, driver: sheet.driver, total: sheet.total } }, 200);
}
