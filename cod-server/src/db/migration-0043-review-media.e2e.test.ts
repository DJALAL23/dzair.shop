/**
 * Migration 0043 on real D1: reviews written before it keep everything, gain
 * who entered them and whether they rest on a delivered order; afterwards a
 * basket can be reviewed once per product, a review can carry photos and a
 * voice note that go with it, and the database refuses what the app never
 * meant to store.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestD1, type TestD1 } from "@/test-utils/d1";

let d1: TestD1;
const T = "2026-10-16T10:00:00.000Z";

const run = (sql: string, ...binds: unknown[]) => d1.raw.prepare(sql).bind(...binds).run();
const all = async <R = Record<string, unknown>>(sql: string, ...binds: unknown[]) => (await d1.raw.prepare(sql).bind(...binds).all<R>()).results;

beforeAll(async () => {
  d1 = await createTestD1({ before: "0043_review_media.sql" });
  const seed = [
    "INSERT INTO stores (id, name, reviews_enabled, created_at, updated_at) VALUES ('s1', 'Store', 1, ?1, ?1)",
    "INSERT INTO customers (id, name, phone, wilaya, created_at) VALUES ('c1', 'Karim', '0551234567', 'Alger', ?1)",
    "INSERT INTO delivery_companies (id, name, name_ar, code, provider, created_at, updated_at) VALUES ('co1', 'ZR', 'ZR', 'zr_express', 'zr_express', ?1, ?1)",
    "INSERT INTO products (id, name, handle, price, created_at, updated_at) VALUES ('p1', 'Robe', 'robe', 1500, ?1, ?1)",
    "INSERT INTO products (id, name, handle, price, created_at, updated_at) VALUES ('p2', 'Foulard', 'foulard', 500, ?1, ?1)",
    "INSERT INTO orders (id, order_number, customer_id, customer_name, phone, price, status, created_at, updated_at) VALUES ('oD', 'ORD-D', 'c1', 'Karim', '0551234567', 2000, 'ready', ?1, ?1)",
    "INSERT INTO orders (id, order_number, customer_id, customer_name, phone, price, created_at, updated_at) VALUES ('oN', 'ORD-N', 'c1', 'Karim', '0551234567', 1500, ?1, ?1)",
    "INSERT INTO shipments (id, order_id, kind, company_id, handoff_state, carrier_parcel_id, delivery_type, cod_amount, revision, delivered_at, created_at, updated_at) VALUES ('shD', 'oD', 'carrier', 'co1', 'accepted', 'P-1', 'home', 2000, 1, ?1, ?1, ?1)",
    "INSERT INTO reviews (id, store_id, product_id, order_id, order_number, customer_name, rating, title, body, status, helpful_count, created_at, updated_at) VALUES ('rD', 's1', 'p1', 'oD', 'ORD-D', 'Karim', 5, 'Top', 'Très belle robe', 'approved', 0, ?1, ?1)",
    "INSERT INTO reviews (id, store_id, product_id, order_id, order_number, customer_name, rating, body, created_at, updated_at) VALUES ('rN', 's1', 'p1', 'oN', 'ORD-N', 'Karim', 2, 'Pas encore reçue', ?1, ?1)",
  ];
  for (const sql of seed) await run(sql, T);
  await d1.applyRemaining({ until: "0044" });
}, 120_000);

afterAll(async () => {
  await d1?.dispose();
});

describe("reviews written before 0043", () => {
  it("keep everything they had, and say who entered them and whether the order was delivered", async () => {
    expect(await all("select id, product_id, order_id, customer_id, order_number, customer_name, rating, title, body, status, source, verified, media_dropped, created_by from reviews order by id")).toEqual([
      { id: "rD", product_id: "p1", order_id: "oD", customer_id: "c1", order_number: "ORD-D", customer_name: "Karim", rating: 5, title: "Top", body: "Très belle robe", status: "approved", source: "storefront", verified: 1, media_dropped: 0, created_by: null },
      { id: "rN", product_id: "p1", order_id: "oN", customer_id: "c1", order_number: "ORD-N", customer_name: "Karim", rating: 2, title: null, body: "Pas encore reçue", status: "pending", source: "storefront", verified: 0, media_dropped: 0, created_by: null },
    ]);
  });

  it("the store keeps checking every review; photos are allowed, voice notes are not", async () => {
    expect(await all("select review_max_photos, review_voice_max_seconds, review_auto_publish from stores")).toEqual([
      { review_max_photos: 3, review_voice_max_seconds: null, review_auto_publish: "off" },
    ]);
  });
});

describe("after 0043", () => {
  it("a basket is reviewed once per product, never twice for one", async () => {
    await run("INSERT INTO reviews (id, store_id, product_id, order_id, customer_name, rating, body, created_at, updated_at) VALUES ('rD2', 's1', 'p2', 'oD', 'Karim', 4, 'Joli foulard', ?1, ?1)", T);
    await expect(run("INSERT INTO reviews (id, store_id, product_id, order_id, customer_name, rating, body, created_at, updated_at) VALUES ('rD3', 's1', 'p1', 'oD', 'Karim', 1, 'Encore une', ?1, ?1)", T)).rejects.toThrow(/UNIQUE/);
  });

  it("a review needs no order, and many such reviews can name one product", async () => {
    for (const id of ["m1", "m2"]) {
      await run("INSERT INTO reviews (id, store_id, product_id, customer_id, customer_name, rating, body, source, created_by, created_at, updated_at) VALUES (?2, 's1', 'p1', 'c1', 'Karim', 5, 'Reçu par WhatsApp', 'merchant', 'u1', ?1, ?1)", T, id);
    }
    expect(await all("select count(*) n from reviews where order_id is null")).toEqual([{ n: 2 }]);
  });

  it("refuses what the app never meant to store", async () => {
    const bad = [
      "rating 0", "INSERT INTO reviews (id, store_id, product_id, customer_name, rating, body, created_at, updated_at) VALUES ('x1', 's1', 'p1', 'K', 0, 'b', ?1, ?1)",
      "rating 6", "INSERT INTO reviews (id, store_id, product_id, customer_name, rating, body, created_at, updated_at) VALUES ('x2', 's1', 'p1', 'K', 6, 'b', ?1, ?1)",
      "status", "INSERT INTO reviews (id, store_id, product_id, customer_name, rating, body, status, created_at, updated_at) VALUES ('x3', 's1', 'p1', 'K', 3, 'b', 'hidden', ?1, ?1)",
      "source", "INSERT INTO reviews (id, store_id, product_id, customer_name, rating, body, source, created_at, updated_at) VALUES ('x4', 's1', 'p1', 'K', 3, 'b', 'ai', ?1, ?1)",
      "media kind", "INSERT INTO review_media (id, review_id, kind, r2_key, content_type, bytes, created_at) VALUES ('x5', 'rD', 'video', 'reviews/rD/x5.mp4', 'video/mp4', 10, ?1)",
      "empty file", "INSERT INTO review_media (id, review_id, kind, r2_key, content_type, bytes, created_at) VALUES ('x6', 'rD', 'image', 'reviews/rD/x6.webp', 'image/webp', 0, ?1)",
    ];
    for (let i = 0; i < bad.length; i += 2) await expect(run(bad[i + 1], T), bad[i]).rejects.toThrow(/CHECK/);
    await expect(run("UPDATE stores SET review_max_photos = 7")).rejects.toThrow(/CHECK/);
    await expect(run("UPDATE stores SET review_voice_max_seconds = 45")).rejects.toThrow(/CHECK/);
    await expect(run("UPDATE stores SET review_auto_publish = 'some'")).rejects.toThrow(/CHECK/);
  });

  it("a review's photos and voice note go with it; a removed customer leaves the review", async () => {
    await run("INSERT INTO review_media (id, review_id, kind, r2_key, thumb_key, content_type, bytes, width, height, position, created_at) VALUES ('md1', 'rD', 'image', 'reviews/rD/md1.webp', 'reviews/rD/md1-t.webp', 'image/webp', 120000, 1600, 1200, 0, ?1)", T);
    await run("INSERT INTO review_media (id, review_id, kind, r2_key, content_type, bytes, duration_ms, position, created_at) VALUES ('md2', 'rD', 'audio', 'reviews/rD/md2.webm', 'audio/webm', 90000, 31000, 1, ?1)", T);
    await expect(run("INSERT INTO review_media (id, review_id, kind, r2_key, content_type, bytes, created_at) VALUES ('md3', 'rD', 'image', 'reviews/rD/md1.webp', 'image/webp', 5, ?1)", T)).rejects.toThrow(/UNIQUE/);

    await run("DELETE FROM reviews WHERE id = 'rD'");
    expect(await all("select count(*) n from review_media")).toEqual([{ n: 0 }]);

    await run("DELETE FROM reviews WHERE source = 'merchant' AND id = 'm2'");
    await run("UPDATE reviews SET customer_id = 'c1' WHERE id = 'm1'");
    await run("DELETE FROM reviews WHERE order_id IS NOT NULL");
    await run("DELETE FROM shipments");
    await run("DELETE FROM orders");
    await run("DELETE FROM customers WHERE id = 'c1'");
    expect(await all("select id, customer_id, customer_name from reviews")).toEqual([{ id: "m1", customer_id: null, customer_name: "Karim" }]);
    expect((await d1.raw.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
  });

  it("keeps the indexes the reads use", async () => {
    const names = (await all<{ name: string }>("select name from sqlite_master where type = 'index' and tbl_name in ('reviews', 'review_media') and name not like 'sqlite_%' order by name")).map((r) => r.name);
    expect(names).toEqual(["idx_review_media_review", "idx_reviews_customer", "idx_reviews_product_status", "idx_reviews_status_created", "reviews_order_product"]);
    const plan = await all<{ detail: string }>("EXPLAIN QUERY PLAN select * from reviews where product_id = 'p1' and status = 'approved' order by created_at desc limit 10");
    expect(plan.map((p) => p.detail).join(" ")).toMatch(/idx_reviews_product_status/);
    expect(plan.map((p) => p.detail).join(" ")).not.toMatch(/TEMP B-TREE/);
  });
});
