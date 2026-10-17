/**
 * Migration 0046 drops stores.font_url, which nothing read, and the
 * storefront config keeps answering `fontUrl: null`: every published
 * @wocart/storefront up to 1.7 requires the field, so a deployed theme keeps
 * reading its config. Real D1, real migrations, real route.
 */
import { OpenAPIHono } from "@hono/zod-openapi";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { errorHandler } from "@/middleware/error";
import { openApiValidationHook } from "@/openapi/validation-hook";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import type { AppContext } from "@/types";
import storeRoutes from "../store/routes";

const T = "2026-10-01T00:00:00.000Z";
let d1: TestD1;

beforeAll(async () => {
  d1 = await createTestD1({ before: "0046_drop_store_font_url.sql" });
  await d1.db.run(sql`
    INSERT INTO stores (id, name, lang, font_family, font_url, created_at, updated_at)
    VALUES ('s1', 'Boutique', 'ar', 'Tajawal, sans-serif', 'https://fonts.googleapis.com/css2?family=Tajawal', ${T}, ${T})`);
  await d1.db.run(sql`INSERT INTO store_locales (store_id, locale, published, created_at) VALUES ('s1', 'ar', 1, ${T})`);
  await d1.applyRemaining();
}, 120_000);

afterAll(async () => {
  await d1?.dispose();
});

describe("migration 0046", () => {
  it("drops the column and keeps the store and its font family", async () => {
    const columns = (await d1.raw.prepare("PRAGMA table_info(stores)").all<{ name: string }>()).results.map((column) => column.name);
    expect(columns).not.toContain("font_url");
    expect(columns).toContain("font_family");
    expect(await d1.raw.prepare("SELECT name, font_family FROM stores").first()).toEqual({ name: "Boutique", font_family: "Tajawal, sans-serif" });
  });

  it("leaves /store/config answering fontUrl: null for the SDKs that require it", async () => {
    const app = new OpenAPIHono<AppContext>({ defaultHook: openApiValidationHook });
    app.use("*", async (c, next) => {
      c.env = { DB: d1.raw } as AppContext["Bindings"];
      c.set("storeId", "s1");
      await next();
    });
    app.onError(errorHandler);
    app.route("/store", storeRoutes);
    const response = await app.request("/store/config");
    expect(response.status).toBe(200);
    const { data } = (await response.json()) as { data: Record<string, unknown> };
    expect(data).toHaveProperty("fontUrl", null);
    expect(data.fontFamily).toBe("Tajawal, sans-serif");
  });
});
