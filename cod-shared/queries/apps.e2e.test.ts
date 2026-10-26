/**
 * Where each App stands, on real D1: decided from each App's own table and
 * its Built-in Consumers, the same way for every store.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import * as schema from "../db/schema";
import { serializeWhatsAppWidgetConfig, DEFAULT_WHATSAPP_WIDGET_CONFIG } from "../whatsapp-widget/config";
import { appStatuses } from "./apps";

let d1: TestD1;
const STORE = "store-apps";
const T0 = "2026-10-26T08:00:00.000Z";

beforeAll(async () => {
  d1 = await createTestD1();
}, 120_000);

afterAll(async () => d1?.dispose());

beforeEach(async () => {
  for (const table of [schema.storePixelConfig, schema.storeOtpConfig, schema.storeTurnstileConfig, schema.storeEmailConfig, schema.stores]) await d1.db.delete(table);
  await d1.db.update(schema.eventConsumers).set({ enabled: true, failingSince: null, disabledReason: null }).where(eq(schema.eventConsumers.kind, "meta_capi"));
  await d1.db.insert(schema.stores).values({ id: STORE, name: "Store", createdAt: T0, updatedAt: T0 });
});

const at = { createdAt: T0, updatedAt: T0 };

function widget(changes: Partial<typeof DEFAULT_WHATSAPP_WIDGET_CONFIG>) {
  return serializeWhatsAppWidgetConfig({ ...DEFAULT_WHATSAPP_WIDGET_CONFIG, ...changes });
}

async function metaConversions(changes: Partial<typeof schema.eventConsumers.$inferInsert>) {
  await d1.db.update(schema.eventConsumers).set(changes).where(eq(schema.eventConsumers.kind, "meta_capi"));
}

describe("App Status", () => {
  it("is Not set up for every App of a new store", async () => {
    expect(await appStatuses(d1.db, STORE)).toEqual({
      meta: "not_set_up",
      dzverify: "not_set_up",
      turnstile: "not_set_up",
      sendili: "not_set_up",
      "whatsapp-button": "not_set_up",
    });
  });

  it("follows each App's own switch", async () => {
    await d1.db.insert(schema.storePixelConfig).values({ id: "p", storeId: STORE, pixelId: "1", accessToken: "t", enabled: true, ...at });
    await d1.db.insert(schema.storeOtpConfig).values({ id: "o", storeId: STORE, apiKey: "k", enabled: false, ...at });
    await d1.db.insert(schema.storeTurnstileConfig).values({ id: "t", storeId: STORE, siteKey: "s", secretKey: "x", enabled: true, ...at });
    await d1.db.insert(schema.storeEmailConfig).values({ id: "e", storeId: STORE, apiKey: "k", fromEmail: "a@b.dz", enabled: false, ...at });
    await d1.db.update(schema.stores).set({ whatsappWidgetJson: widget({ enabled: true, phone: "0551234567" }) }).where(eq(schema.stores.id, STORE));

    expect(await appStatuses(d1.db, STORE)).toEqual({
      meta: "on",
      dzverify: "off",
      turnstile: "on",
      sendili: "off",
      "whatsapp-button": "on",
    });
  });

  it("reads only the store asked about", async () => {
    await d1.db.insert(schema.stores).values({ id: "other", name: "Other", ...at });
    await d1.db.insert(schema.storeOtpConfig).values({ id: "o", storeId: "other", apiKey: "k", enabled: true, ...at });
    expect((await appStatuses(d1.db, STORE)).dzverify).toBe("not_set_up");
  });

  it("needs attention when Meta conversions fail or the store stopped them, not when the merchant did", async () => {
    await d1.db.insert(schema.storePixelConfig).values({ id: "p", storeId: STORE, pixelId: "1", accessToken: "t", enabled: true, ...at });

    await metaConversions({ failingSince: T0 });
    expect((await appStatuses(d1.db, STORE)).meta).toBe("needs_attention");

    await metaConversions({ failingSince: null, enabled: false, disabledReason: "gone" });
    expect((await appStatuses(d1.db, STORE)).meta).toBe("needs_attention");

    await metaConversions({ enabled: false, disabledReason: "merchant" });
    expect((await appStatuses(d1.db, STORE)).meta).toBe("on");
  });

  it("lets Meta conversions trouble the Meta App alone", async () => {
    await d1.db.insert(schema.storeOtpConfig).values({ id: "o", storeId: STORE, apiKey: "k", enabled: true, ...at });
    await metaConversions({ failingSince: T0 });
    expect((await appStatuses(d1.db, STORE)).dzverify).toBe("on");
  });

  it("stays Off, not Needs attention, while the App itself is off", async () => {
    await d1.db.insert(schema.storePixelConfig).values({ id: "p", storeId: STORE, pixelId: "1", accessToken: "t", enabled: false, ...at });
    await metaConversions({ failingSince: T0 });
    expect((await appStatuses(d1.db, STORE)).meta).toBe("off");
  });

  it("needs attention when the WhatsApp button is on without a number it can open", async () => {
    await d1.db.update(schema.stores).set({ whatsappWidgetJson: widget({ enabled: true, phone: null }) }).where(eq(schema.stores.id, STORE));
    expect((await appStatuses(d1.db, STORE))["whatsapp-button"]).toBe("needs_attention");

    await d1.db.update(schema.stores).set({ whatsappWidgetJson: widget({ enabled: false, phone: "0551234567" }) }).where(eq(schema.stores.id, STORE));
    expect((await appStatuses(d1.db, STORE))["whatsapp-button"]).toBe("off");
  });
});
