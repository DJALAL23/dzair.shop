/**
 * Migration 0068 on real D1: every table that shows a file gets its Media
 * Key, every key found gets one `media` row on R2, ready, and nothing that
 * was stored before changes.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestD1, replay, type TestD1 } from "@/test-utils/d1";

let d1: TestD1;
const T1 = "2026-09-01T10:00:00.000Z";
const T2 = "2026-10-01T10:00:00.000Z";
const MEDIA = "https://media.boutique.dz";

const run = (sql: string, ...binds: unknown[]) => d1.raw.prepare(sql).bind(...binds).run();
const all = async <R = Record<string, unknown>>(sql: string, ...binds: unknown[]) => (await d1.raw.prepare(sql).bind(...binds).all<R>()).results;
const one = async <R = Record<string, unknown>>(sql: string, ...binds: unknown[]) => (await d1.raw.prepare(sql).bind(...binds).first<R>())!;

const OLD_COLUMNS = {
  product_images: "SELECT id, src, r2_key, src_sm, src_md, src_lg, width, height FROM product_images ORDER BY id",
  landing_page_images: "SELECT id, r2_key, src FROM landing_page_images ORDER BY id",
  product_categories: "SELECT id, image_url FROM product_categories ORDER BY id",
  stores: "SELECT id, logo_url, og_image FROM stores ORDER BY id",
  review_media: "SELECT id, r2_key, thumb_key, content_type, bytes FROM review_media ORDER BY id",
};
let before: Record<string, unknown[]>;

beforeAll(async () => {
  d1 = await createTestD1({ before: "0068_media.sql" });
  await run("INSERT INTO stores (id, name, logo_url, og_image, created_at, updated_at) VALUES ('s1', 'Boutique', ?1, ?2, ?3, ?3)", `${MEDIA}/products/logo1.png`, "https://cdn.example.com/share.jpg", T1);
  await run("INSERT INTO product_categories (id, name, slug, image_url, created_at, updated_at) VALUES ('c1', 'Robes', 'robes', ?1, ?2, ?2), ('c2', 'Sacs', 'sacs', 'https://elsewhere.dz/bag.jpg', ?2, ?2), ('c3', 'Vide', 'vide', NULL, ?2, ?2)", `${MEDIA}/products/cat1.webp`, T1);
  await run("INSERT INTO products (id, name, handle, price, created_at, updated_at) VALUES ('p1', 'Robe', 'robe', 1000, ?1, ?1)", T1);
  await run(
    `INSERT INTO product_images (id, product_id, src, r2_key, width, height, created_at, updated_at) VALUES
      ('i1', 'p1', ?1, 'products/a1.jpg', 800, 600, ?3, ?3),
      ('i2', 'p1', ?2, NULL, NULL, NULL, ?3, ?3),
      ('i3', 'p1', 'https://elsewhere.dz/photo.jpg', NULL, NULL, NULL, ?3, ?3),
      ('i4', 'p1', ?4, NULL, NULL, NULL, ?3, ?3),
      ('i5', 'p1', 'https://old-cdn.boutique.dz/a5.png', 'products/a5.png', NULL, NULL, ?3, ?3)`,
    `${MEDIA}/products/a1.jpg`,
    `${MEDIA}/products/starter-dress.webp`,
    T1,
    `${MEDIA}/products/cat1.webp`,
  );
  await run("INSERT INTO landing_pages (id, slug, name, product_id, created_at, updated_at) VALUES ('lp1', 'promo', 'Promo', 'p1', ?1, ?1)", T1);
  await run("INSERT INTO landing_page_images (id, landing_page_id, r2_key, src, width, height, created_at) VALUES ('l1', 'lp1', 'landing/b1.webp', ?1, 1080, 1920, ?2)", `${MEDIA}/landing/b1.webp`, T2);
  await run("INSERT INTO reviews (id, store_id, product_id, customer_name, rating, body, created_at, updated_at) VALUES ('r1', 's1', 'p1', 'Amina', 5, 'Top', ?1, ?1)", T2);
  await run(
    `INSERT INTO review_media (id, review_id, kind, r2_key, thumb_key, content_type, bytes, width, height, duration_ms, created_at) VALUES
      ('m1', 'r1', 'image', 'reviews/r1/m1.webp', 'reviews/r1/m1-t.webp', 'image/webp', 51200, 1600, 1200, NULL, ?1),
      ('m2', 'r1', 'audio', 'reviews/r1/m2.webm', NULL, 'audio/webm', 90000, NULL, NULL, 12000, ?1)`,
    T2,
  );
  await run("INSERT INTO page_documents (id, store_id, theme_key, surface, document, created_at, updated_at) VALUES ('d1', 's1', 'theme-00', 'home', ?1, ?2, ?2)", JSON.stringify({ sections: [{ type: "hero", settings: { image: { key: "products/hero1.webp", alt: "Hero" } } }] }), T1);
  await run("INSERT INTO store_theme_settings (store_id, theme_key, \"values\", updated_at) VALUES ('s1', 'theme-00', ?1, ?2)", JSON.stringify({ logo: { key: "products/logo1.png" }, banner: { key: "products/banner1.webp" } }), T1);
  await run("INSERT INTO theme_drafts (id, store_id, theme_key, theme_version, created_at, updated_at) VALUES ('dr1', 's1', 'theme-00', '1.0.0', ?1, ?1)", T1);
  await run("INSERT INTO theme_draft_parts (draft_id, kind, key, value, updated_at) VALUES ('dr1', 'settings', '', ?1, ?2), ('dr1', 'document', 'about', NULL, ?2)", JSON.stringify({ banner: { key: "products/draft1.webp" } }), T1);
  await run("INSERT INTO theme_publications (id, store_id, theme_key, theme_version, state, published_at) VALUES ('pub1', 's1', 'theme-00', '1.0.0', ?1, ?2)", JSON.stringify([{ kind: "settings", key: "", value: { banner: { key: "products/old1.webp" } } }, { kind: "document", key: "home", value: { note: { key: "not-a-media-key" } } }]), T1);

  before = Object.fromEntries(await Promise.all(Object.entries(OLD_COLUMNS).map(async ([table, sql]) => [table, await all(sql)] as const)));
  await replay(d1.raw, ["0068_media.sql"]);
});

afterAll(async () => {
  await d1?.dispose();
});

describe("migration 0068 on a store with media", () => {
  it("gives each product image its key: the old key, else the one inside its URL, else none", async () => {
    expect(await all("SELECT id, media_key FROM product_images ORDER BY id")).toEqual([
      { id: "i1", media_key: "products/a1.jpg" },
      { id: "i2", media_key: "products/starter-dress.webp" },
      { id: "i3", media_key: null },
      { id: "i4", media_key: "products/cat1.webp" },
      { id: "i5", media_key: "products/a5.png" },
    ]);
  });

  it("gives landing images, categories, the logo and the share image their keys", async () => {
    expect(await all("SELECT id, media_key FROM landing_page_images")).toEqual([{ id: "l1", media_key: "landing/b1.webp" }]);
    expect(await all("SELECT id, image_key FROM product_categories ORDER BY id")).toEqual([
      { id: "c1", image_key: "products/cat1.webp" },
      { id: "c2", image_key: null },
      { id: "c3", image_key: null },
    ]);
    expect(await one("SELECT logo_key, og_image_key FROM stores WHERE id = 's1'")).toEqual({ logo_key: "products/logo1.png", og_image_key: null });
  });

  it("gives review files their keys, and refuses a key two review files would share", async () => {
    expect(await all("SELECT id, media_key FROM review_media ORDER BY id")).toEqual([
      { id: "m1", media_key: "reviews/r1/m1.webp" },
      { id: "m2", media_key: "reviews/r1/m2.webm" },
    ]);
    await expect(run("UPDATE review_media SET media_key = 'reviews/r1/m1.webp' WHERE id = 'm2'")).rejects.toThrow(/UNIQUE/);
  });

  it("records one ready R2 row per key found, from every column and theme document", async () => {
    const rows = await all<{ key: string }>(`SELECT "key", host, host_ref, kind, content_type, bytes, width, height, status FROM media ORDER BY "key"`);
    expect(rows).toEqual([
      { key: "landing/b1.webp", host: "r2", host_ref: null, kind: "image", content_type: "image/webp", bytes: null, width: 1080, height: 1920, status: "ready" },
      { key: "products/a1.jpg", host: "r2", host_ref: null, kind: "image", content_type: "image/jpeg", bytes: null, width: 800, height: 600, status: "ready" },
      { key: "products/a5.png", host: "r2", host_ref: null, kind: "image", content_type: "image/png", bytes: null, width: null, height: null, status: "ready" },
      { key: "products/banner1.webp", host: "r2", host_ref: null, kind: "image", content_type: "image/webp", bytes: null, width: null, height: null, status: "ready" },
      { key: "products/cat1.webp", host: "r2", host_ref: null, kind: "image", content_type: "image/webp", bytes: null, width: null, height: null, status: "ready" },
      { key: "products/draft1.webp", host: "r2", host_ref: null, kind: "image", content_type: "image/webp", bytes: null, width: null, height: null, status: "ready" },
      { key: "products/hero1.webp", host: "r2", host_ref: null, kind: "image", content_type: "image/webp", bytes: null, width: null, height: null, status: "ready" },
      { key: "products/logo1.png", host: "r2", host_ref: null, kind: "image", content_type: "image/png", bytes: null, width: null, height: null, status: "ready" },
      { key: "products/old1.webp", host: "r2", host_ref: null, kind: "image", content_type: "image/webp", bytes: null, width: null, height: null, status: "ready" },
      { key: "products/starter-dress.webp", host: "r2", host_ref: null, kind: "image", content_type: "image/webp", bytes: null, width: null, height: null, status: "ready" },
      { key: "reviews/r1/m1-t.webp", host: "r2", host_ref: null, kind: "image", content_type: "image/webp", bytes: null, width: null, height: null, status: "ready" },
      { key: "reviews/r1/m1.webp", host: "r2", host_ref: null, kind: "image", content_type: "image/webp", bytes: 51200, width: 1600, height: 1200, status: "ready" },
      { key: "reviews/r1/m2.webm", host: "r2", host_ref: null, kind: "audio", content_type: "audio/webm", bytes: 90000, width: null, height: null, status: "ready" },
    ]);
  });

  it("dates each row from the row that showed it, and gives every row its own id", async () => {
    expect(await one(`SELECT created_at, ready_at FROM media WHERE "key" = 'landing/b1.webp'`)).toEqual({ created_at: T2, ready_at: T2 });
    expect(await one(`SELECT created_at, ready_at FROM media WHERE "key" = 'reviews/r1/m2.webm'`)).toEqual({ created_at: T2, ready_at: T2 });
    expect(await one(`SELECT created_at, ready_at FROM media WHERE "key" = 'reviews/r1/m1-t.webp'`)).toEqual({ created_at: T2, ready_at: T2 });
    const ids = await all<{ id: string }>("SELECT id FROM media");
    expect(new Set(ids.map((row) => row.id)).size).toBe(ids.length);
    for (const { id } of ids) expect(id).toMatch(/^[0-9a-f]{32}$/);
  });

  it("changes nothing that was stored before", async () => {
    for (const [table, sql] of Object.entries(OLD_COLUMNS)) expect(await all(sql), table).toEqual(before[table]);
  });

  it("lets the server write images by key alone, and requires a key where every image has one", async () => {
    await run("INSERT INTO product_images (id, product_id, media_key, created_at, updated_at) VALUES ('n1', 'p1', 'products/new.webp', ?1, ?1)", T2);
    await run("INSERT INTO landing_page_images (id, landing_page_id, media_key, created_at) VALUES ('n2', 'lp1', 'landing/new.webp', ?1)", T2);
    await run("INSERT INTO review_media (id, review_id, kind, content_type, bytes, media_key, created_at) VALUES ('n3', 'r1', 'image', 'image/webp', 10, 'reviews/r1/new.webp', ?1)", T2);
    await expect(run("INSERT INTO landing_page_images (id, landing_page_id, created_at) VALUES ('n4', 'lp1', ?1)", T2)).rejects.toThrow(/NOT NULL/);
    await expect(run("INSERT INTO review_media (id, review_id, kind, content_type, bytes, created_at) VALUES ('n5', 'r1', 'image', 'image/webp', 10, ?1)", T2)).rejects.toThrow(/NOT NULL/);
    await run("DELETE FROM product_images WHERE id = 'n1'");
    await run("DELETE FROM landing_page_images WHERE id = 'n2'");
    await run("DELETE FROM review_media WHERE id = 'n3'");
  });

  it("keeps the rebuilt tables' indexes and cascades", async () => {
    const indexes = await all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'index' AND name IN ('idx_product_images_product_position', 'idx_landing_page_images_lp', 'idx_review_media_review') ORDER BY name");
    expect(indexes.map((row) => row.name)).toEqual(["idx_landing_page_images_lp", "idx_product_images_product_position", "idx_review_media_review"]);
    const fks = await all<{ t: string; ref: string; on_delete: string }>(
      "SELECT m.name AS t, f.\"table\" AS ref, f.on_delete FROM sqlite_master m, pragma_foreign_key_list(m.name) f WHERE m.name IN ('product_images', 'landing_page_images', 'review_media') ORDER BY m.name",
    );
    expect(fks).toEqual([
      { t: "landing_page_images", ref: "landing_pages", on_delete: "CASCADE" },
      { t: "product_images", ref: "products", on_delete: "CASCADE" },
      { t: "review_media", ref: "reviews", on_delete: "CASCADE" },
    ]);
  });

  it("refuses a second row for one key", async () => {
    await expect(run(`INSERT INTO media (id, "key", host, kind, content_type, status, created_at) VALUES ('x', 'products/a1.jpg', 'imagekit', 'image', 'image/jpeg', 'pending', ?1)`, T2)).rejects.toThrow(/UNIQUE/);
  });
});
