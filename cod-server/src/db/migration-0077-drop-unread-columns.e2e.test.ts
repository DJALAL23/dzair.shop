/**
 * Migration 0077 on real D1: the columns nothing reads go, and every row
 * keeps every other value — a store, a category, a product's and a landing
 * page's images, and a review's media, which is rebuilt without its old key.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestD1, type TestD1 } from "@/test-utils/d1";

let d1: TestD1;
const T = "2026-11-07T10:00:00.000Z";

const run = (sql: string, ...binds: unknown[]) => d1.raw.prepare(sql).bind(...binds).run();
const all = async <R = Record<string, unknown>>(sql: string, ...binds: unknown[]) => (await d1.raw.prepare(sql).bind(...binds).all<R>()).results;
const columns = async (table: string) => (await all<{ name: string }>(`SELECT name FROM pragma_table_info('${table}')`)).map((c) => c.name);

beforeAll(async () => {
  d1 = await createTestD1({ before: "0077_drop_unread_columns.sql" });
  await run("INSERT INTO stores (id, name, lang, primary_color, status, logo_url, logo_key, og_image, created_at, updated_at) VALUES ('s1', 'Maysa', 'ar', '#123456', 'active', 'https://old/logo.png', 'branding/logo.webp', 'https://old/og.png', ?1, ?1)", T);
  await run("INSERT INTO product_categories (id, name, slug, image_url, image_key, created_at, updated_at) VALUES ('cat', 'Robes', 'robes', 'https://old/cat.png', 'categories/cat.webp', ?1, ?1)", T);
  await run("INSERT INTO products (id, name, handle, price, created_at, updated_at) VALUES ('p1', 'Robe', 'robe', 2500, ?1, ?1)", T);
  await run("INSERT INTO product_images (id, product_id, src, r2_key, media_key, alt_text, position, created_at, updated_at) VALUES ('i1', 'p1', 'https://old/i1.png', 'old/i1', 'products/i1.webp', 'Robe', 1, ?1, ?1)", T);
  await run("INSERT INTO landing_pages (id, slug, name, product_id, created_at, updated_at) VALUES ('lp', 'lp-1', 'LP', 'p1', ?1, ?1)", T);
  await run("INSERT INTO landing_page_images (id, landing_page_id, r2_key, src, media_key, position, created_at) VALUES ('li', 'lp', 'old/li', 'https://old/li.png', 'landing/li.webp', 1, ?1)", T);
  await run("INSERT INTO reviews (id, store_id, product_id, customer_name, rating, body, created_at, updated_at) VALUES ('r1', 's1', 'p1', 'Karim', 5, 'Top', ?1, ?1)", T);
  await run("INSERT INTO review_media (id, review_id, kind, r2_key, thumb_key, content_type, bytes, width, height, position, created_at, media_key) VALUES ('m1', 'r1', 'image', 'old/m1', 'reviews/r1/m1-t.webp', 'image/webp', 1200, 64, 48, 0, ?1, 'reviews/r1/m1.webp')", T);
  await d1.applyRemaining();
}, 120_000);

afterAll(async () => d1?.dispose());

describe("migration 0077 on a store with data", () => {
  it("drops every unread column", async () => {
    for (const gone of ["primary_color", "accent_color", "bg_color", "font_family", "status", "logo_url", "og_image"]) expect(await columns("stores")).not.toContain(gone);
    expect(await columns("product_categories")).not.toContain("image_url");
    for (const gone of ["src", "r2_key", "src_sm", "src_md", "src_lg"]) expect(await columns("product_images")).not.toContain(gone);
    for (const gone of ["src", "r2_key"]) expect(await columns("landing_page_images")).not.toContain(gone);
    expect(await columns("review_media")).not.toContain("r2_key");
    expect(await all("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_webhook_events_order'")).toEqual([]);
  });

  it("keeps every row and its media keys", async () => {
    expect(await all("SELECT id, name, logo_key FROM stores")).toEqual([{ id: "s1", name: "Maysa", logo_key: "branding/logo.webp" }]);
    expect(await all("SELECT id, image_key FROM product_categories")).toEqual([{ id: "cat", image_key: "categories/cat.webp" }]);
    expect(await all("SELECT id, media_key, alt_text, position FROM product_images")).toEqual([{ id: "i1", media_key: "products/i1.webp", alt_text: "Robe", position: 1 }]);
    expect(await all("SELECT id, media_key FROM landing_page_images")).toEqual([{ id: "li", media_key: "landing/li.webp" }]);
    expect(await all("SELECT id, review_id, kind, thumb_key, content_type, bytes, width, height, position, created_at, media_key FROM review_media")).toEqual([
      { id: "m1", review_id: "r1", kind: "image", thumb_key: "reviews/r1/m1-t.webp", content_type: "image/webp", bytes: 1200, width: 64, height: 48, position: 0, created_at: T, media_key: "reviews/r1/m1.webp" },
    ]);
  });

  it("keeps review media's constraints, index and cascade", async () => {
    await expect(run("INSERT INTO review_media (id, review_id, kind, content_type, bytes, created_at, media_key) VALUES ('m2', 'r1', 'video', 'x', 1, ?1, 'reviews/x')", T)).rejects.toThrow(/CHECK/);
    await expect(run("INSERT INTO review_media (id, review_id, kind, content_type, bytes, created_at, media_key) VALUES ('m3', 'r1', 'image', 'x', 1, ?1, 'reviews/r1/m1.webp')", T)).rejects.toThrow(/UNIQUE/);
    expect(await all("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_review_media_review'")).toHaveLength(1);
    await run("DELETE FROM reviews WHERE id = 'r1'");
    expect(await all("SELECT id FROM review_media")).toEqual([]);
  });
});
