/**
 * Migration 0082 on real D1: Order Protection's lists read their page of
 * attempts in order from an index, Activity across every outcome and the Spam
 * page within one, and the reads the dropped index served still use one.
 * Nothing is written: the rows before are the rows after.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestD1, type TestD1 } from "@/test-utils/d1";

let d1: TestD1;
const T = "2026-11-10T08:00:00.000Z";
const all = async <R = Record<string, unknown>>(sql: string) => (await d1.raw.prepare(sql).all<R>()).results;
const plan = async (sql: string) => (await all<{ detail: string }>(`EXPLAIN QUERY PLAN ${sql}`)).map((row) => row.detail).join(" | ");
let before: unknown[];
let activityBefore: string;

const ACTIVITY = "SELECT id FROM order_attempts ORDER BY created_at DESC, id DESC LIMIT 20 OFFSET 20";
const SPAM_PAGE = "SELECT id FROM order_attempts WHERE outcome = 'spam' ORDER BY created_at DESC, id DESC LIMIT 20 OFFSET 0";

beforeAll(async () => {
  d1 = await createTestD1({ before: "0082_order_attempts_recent.sql" });
  await d1.raw.batch(
    [
      "INSERT INTO order_attempts (id, created_at, phone, outcome, order_number) VALUES ('a1', ?1, '0551111111', 'spam', 'ORD-1')",
      "INSERT INTO order_attempts (id, created_at, phone, outcome) VALUES ('a2', ?1, '0552222222', 'accepted')",
      "INSERT INTO order_attempts (id, created_at, phone, outcome) VALUES ('a3', ?1, '0553333333', 'flagged')",
    ].map((sql) => d1.raw.prepare(sql).bind(T)),
  );
  before = await all("SELECT * FROM order_attempts ORDER BY id");
  activityBefore = await plan(ACTIVITY);
  await d1.applyRemaining();
}, 120_000);

afterAll(async () => {
  await d1?.dispose();
});

describe("migration 0082", () => {
  it("keeps every attempt as it was", async () => {
    expect(await all("SELECT * FROM order_attempts ORDER BY id")).toEqual(before);
  });

  it("read Activity's page by sorting every attempt before it", () => {
    expect(activityBefore).toContain("TEMP B-TREE");
  });

  it("reads Activity's page in order, without a sort", async () => {
    const read = await plan(ACTIVITY);
    expect(read).toContain("order_attempts_recent");
    expect(read).not.toContain("TEMP B-TREE");
  });

  it("reads the Spam page and a filtered Activity page in order, without a sort", async () => {
    const read = await plan(SPAM_PAGE);
    expect(read).toMatch(/USING (COVERING )?INDEX order_attempts_outcome_recent/);
    expect(read).not.toContain("TEMP B-TREE");
  });

  it("still counts today's Spam Orders and sweeps old attempts through an index", async () => {
    const today = await plan("SELECT count(*) FROM order_attempts WHERE outcome = 'spam' AND created_at >= '2026-11-10'");
    expect(today).toMatch(/USING (COVERING )?INDEX order_attempts_outcome_recent/);
    const sweep = await plan("SELECT id FROM order_attempts WHERE (outcome = 'spam' AND created_at < '2026-10-10') OR (outcome <> 'spam' AND created_at < '2026-09-10') LIMIT 500");
    expect(sweep).toMatch(/INDEX order_attempts_(outcome_)?recent/);
  });

  it("drops the two-column index the new one covers", async () => {
    const names = (await all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'order_attempts'")).map((row) => row.name);
    expect(names).not.toContain("order_attempts_outcome");
    expect(names).toEqual(expect.arrayContaining(["order_attempts_recent", "order_attempts_outcome_recent"]));
  });
});
