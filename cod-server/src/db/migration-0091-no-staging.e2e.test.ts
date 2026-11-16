/**
 * Migration 0091 on real D1: no Staging. Every review and every file keeps
 * its data. A review still waiting for a media job, which this release no
 * longer runs, goes to the merchant's queue as pending with its files
 * counted as dropped; every other review is untouched. A file can now carry
 * a voice note's length.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestD1, type TestD1 } from "@/test-utils/d1";

let d1: TestD1;
const T = "2026-11-16T08:00:00.000Z";
const all = async <R = Record<string, unknown>>(sql: string, ...binds: unknown[]) => (await d1.raw.prepare(sql).bind(...binds).all<R>()).results;
let reviewsBefore: Array<Record<string, unknown>>;
let mediaBefore: Array<Record<string, unknown>>;

const review = (id: string, status: string, dropped = 0) =>
  `INSERT INTO reviews (id, store_id, product_id, customer_name, rating, body, status, media_dropped, created_at, updated_at) VALUES ('${id}', 's1', 'p1', 'Amel', 5, 'Très belle robe', '${status}', ${dropped}, '${T}', '${T}')`;
const file = (id: string, key: string, kind: string, contentType: string) =>
  `INSERT INTO media (id, key, host, host_ref, kind, content_type, bytes, width, height, status, created_at, ready_at) VALUES ('${id}', '${key}', 'r2', NULL, '${kind}', '${contentType}', 2048, 1600, 1200, 'ready', '${T}', '${T}')`;

beforeAll(async () => {
  d1 = await createTestD1({ before: "0091_no_staging.sql" });
  await d1.raw.batch(
    [
      `INSERT INTO stores (id, name, created_at, updated_at) VALUES ('s1', 'Store', '${T}', '${T}')`,
      `INSERT INTO products (id, name, handle, price, created_at, updated_at) VALUES ('p1', 'Robe', 'robe', 1500, '${T}', '${T}')`,
      review("r-processing", "processing"),
      review("r-processing-dropped", "processing", 2),
      review("r-pending", "pending"),
      review("r-approved", "approved", 1),
      review("r-rejected", "rejected"),
      file("m-photo", "reviews/r-approved/a.webp", "image", "image/webp"),
      file("m-voice", "reviews/r-approved/b.ogg", "audio", "audio/ogg"),
    ].map((sql) => d1.raw.prepare(sql)),
  );
  reviewsBefore = await all("SELECT * FROM reviews ORDER BY id");
  mediaBefore = await all("SELECT * FROM media ORDER BY id");
  await d1.applyRemaining();
}, 120_000);

afterAll(async () => {
  await d1?.dispose();
});

describe("migration 0091", () => {
  it("keeps every file as it was, with no length yet", async () => {
    const after = await all("SELECT * FROM media ORDER BY id");
    expect(after.map(({ duration_ms, ...row }) => ({ row, duration_ms }))).toEqual(mediaBefore.map((row) => ({ row, duration_ms: null })));
  });

  it("keeps every review that was not waiting exactly as it was", async () => {
    const after = await all("SELECT * FROM reviews WHERE id NOT LIKE 'r-processing%' ORDER BY id");
    expect(after).toEqual(reviewsBefore.filter((row) => !String(row.id).startsWith("r-processing")));
  });

  it("sends a review still waiting for its media job to the merchant's queue, its files counted as dropped", async () => {
    const after = await all<Record<string, unknown>>("SELECT * FROM reviews WHERE id LIKE 'r-processing%' ORDER BY id");
    const before = reviewsBefore.filter((row) => String(row.id).startsWith("r-processing"));
    expect(after.map(({ status, media_dropped, updated_at: _at, ...rest }) => ({ rest, status, media_dropped }))).toEqual([
      { rest: (({ status: _s, media_dropped: _d, updated_at: _u, ...rest }) => rest)(before[0]), status: "pending", media_dropped: 1 },
      { rest: (({ status: _s, media_dropped: _d, updated_at: _u, ...rest }) => rest)(before[1]), status: "pending", media_dropped: 2 },
    ]);
    for (const row of after) expect(String(row.updated_at) > T).toBe(true);
  });

  it("leaves no review waiting", async () => {
    expect(await all("SELECT count(*) n FROM reviews WHERE status = 'processing'")).toEqual([{ n: 0 }]);
  });

  it("keeps a voice note's length with its file", async () => {
    await d1.raw.prepare("INSERT INTO media (id, key, host, kind, content_type, bytes, status, created_at, duration_ms) VALUES ('m-new', 'reviews/g/c.webm', 'imagekit', 'audio', 'audio/webm', 900, 'ready', ?1, 41500)").bind(T).run();
    expect(await all("SELECT duration_ms FROM media WHERE id = 'm-new'")).toEqual([{ duration_ms: 41500 }]);
  });
});
