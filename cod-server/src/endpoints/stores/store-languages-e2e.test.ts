/**
 * Store languages and per-language storefront text (ADR 0005, phase B) —
 * real D1, real migrations.
 *
 *  1. Migration 0035 converts every existing store: it serves its current
 *     language, and an old `content_json` object becomes that language's
 *     overrides. Anything else in the old column — malformed JSON, an array, a
 *     bare string — is what no reader ever honoured, and is not carried over.
 *  2. The storefront config sends only the languages the store serves and
 *     their overrides, never a raw JSON column and never the API key.
 *  3. A settings save keeps the primary language served, replaces overrides
 *     whole, and refuses what the reader would have to drop.
 */
import fc from "fast-check";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import * as schema from "@/db/schema";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import { getStoreConfig } from "../../../../cod-shared/queries/store";
import { getStore, updateStore } from "../../../../cod-shared/queries/stores";
import { storeSettingsUpdate, toStoreSettings } from "../../../../cod-shared/stores/settings";
import { STORE_LOCALES, isStoreLocale } from "../../../../cod-shared/i18n/locales";
import { updateStoreSchema } from "./validation";

const now = () => new Date().toISOString();

describe("migration 0035 converts existing stores", () => {
  let legacy: TestD1;

  const seed = async (id: string, lang: string, contentJson: string | null) => {
    await legacy.db.run(sql`
      INSERT INTO stores (id, name, lang, content_json, created_at, updated_at)
      VALUES (${id}, ${id}, ${lang}, ${contentJson}, ${now()}, ${now()})`);
  };

  beforeAll(async () => {
    legacy = await createTestD1({ before: "0035_store_locales.sql" });
    await seed("object", "fr", '{"heroTitle":"Livraison gratuite","promoTitle":"Promo"}');
    await seed("malformed", "ar", "{");
    await seed("array", "ar", '["heroTitle"]');
    await seed("bare-string", "en", '"hello"');
    await seed("empty", "ar", null);
    await legacy.applyRemaining();
  }, 120_000);

  afterAll(async () => {
    await legacy?.dispose();
  });

  const row = (id: string) =>
    legacy.raw
      .prepare("SELECT lang, enabled_locales_json, content_overrides_json FROM stores WHERE id = ?")
      .bind(id)
      .first<{ lang: string; enabled_locales_json: string; content_overrides_json: string | null }>();

  it("every store serves exactly its current language", async () => {
    for (const [id, lang] of [["object", "fr"], ["malformed", "ar"], ["bare-string", "en"], ["empty", "ar"]]) {
      expect(JSON.parse((await row(id as string))!.enabled_locales_json)).toEqual([lang]);
    }
  });

  it("an old content_json object becomes the store language's overrides", async () => {
    expect(JSON.parse((await row("object"))!.content_overrides_json!)).toEqual({
      fr: { heroTitle: "Livraison gratuite", promoTitle: "Promo" },
    });
  });

  it("carries nothing over from a value no reader honoured", async () => {
    for (const id of ["malformed", "array", "bare-string", "empty"]) {
      expect((await row(id))!.content_overrides_json).toBeNull();
    }
  });

  it("drops the old column, leaving one source of truth", async () => {
    const columns = await legacy.raw.prepare("PRAGMA table_info(stores)").all<{ name: string }>();
    const names = columns.results.map((column) => column.name);
    expect(names).not.toContain("content_json");
    expect(names).toEqual(expect.arrayContaining(["enabled_locales_json", "content_overrides_json"]));
  });
});

describe("store languages through the real read and write paths", () => {
  let harness: TestD1;
  const STORE_ID = "store-languages";

  beforeAll(async () => {
    harness = await createTestD1();
  }, 120_000);

  afterAll(async () => {
    await harness?.dispose();
  });

  beforeEach(async () => {
    await harness.db.delete(schema.stores);
    await harness.db.insert(schema.stores).values({
      id: STORE_ID,
      name: "متجر",
      lang: "fr",
      storeApiKey: "sk_store_secret",
      enabledLocalesJson: JSON.stringify(["ar", "fr", "de"]),
      contentOverridesJson: JSON.stringify({
        fr: { heroTitle: "Livraison gratuite" },
        ar: { heroTitle: "توصيل مجاني" },
        en: { heroTitle: "Free delivery" },
      }),
      createdAt: now(),
      updatedAt: now(),
    });
  });

  it("the storefront config serves the store's languages and only their overrides", async () => {
    const config = await getStoreConfig(harness.db, STORE_ID);
    expect(config?.lang).toBe("fr");
    expect(config?.locales).toEqual(["fr", "ar"]);
    expect(config?.contentOverrides).toEqual({
      fr: { heroTitle: "Livraison gratuite" },
      ar: { heroTitle: "توصيل مجاني" },
    });
  });

  it("the storefront config carries no raw JSON column and no API key", async () => {
    const config = (await getStoreConfig(harness.db, STORE_ID)) as Record<string, unknown>;
    const leaked = Object.keys(config).filter((key) => key.endsWith("Json") || key === "storeApiKey");
    expect(leaked).toEqual([]);
    expect(JSON.stringify(config)).not.toContain("sk_store_secret");
  });

  const save = async (body: unknown) => {
    const current = (await getStore(harness.db))!;
    const input = updateStoreSchema.parse(body);
    const updated = await updateStore(harness.db, current.id, storeSettingsUpdate(input, current));
    return toStoreSettings(updated!);
  };

  it("keeps the primary language served when the list leaves it out, and stores it canonically", async () => {
    expect((await save({ enabledLocales: ["ar"] })).enabledLocales).toEqual(["fr", "ar"]);
    const stored = await harness.db.select().from(schema.stores).where(eq(schema.stores.id, STORE_ID)).get();
    expect(stored!.enabledLocalesJson).toBe('["fr","ar"]');
  });

  it("enables a new primary language when it changes, keeping the others", async () => {
    const settings = await save({ lang: "en" });
    expect(settings.lang).toBe("en");
    expect(settings.enabledLocales).toEqual(["en", "ar", "fr"]);
  });

  it("replaces the overrides whole, and reads them back parsed", async () => {
    const settings = await save({ contentOverrides: { ar: { promoTitle: "عرض" } } });
    expect(settings.contentOverrides).toEqual({ ar: { promoTitle: "عرض" } });
    const stored = await harness.db.select().from(schema.stores).where(eq(schema.stores.id, STORE_ID)).get();
    expect(JSON.parse(stored!.contentOverridesJson!)).toEqual({ ar: { promoTitle: "عرض" } });
  });

  it("leaves languages untouched when a save does not mention them", async () => {
    const settings = await save({ name: "Renamed" });
    expect(settings.enabledLocales).toEqual(["fr", "ar"]);
    expect(settings.contentOverrides.fr).toEqual({ heroTitle: "Livraison gratuite" });
  });

  it("never stores a __proto__ override key: refused, or dropped before it is saved", async () => {
    const body = JSON.parse('{"contentOverrides":{"ar":{"__proto__":"x","heroTitle":"ok"}}}');
    const parsed = updateStoreSchema.safeParse(body);
    if (!parsed.success) return;
    const settings = await save(body);
    expect(Object.hasOwn(settings.contentOverrides.ar ?? {}, "__proto__")).toBe(false);
    const stored = await harness.db.select().from(schema.stores).where(eq(schema.stores.id, STORE_ID)).get();
    expect(stored!.contentOverridesJson).not.toContain("__proto__");
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });

  it.each([
    ["an unsupported language", { contentOverrides: { de: { heroTitle: "x" } } }],
    ["a non-string override", { contentOverrides: { ar: { heroTitle: 3 } } }],
    ["an over-long value", { contentOverrides: { ar: { heroTitle: "x".repeat(5001) } } }],
    ["an empty language list", { enabledLocales: [] }],
    ["an unsupported enabled language", { enabledLocales: ["de"] }],
    ["an unsupported primary language", { lang: "de" }],
  ])("refuses %s", (_name, body) => {
    expect(updateStoreSchema.safeParse(body).success).toBe(false);
  });
});

describe("storeSettingsUpdate — the primary language is always served", () => {
  const locale = fc.constantFrom(...STORE_LOCALES);
  const storedList = fc.option(
    fc.oneof(fc.array(fc.oneof(locale, fc.string())).map((list) => JSON.stringify(list)), fc.string()),
    { nil: null },
  );

  it("holds for any current row and any valid save", () => {
    fc.assert(
      fc.property(
        locale,
        storedList,
        fc.record({ lang: locale, enabledLocales: fc.array(locale, { minLength: 1 }) }, { requiredKeys: [] }),
        (currentLang, enabledLocalesJson, input) => {
          const current = { lang: currentLang, enabledLocalesJson };
          const update = storeSettingsUpdate(input, current);
          const lang = input.lang ?? currentLang;
          const after = {
            lang,
            enabledLocalesJson: update.enabledLocalesJson ?? enabledLocalesJson,
            contentOverridesJson: null,
          };
          const enabled = toStoreSettings(after as never).enabledLocales;
          expect(enabled[0]).toBe(lang);
          expect(new Set(enabled).size).toBe(enabled.length);
          expect(enabled.every(isStoreLocale)).toBe(true);
          for (const wanted of input.enabledLocales ?? []) expect(enabled).toContain(wanted);
        },
      ),
      { numRuns: 1000 },
    );
  });
});
