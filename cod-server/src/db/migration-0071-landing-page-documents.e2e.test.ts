/**
 * Migration 0071 on real D1: a landing page's own documents (`lp:<id>`) and
 * their draft parts go when the page goes, a document written for a page
 * that no longer exists does not stay, and every other row is untouched.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestD1, type TestD1 } from "@/test-utils/d1";

let d1: TestD1;

const T = "2026-10-31T10:00:00.000Z";
const run = (sql: string, ...binds: unknown[]) => d1.raw.prepare(sql).bind(...binds).run();
const all = async <R = Record<string, unknown>>(sql: string, ...binds: unknown[]) => (await d1.raw.prepare(sql).bind(...binds).all<R>()).results;
const doc = (surface: string) => JSON.stringify({ version: 1, surface, sections: [] });
const surfaces = async () => (await all<{ surface: string }>("SELECT surface FROM page_documents ORDER BY surface")).map((row) => row.surface);
const draftKeys = async () => (await all<{ key: string }>("SELECT kind || ':' || key AS key FROM theme_draft_parts ORDER BY key")).map((row) => row.key);

beforeAll(async () => {
  d1 = await createTestD1();
  await run("INSERT INTO stores (id, name, lang, created_at, updated_at) VALUES ('s1', 'Store', 'ar', ?1, ?1)", T);
  await run(
    "INSERT INTO products (id, name, handle, price, has_variants, inventory, track_inventory, low_stock_threshold, status, visibility, show_in_store, created_at, updated_at) VALUES ('p1', 'Robe', 'robe', 2400, 0, 10, 1, 2, 'ACTIVE', 1, 1, ?1, ?1)",
    T,
  );
  for (const id of ["7f3a", "9c2e"]) {
    await run("INSERT INTO landing_pages (id, slug, name, product_id, created_at, updated_at) VALUES (?1, 'lp-' || ?1, 'Offer ' || ?1, 'p1', ?2, ?2)", id, T);
  }
  for (const [id, theme, surface] of [
    ["d1", "theme-00", "lp:7f3a"],
    ["d2", "theme-baby", "lp:7f3a"],
    ["d3", "theme-00", "lp:9c2e"],
    ["d4", "theme-00", "home"],
    ["d5", "theme-00", "landing"],
  ]) {
    await run("INSERT INTO page_documents (id, store_id, theme_key, surface, document, created_at, updated_at) VALUES (?1, 's1', ?2, ?3, ?4, ?5, ?5)", id, theme, surface, doc(surface!), T);
  }
  await run("INSERT INTO theme_drafts (id, store_id, theme_key, theme_version, created_at, updated_at) VALUES ('draft', 's1', 'theme-00', '3.3.0', ?1, ?1)", T);
  for (const [kind, key, value] of [
    ["document", "lp:7f3a", doc("lp:7f3a")],
    ["document", "lp:9c2e", doc("lp:9c2e")],
    ["document", "home", doc("home")],
    ["settings", "", "{}"],
  ]) {
    await run("INSERT INTO theme_draft_parts (draft_id, kind, key, value, updated_at) VALUES ('draft', ?1, ?2, ?3, ?4)", kind, key, value, T);
  }
}, 120_000);

afterAll(async () => {
  await d1?.dispose();
});

describe("migration 0071 — a landing page's documents live and die with it", () => {
  it("keeps every document and draft part while the pages exist", async () => {
    expect(await surfaces()).toEqual(["home", "landing", "lp:7f3a", "lp:7f3a", "lp:9c2e"]);
    expect(await draftKeys()).toEqual(["settings:", "document:home", "document:lp:7f3a", "document:lp:9c2e"].sort());
  });

  it("deletes a deleted page's documents for every theme, and its draft parts, and nothing else", async () => {
    await run("DELETE FROM landing_pages WHERE id = '7f3a'");
    expect(await surfaces()).toEqual(["home", "landing", "lp:9c2e"]);
    expect(await draftKeys()).toEqual(["settings:", "document:home", "document:lp:9c2e"].sort());
    expect(await all("SELECT revision FROM theme_drafts WHERE id = 'draft'")).toEqual([{ revision: 0 }]);
  });

  it("does not keep a document written for a page that no longer exists", async () => {
    await run("INSERT INTO page_documents (id, store_id, theme_key, surface, document, created_at, updated_at) VALUES ('late', 's1', 'theme-00', 'lp:7f3a', ?1, ?2, ?2)", doc("lp:7f3a"), T);
    expect(await surfaces()).toEqual(["home", "landing", "lp:9c2e"]);
    await run("INSERT INTO page_documents (id, store_id, theme_key, surface, document, created_at, updated_at) VALUES ('kept', 's1', 'theme-baby', 'lp:9c2e', ?1, ?2, ?2)", doc("lp:9c2e"), T);
    expect(await surfaces()).toEqual(["home", "landing", "lp:9c2e", "lp:9c2e"]);
  });
});
