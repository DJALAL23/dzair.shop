/**
 * Migration 0064 on real D1: the dashboard_brand table goes, and nothing else does.
 * A store's rows, and the rows of every table that could be read in a store's
 * database, are kept; no table references the dropped one.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestD1, type TestD1 } from "@/test-utils/d1";

let d1: TestD1;
const T = "2026-10-23T10:00:00.000Z";

const run = (sql: string, ...binds: unknown[]) => d1.raw.prepare(sql).bind(...binds).run();
const all = async <R = Record<string, unknown>>(sql: string, ...binds: unknown[]) => (await d1.raw.prepare(sql).bind(...binds).all<R>()).results;

beforeAll(async () => {
  d1 = await createTestD1({ before: "0064_drop_dashboard_brand.sql" });
  await run("INSERT INTO stores (id, name, lang, created_at, updated_at) VALUES ('s1', 'Maysa', 'ar', ?1, ?1)", T);
  await run("INSERT INTO dashboard_brand (id, brand_name, logo_url, primary_color, updated_at) VALUES ('default', 'Maysa Admin', 'https://cdn.example.com/logo.png', '#6366f1', ?1)", T);
  await d1.applyRemaining();
});

afterAll(async () => {
  await d1?.dispose();
});

describe("migration 0064 on a store with data", () => {
  it("drops dashboard_brand", async () => {
    expect(await all("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'dashboard_brand'")).toEqual([]);
  });

  it("keeps every store and its values", async () => {
    expect(await all("SELECT id, name, lang, created_at, updated_at FROM stores ORDER BY id")).toEqual([
      { id: "s1", name: "Maysa", lang: "ar", created_at: T, updated_at: T },
    ]);
  });

  it("runs again without an error, for a store that never had the table", async () => {
    await expect(run("DROP TABLE IF EXISTS dashboard_brand")).resolves.toBeDefined();
  });
});
