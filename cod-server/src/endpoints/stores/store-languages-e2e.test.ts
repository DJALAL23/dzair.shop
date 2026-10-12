/**
 * Store languages and theme text (ADR 0005, phase B) — real D1, real
 * migrations, real routes.
 *
 *  1. Migration 0036 moves every store onto the language tables: its primary
 *     and every language 0035 served are published, and its text edits land
 *     under the reference theme — junk the old columns could hold is dropped.
 *  2. The storefront config serves only published languages, with what a theme
 *     needs to render each, and only the asking theme's edits.
 *  3. The dashboard reads every added language, replaces the list only when
 *     the primary stays published, and merge-patches one theme's text in one
 *     language — removing a language removes its text.
 */
import { OpenAPIHono } from "@hono/zod-openapi";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { errorHandler } from "@/middleware/error";
import { openApiValidationHook } from "@/openapi/validation-hook";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import type { AppContext } from "@/types";
import storeRoutes from "../store/routes";
import storesRouter from "./routes";

const now = () => new Date().toISOString();

describe("migration 0036 moves stores onto the language tables", () => {
  let legacy: TestD1;

  const seed = async (id: string, lang: string, enabled: string | null, overrides: string | null) => {
    await legacy.db.run(sql`
      INSERT INTO stores (id, name, lang, enabled_locales_json, content_overrides_json, created_at, updated_at)
      VALUES (${id}, ${id}, ${lang}, ${enabled}, ${overrides}, ${now()}, ${now()})`);
  };

  beforeAll(async () => {
    legacy = await createTestD1({ before: "0036_store_language_tables.sql" });
    await seed(
      "multi",
      "fr",
      '["fr","ar"]',
      '{"fr":{"heroTitle":"Livraison"},"ar":{"heroTitle":"توصيل"},"en":{"heroTitle":"Delivery"}}',
    );
    await seed("malformed", "ar", "{", "[1]");
    await seed(
      "junk",
      "ar",
      '["de",3,"ar","en"]',
      '{"ar":{"ok":"kept","n":3,"nested":{"a":"b"},"__proto__":"x","":"empty"},"de":{"a":"b"},"en":"flat"}',
    );
    await seed("empty", "en", null, null);
    await legacy.applyRemaining();
  }, 120_000);

  afterAll(async () => {
    await legacy?.dispose();
  });

  const locales = (storeId: string) =>
    legacy.db
      .select({ locale: schema.storeLocales.locale, published: schema.storeLocales.published })
      .from(schema.storeLocales)
      .where(eq(schema.storeLocales.storeId, storeId))
      .orderBy(schema.storeLocales.locale)
      .all();

  const overrides = (storeId: string) =>
    legacy.db
      .select({
        theme: schema.storeContentOverrides.themeKey,
        locale: schema.storeContentOverrides.locale,
        key: schema.storeContentOverrides.key,
        value: schema.storeContentOverrides.value,
      })
      .from(schema.storeContentOverrides)
      .where(eq(schema.storeContentOverrides.storeId, storeId))
      .orderBy(schema.storeContentOverrides.locale)
      .all();

  it("publishes the primary and every language the store served", async () => {
    expect(await locales("multi")).toEqual([
      { locale: "ar", published: true },
      { locale: "fr", published: true },
    ]);
    expect(await locales("malformed")).toEqual([{ locale: "ar", published: true }]);
    expect(await locales("junk")).toEqual([
      { locale: "ar", published: true },
      { locale: "en", published: true },
    ]);
    expect(await locales("empty")).toEqual([{ locale: "en", published: true }]);
  });

  it("moves each served language's edits under the reference theme, and nothing else", async () => {
    expect(await overrides("multi")).toEqual([
      { theme: "theme-00", locale: "ar", key: "heroTitle", value: "توصيل" },
      { theme: "theme-00", locale: "fr", key: "heroTitle", value: "Livraison" },
    ]);
    expect(await overrides("junk")).toEqual([{ theme: "theme-00", locale: "ar", key: "ok", value: "kept" }]);
    expect(await overrides("malformed")).toEqual([]);
    expect(await overrides("empty")).toEqual([]);
  });

  it("drops the JSON columns, leaving one source of truth", async () => {
    const columns = await legacy.raw.prepare("PRAGMA table_info(stores)").all<{ name: string }>();
    const names = columns.results.map((column) => column.name);
    expect(names).not.toContain("enabled_locales_json");
    expect(names).not.toContain("content_overrides_json");
  });
});

describe("store languages through the real routes", () => {
  let harness: TestD1;
  let app: OpenAPIHono<AppContext>;
  const STORE_ID = "store-languages";

  beforeAll(async () => {
    harness = await createTestD1();
    app = new OpenAPIHono<AppContext>({ defaultHook: openApiValidationHook });
    app.use("*", async (c, next) => {
      c.env = { DB: harness.raw } as AppContext["Bindings"];
      c.set("storeId", STORE_ID);
      c.set("user", { id: "admin", role: "admin", status: "active" } as never);
      await next();
    });
    app.onError(errorHandler);
    app.route("/store", storeRoutes);
    app.route("/api/stores", storesRouter);
  }, 120_000);

  afterAll(async () => {
    await harness?.dispose();
  });

  const edit = (theme: string, locale: "ar" | "fr" | "en", key: string, value: string) => ({
    storeId: STORE_ID,
    themeKey: theme,
    locale,
    key,
    value,
    updatedAt: now(),
  });

  beforeEach(async () => {
    await harness.db.delete(schema.stores);
    await harness.db.insert(schema.stores).values({
      id: STORE_ID,
      name: "متجر",
      lang: "fr",
      storeApiKey: "sk_store_secret",
      createdAt: now(),
      updatedAt: now(),
    });
    await harness.db.insert(schema.storeLocales).values([
      { storeId: STORE_ID, locale: "fr", published: true, createdAt: now() },
      { storeId: STORE_ID, locale: "ar", published: true, createdAt: now() },
      { storeId: STORE_ID, locale: "en", published: false, createdAt: now() },
    ]);
    await harness.db.insert(schema.storeContentOverrides).values([
      edit("theme-00", "fr", "heroTitle", "Livraison gratuite"),
      edit("theme-00", "ar", "heroTitle", "توصيل مجاني"),
      edit("theme-00", "en", "heroTitle", "Free delivery (draft)"),
      edit("other-theme", "fr", "heroTitle", "Autre thème"),
    ]);
  });

  const request = async (path: string, init?: { method: string; body: unknown }) => {
    const res = await app.request(
      path,
      init && {
        method: init.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(init.body),
      },
    );
    return { status: res.status, body: (await res.json()) as any };
  };

  const storedEdits = (theme: string) =>
    harness.db
      .select({ locale: schema.storeContentOverrides.locale, key: schema.storeContentOverrides.key })
      .from(schema.storeContentOverrides)
      .where(
        and(eq(schema.storeContentOverrides.storeId, STORE_ID), eq(schema.storeContentOverrides.themeKey, theme)),
      )
      .orderBy(schema.storeContentOverrides.locale, schema.storeContentOverrides.key)
      .all();

  describe("GET /store/config", () => {
    it("serves the published languages, primary first, with name and direction", async () => {
      const { status, body } = await request("/store/config?theme=theme-00");
      expect(status).toBe(200);
      expect(body.data.lang).toBe("fr");
      expect(body.data.locales).toEqual([
        { code: "fr", nativeName: "Français", direction: "ltr" },
        { code: "ar", nativeName: "العربية", direction: "rtl" },
      ]);
    });

    it("sends only the asking theme's edits, and only for published languages", async () => {
      const { body } = await request("/store/config?theme=theme-00");
      expect(body.data.contentOverrides).toEqual({
        fr: { heroTitle: "Livraison gratuite" },
        ar: { heroTitle: "توصيل مجاني" },
      });
      const other = await request("/store/config?theme=other-theme");
      expect(other.body.data.contentOverrides).toEqual({ fr: { heroTitle: "Autre thème" } });
    });

    it("sends no edits to a caller that names no theme, and refuses a malformed theme key", async () => {
      expect((await request("/store/config")).body.data.contentOverrides).toEqual({});
      expect((await request("/store/config?theme=Theme%2000")).status).toBe(400);
    });

    it("carries no raw JSON column and no API key", async () => {
      const { body } = await request("/store/config?theme=theme-00");
      expect(Object.keys(body.data).filter((key) => key.endsWith("Json") || key === "storeApiKey")).toEqual([]);
      expect(JSON.stringify(body)).not.toContain("sk_store_secret");
    });
  });

  describe("store languages in settings", () => {
    it("lists every added language, primary first, published or not", async () => {
      const { body } = await request("/api/stores/me");
      expect(body.data.languages).toEqual([
        { locale: "fr", published: true, primary: true },
        { locale: "ar", published: true, primary: false },
        { locale: "en", published: false, primary: false },
      ]);
    });

    it("replaces the list, and removing a language removes its text", async () => {
      const { status, body } = await request("/api/stores/me", {
        method: "PATCH",
        body: { languages: [{ locale: "en", published: true }, { locale: "fr", published: true }] },
      });
      expect(status).toBe(200);
      expect(body.data.languages).toEqual([
        { locale: "fr", published: true, primary: true },
        { locale: "en", published: true, primary: false },
      ]);
      expect(await storedEdits("theme-00")).toEqual([
        { locale: "en", key: "heroTitle" },
        { locale: "fr", key: "heroTitle" },
      ]);
    });

    it.each([
      ["leaves the primary out", [{ locale: "ar", published: true }]],
      ["unpublishes the primary", [{ locale: "fr", published: false }, { locale: "ar", published: true }]],
    ])("refuses a list that %s, changing nothing", async (_name, languages) => {
      const { status } = await request("/api/stores/me", { method: "PATCH", body: { languages } });
      expect(status).toBe(400);
      expect((await request("/api/stores/me")).body.data.languages).toHaveLength(3);
    });

    it("refuses a language listed twice", async () => {
      const languages = [
        { locale: "fr", published: true },
        { locale: "fr", published: false },
      ];
      expect((await request("/api/stores/me", { method: "PATCH", body: { languages } })).status).toBe(400);
    });

    it("publishes a new primary set alone, keeping every other language", async () => {
      const { body } = await request("/api/stores/me", { method: "PATCH", body: { lang: "en" } });
      expect(body.data.lang).toBe("en");
      expect(body.data.languages).toEqual([
        { locale: "en", published: true, primary: true },
        { locale: "ar", published: true, primary: false },
        { locale: "fr", published: true, primary: false },
      ]);
    });

    it("checks a list against the primary the same save sets", async () => {
      const ok = await request("/api/stores/me", {
        method: "PATCH",
        body: { lang: "ar", languages: [{ locale: "ar", published: true }] },
      });
      expect(ok.body.data.languages).toEqual([{ locale: "ar", published: true, primary: true }]);
      const refused = await request("/api/stores/me", {
        method: "PATCH",
        body: { lang: "en", languages: [{ locale: "ar", published: true }] },
      });
      expect(refused.status).toBe(400);
    });

    it("leaves languages alone when a save does not mention them", async () => {
      await request("/api/stores/me", { method: "PATCH", body: { name: "Renamed" } });
      expect((await request("/api/stores/me")).body.data.languages).toHaveLength(3);
    });
  });

  describe("theme text edits", () => {
    const patch = (body: unknown) => request("/api/stores/me/content-overrides", { method: "PATCH", body });

    it("lists one theme's edits in every added language, drafts included", async () => {
      const { body } = await request("/api/stores/me/content-overrides?theme=theme-00");
      expect(body.data).toEqual({
        theme: "theme-00",
        overrides: {
          fr: { heroTitle: "Livraison gratuite" },
          ar: { heroTitle: "توصيل مجاني" },
          en: { heroTitle: "Free delivery (draft)" },
        },
      });
    });

    it("merge-patches one language of one theme: set, remove, leave the rest", async () => {
      const { status, body } = await patch({
        theme: "theme-00",
        locale: "fr",
        values: { promoTitle: "Promo", heroTitle: null, neverSet: null },
      });
      expect(status).toBe(200);
      expect(body.data).toEqual({ theme: "theme-00", locale: "fr", overrides: { promoTitle: "Promo" } });
      expect(await storedEdits("theme-00")).toEqual([
        { locale: "ar", key: "heroTitle" },
        { locale: "en", key: "heroTitle" },
        { locale: "fr", key: "promoTitle" },
      ]);
      expect(await storedEdits("other-theme")).toEqual([{ locale: "fr", key: "heroTitle" }]);
    });

    it("overwrites an existing key", async () => {
      const { body } = await patch({ theme: "theme-00", locale: "ar", values: { heroTitle: "جديد" } });
      expect(body.data.overrides).toEqual({ heroTitle: "جديد" });
    });

    it("refuses a language the store has not added", async () => {
      await request("/api/stores/me", {
        method: "PATCH",
        body: { languages: [{ locale: "fr", published: true }] },
      });
      expect((await patch({ theme: "theme-00", locale: "ar", values: { heroTitle: "x" } })).status).toBe(400);
    });

    it("edits the primary even when a seed never gave it a row, and publishes it", async () => {
      await harness.db.delete(schema.storeLocales).where(eq(schema.storeLocales.locale, "fr"));
      const { status } = await patch({ theme: "theme-00", locale: "fr", values: { heroTitle: "Nouveau" } });
      expect(status).toBe(200);
      const row = await harness.db
        .select()
        .from(schema.storeLocales)
        .where(and(eq(schema.storeLocales.storeId, STORE_ID), eq(schema.storeLocales.locale, "fr")))
        .get();
      expect(row?.published).toBe(true);
    });

    it("caps the keys per theme and language, while still letting existing keys change", async () => {
      await harness.raw
        .prepare(
          `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 999)
           INSERT INTO store_content_overrides (store_id, theme_key, locale, key, value, updated_at)
           SELECT ?, 'theme-00', 'fr', 'k' || i, 'v', ? FROM n`,
        )
        .bind(STORE_ID, now())
        .run();
      expect((await patch({ theme: "theme-00", locale: "fr", values: { oneMore: "x" } })).status).toBe(400);
      expect((await patch({ theme: "theme-00", locale: "fr", values: { k1: "changed" } })).status).toBe(200);
      expect(
        (await patch({ theme: "theme-00", locale: "fr", values: { k1: null, oneMore: "x" } })).status,
      ).toBe(200);
    });

    it.each([
      ["a malformed theme key", { theme: "Theme 00", locale: "fr", values: { a: "b" } }],
      ["an unsupported language", { theme: "theme-00", locale: "de", values: { a: "b" } }],
      ["a non-string value", { theme: "theme-00", locale: "fr", values: { a: 3 } }],
      ["an over-long value", { theme: "theme-00", locale: "fr", values: { a: "x".repeat(5001) } }],
      ["an empty key", { theme: "theme-00", locale: "fr", values: { "": "x" } }],
    ])("refuses %s", async (_name, body) => {
      expect((await patch(body)).status).toBe(400);
    });

    it("never stores a __proto__ key: refused, or dropped before it is saved", async () => {
      const body = JSON.parse('{"theme":"theme-00","locale":"fr","values":{"__proto__":"x","ok":"y"}}');
      await patch(body);
      expect((await storedEdits("theme-00")).map((row) => row.key)).not.toContain("__proto__");
      expect(({} as Record<string, unknown>).x).toBeUndefined();
    });
  });
});
