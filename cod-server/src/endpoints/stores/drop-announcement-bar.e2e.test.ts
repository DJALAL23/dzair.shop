/**
 * Migration 0048 drops stores.announcement_bar and its translations: an
 * announcement is a theme's own setting. /store/config keeps answering
 * `announcementBar: null`, which @wocart/storefront up to 1.7 requires.
 * Real D1, real migrations, real route.
 */
import { OpenAPIHono } from "@hono/zod-openapi";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { errorHandler } from "@/middleware/error";
import { openApiValidationHook } from "@/openapi/validation-hook";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import type { AppContext } from "@/types";
import storeRoutes from "../store/routes";
import { TEST_MEDIA_VARS } from "@/test-utils/media";

const T = "2026-10-01T00:00:00.000Z";
let d1: TestD1;

beforeAll(async () => {
  d1 = await createTestD1({ before: "0048_drop_store_announcement_bar.sql" });
  await d1.db.run(sql`INSERT INTO stores (id, name, lang, announcement_bar, meta_title, created_at, updated_at)
    VALUES ('s1', 'Boutique', 'ar', 'توصيل مجاني', 'متجر', ${T}, ${T})`);
  await d1.db.run(sql`INSERT INTO store_locales (store_id, locale, published, created_at) VALUES ('s1', 'ar', 1, ${T}), ('s1', 'fr', 1, ${T})`);
  await d1.db.run(sql`INSERT INTO translations (resource_type, resource_id, locale, key, value, source_digest, updated_at) VALUES
    ('store', 's1', 'fr', 'announcementBar', 'Livraison gratuite', 'd', ${T}),
    ('store', 's1', 'fr', 'metaTitle', 'Boutique', 'd', ${T})`);
  await d1.applyRemaining();
}, 120_000);

afterAll(async () => {
  await d1?.dispose();
});

describe("migration 0048", () => {
  it("drops the column and its translations, and nothing else", async () => {
    const columns = (await d1.raw.prepare("PRAGMA table_info(stores)").all<{ name: string }>()).results.map((column) => column.name);
    expect(columns).not.toContain("announcement_bar");
    const keys = (await d1.raw.prepare("SELECT key FROM translations ORDER BY key").all<{ key: string }>()).results.map((row) => row.key);
    expect(keys).toEqual(["metaTitle"]);
  });

  it("leaves /store/config answering announcementBar: null for the SDKs that require it", async () => {
    const app = new OpenAPIHono<AppContext>({ defaultHook: openApiValidationHook });
    app.use("*", async (c, next) => {
      c.env = { DB: d1.raw, ...TEST_MEDIA_VARS } as AppContext["Bindings"];
      c.set("storeId", "s1");
      await next();
    });
    app.onError(errorHandler);
    app.route("/store", storeRoutes);
    const response = await app.request("/store/config?locale=fr");
    const { data } = (await response.json()) as { data: Record<string, unknown> };
    expect(response.status).toBe(200);
    expect(data).toHaveProperty("announcementBar", null);
    expect(data.metaTitle).toBe("Boutique");
  });
});
