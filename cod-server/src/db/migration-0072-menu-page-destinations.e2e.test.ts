/**
 * Migration 0072 on real D1: store_menu_items is rebuilt to accept search,
 * order tracking and contact as destinations. Every item, nested or not,
 * keeps its id and values, every translation keeps its item, and the
 * translation trigger still runs.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestD1, type TestD1 } from "@/test-utils/d1";

let d1: TestD1;
const T = "2026-11-01T10:00:00.000Z";

const run = (sql: string, ...binds: unknown[]) => d1.raw.prepare(sql).bind(...binds).run();
const all = async <R = Record<string, unknown>>(sql: string, ...binds: unknown[]) => (await d1.raw.prepare(sql).bind(...binds).all<R>()).results;

const ITEMS = "SELECT id, menu_id, parent_id, position, label, destination_type, destination_ref, url, created_at, updated_at FROM store_menu_items ORDER BY id";
const TRANSLATIONS = "SELECT resource_type, resource_id, locale, key, value FROM translations ORDER BY resource_id, locale";
let itemsBefore: Record<string, unknown>[];
let translationsBefore: Record<string, unknown>[];

const item = (id: string, parent: string | null, position: number, type: string, ref: string | null, url: string | null) =>
  run(
    "INSERT INTO store_menu_items (id, menu_id, parent_id, position, label, destination_type, destination_ref, url, created_at, updated_at) VALUES (?1, 'm1', ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
    id,
    parent,
    position,
    `Item ${id}`,
    type,
    ref,
    url,
    T,
  );

beforeAll(async () => {
  d1 = await createTestD1({ before: "0072_menu_page_destinations.sql" });
  await run("INSERT INTO stores (id, name, lang, created_at, updated_at) VALUES ('s1', 'Maysa', 'ar', ?1, ?1)", T);
  await run("INSERT INTO store_menus (id, store_id, handle, title, created_at, updated_at) VALUES ('m1', 's1', 'footer', 'Footer', ?1, ?1)", T);
  await item("i-home", null, 0, "home", null, null);
  await item("i-shop", null, 1, "catalog", null, null);
  await item("i-cat", "i-shop", 0, "category", "c1", null);
  await item("i-col", "i-cat", 0, "collection", "col1", null);
  await item("i-url", null, 2, "url", null, "/pages/faq");
  for (const id of ["i-home", "i-cat"]) {
    await run("INSERT INTO translations (resource_type, resource_id, locale, key, value, source_digest, updated_at) VALUES ('menuItem', ?1, 'fr', 'label', ?2, 'd', ?3)", id, `FR ${id}`, T);
  }
  itemsBefore = await all(ITEMS);
  translationsBefore = await all(TRANSLATIONS);
  await d1.applyRemaining();
});

afterAll(async () => {
  await d1?.dispose();
});

describe("migration 0072 on a store with menus", () => {
  it("keeps every item, its id, its parent and every value", async () => {
    expect(itemsBefore).toHaveLength(5);
    expect(await all(ITEMS)).toEqual(itemsBefore);
  });

  it("keeps every item's translations", async () => {
    expect(translationsBefore).toHaveLength(2);
    expect(await all(TRANSLATIONS)).toEqual(translationsBefore);
  });

  it("accepts search, order tracking and contact, with no ref and no url", async () => {
    await item("i-search", null, 3, "search", null, null);
    await item("i-track", null, 4, "trackOrder", null, null);
    await item("i-contact", null, 5, "contact", null, null);
    expect(await all("SELECT destination_type FROM store_menu_items WHERE id IN ('i-search', 'i-track', 'i-contact') ORDER BY position")).toEqual([
      { destination_type: "search" },
      { destination_type: "trackOrder" },
      { destination_type: "contact" },
    ]);
  });

  it("still refuses an unknown destination, and a page destination with a ref", async () => {
    await expect(item("i-bad", null, 6, "cart", null, null)).rejects.toThrow(/CHECK/);
    await expect(item("i-bad", null, 6, "contact", "x", null)).rejects.toThrow(/CHECK/);
  });

  it("still deletes an item's children and translations with it", async () => {
    await run("DELETE FROM store_menu_items WHERE id = 'i-shop'");
    expect(await all("SELECT id FROM store_menu_items WHERE id IN ('i-shop', 'i-cat', 'i-col')")).toEqual([]);
    expect(await all("SELECT resource_id FROM translations WHERE resource_id = 'i-cat'")).toEqual([]);
    expect(await all("SELECT resource_id FROM translations WHERE resource_id = 'i-home'")).toEqual([{ resource_id: "i-home" }]);
  });
});
