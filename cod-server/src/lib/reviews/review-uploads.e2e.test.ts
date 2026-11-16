/**
 * The review-upload queries on real D1 (cod-shared/queries/review-uploads.ts):
 * the SQL they really send reads `media` by its unique key index and
 * `review_media` by its unique key indexes — never a scan of either table,
 * however many files a store keeps — and stays far under D1's 100 bound
 * parameters for the most uploads a review takes.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/d1";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import * as schema from "@/db/schema";
import type { AppDb } from "@/db";
import { findUploads, MAX_UPLOADS_PER_LOOKUP, waitingUploads } from "../../../../cod-shared/queries/review-uploads";

let d1: TestD1;
const sent: Array<{ sql: string; params: unknown[] }> = [];
let db: AppDb;

beforeAll(async () => {
  d1 = await createTestD1();
  db = drizzle(d1.raw, { schema, logger: { logQuery: (sql, params) => void sent.push({ sql, params }) } }) as unknown as AppDb;
}, 120_000);

afterAll(async () => {
  await d1?.dispose();
});

async function plan(query: { sql: string; params: unknown[] }): Promise<string> {
  const rows = (await d1.raw.prepare(`EXPLAIN QUERY PLAN ${query.sql}`).bind(...query.params).all<{ detail: string }>()).results;
  return rows.map((row) => row.detail).join(" | ");
}

const GRANT = "a".repeat(32);
const ids = Array.from({ length: 8 }, (_, i) => String(i).repeat(32));

describe("the review-upload queries", () => {
  it("count a folder's waiting files through the key indexes", async () => {
    sent.length = 0;
    await waitingUploads(db, GRANT);
    expect(sent).toHaveLength(1);
    const detail = await plan(sent[0]!);
    expect(detail).toMatch(/SEARCH media USING INDEX sqlite_autoindex_media_\d+ \(key>\? AND key<\?\)/);
    expect(detail).not.toMatch(/SCAN media\b/);
    expect(detail).not.toMatch(/SCAN review_media\b/);
  });

  it("find a review's files by their exact keys, the most a review takes well under 100 parameters", async () => {
    sent.length = 0;
    await findUploads(db, { folder: GRANT, ids, host: "imagekit" });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.params.length).toBeLessThan(100);
    const detail = await plan(sent[0]!);
    expect(detail).toMatch(/SEARCH media USING INDEX sqlite_autoindex_media_\d+ \(key=\?\)/);
    expect(detail).not.toMatch(/SCAN media\b/);
    expect(detail).not.toMatch(/SCAN review_media\b/);
  });

  it("refuses to look up more uploads than D1 can bind, rather than fail inside D1", async () => {
    expect(MAX_UPLOADS_PER_LOOKUP * 6 + 2).toBeLessThanOrEqual(100);
    const many = Array.from({ length: MAX_UPLOADS_PER_LOOKUP + 1 }, (_, i) => i.toString(16).padStart(32, "0"));
    await expect(findUploads(db, { folder: GRANT, ids: many, host: "imagekit" })).rejects.toThrow(RangeError);
    sent.length = 0;
    await findUploads(db, { folder: GRANT, ids: many.slice(0, MAX_UPLOADS_PER_LOOKUP), host: "imagekit" });
    expect(sent[0]!.params.length).toBeLessThanOrEqual(100);
  });
});
