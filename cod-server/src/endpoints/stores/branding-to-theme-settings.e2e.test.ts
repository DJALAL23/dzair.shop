/**
 * Migration 0047 moves a store's colors and font into Theme-00's settings, so
 * the storefront looks the same the day the dashboard stops editing them.
 * Real D1, real migrations.
 */
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestD1, type TestD1 } from "@/test-utils/d1";

const T = "2026-10-01T00:00:00.000Z";
let d1: TestD1;

const store = (id: string, primary: string, accent: string, bg: string, font: string) =>
  d1.db.run(sql`INSERT INTO stores (id, name, lang, primary_color, accent_color, bg_color, font_family, created_at, updated_at)
    VALUES (${id}, ${id}, 'ar', ${primary}, ${accent}, ${bg}, ${font}, ${T}, ${T})`);

beforeAll(async () => {
  d1 = await createTestD1({ before: "0047_store_branding_to_theme_settings.sql" });
  await store("chosen", "#0B3BBD", "#f90", "#ffffff", "\"Tajawal\", sans-serif");
  await store("defaults", "#7c3aed", "#f59e0b", "#f8f8f8", "Cairo, sans-serif");
  await store("junk", "blue", "#12345", "url(x)", "ibm plex sans arabic");
  await store("saved", "#111111", "#222222", "#333333", "Almarai");
  await d1.db.run(sql`INSERT INTO store_theme_settings (store_id, theme_key, "values", updated_at)
    VALUES ('saved', 'theme-00', '{"primaryColor":"#abcdef","headerMenu":"top"}', ${T}), ('saved', 'other', '{"x":1}', ${T})`);
  await d1.applyRemaining();
}, 120_000);

afterAll(async () => {
  await d1?.dispose();
});

const settings = async (id: string, theme = "theme-00") => {
  const row = await d1.raw.prepare(`SELECT "values" FROM store_theme_settings WHERE store_id = ? AND theme_key = ?`).bind(id, theme).first<{ values: string }>();
  return row ? JSON.parse(row.values) : null;
};

describe("migration 0047", () => {
  it("copies the colors a store chose, and its font when Theme-00 ships that face", async () => {
    expect(await settings("chosen")).toEqual({ primaryColor: "#0B3BBD", accentColor: "#f90", backgroundColor: "#ffffff", font: "Tajawal" });
  });

  it("keeps the colors stores render today, and leaves out a font the theme cannot show", async () => {
    expect(await settings("defaults")).toEqual({ primaryColor: "#7c3aed", accentColor: "#f59e0b", backgroundColor: "#f8f8f8" });
  });

  it("copies no value the theme would refuse, and matches a font whatever its case", async () => {
    expect(await settings("junk")).toEqual({ font: "IBM Plex Sans Arabic" });
  });

  it("never overwrites what the store already saved for the theme, nor another theme's settings", async () => {
    expect(await settings("saved")).toEqual({ primaryColor: "#abcdef", headerMenu: "top", accentColor: "#222222", backgroundColor: "#333333", font: "Almarai" });
    expect(await settings("saved", "other")).toEqual({ x: 1 });
  });
});
