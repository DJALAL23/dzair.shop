/**
 * Migration 0084 on real D1: every attribution row written before it is kept
 * as it was, with the new channel and visit columns empty, and a row written
 * after it stores and filters by its channel.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import * as schema from "@/db/schema";

let d1: TestD1;
const T = "2026-11-12T08:00:00.000Z";
const all = async <R = Record<string, unknown>>(sql: string) => (await d1.raw.prepare(sql).all<R>()).results;
let attributionBefore: Array<Record<string, unknown>>;
let ordersBefore: unknown[];

const NEW_COLUMNS = {
  channel: null,
  visit_at: null,
  visit_channel: null,
  visit_platform: null,
  visit_site_source: null,
  visit_referrer_host: null,
  visit_landing_path: null,
  visit_landing_page_type: null,
  visit_utm_source: null,
  visit_utm_medium: null,
  visit_utm_campaign: null,
};

beforeAll(async () => {
  d1 = await createTestD1({ before: "0084_order_attribution_visit.sql" });
  await d1.raw.batch(
    [
      "INSERT INTO customers (id, name, phone, wilaya, created_at) VALUES ('c1', 'Amel', '0551234567', 'Alger', ?1)",
      ...["o1", "o2", "o3"].map(
        (id) =>
          `INSERT INTO orders (id, order_number, customer_id, customer_name, phone, wilaya_id, commune_id, price, status, delivery_type, created_at, updated_at) VALUES ('${id}', 'ORD-${id}', 'c1', 'Amel', '0551234567', 16, 'c-16-001', 3000, 'new', 'home', ?1, ?1)`,
      ),
      "INSERT INTO order_attribution (order_id, method, captured_at, platform, click_id, click_id_type, created_at, updated_at) VALUES ('o1', 'captured', '2026-11-10T03:30:00.000Z', 'meta', 'IwAR2F4', 'fbclid', ?1, ?1)",
      "INSERT INTO order_attribution (order_id, method, captured_at, platform, campaign_id, ad_id, utm_source, utm_medium, landing_path, created_at, updated_at) VALUES ('o2', 'captured', ?1, 'meta', '120200000000000001', '120200000000000003', 'facebook', 'paid_social', '/products/robe', ?1, ?1)",
      "INSERT INTO order_attribution (order_id, method, platform, site_source, created_at, updated_at) VALUES ('o3', 'merchant', 'meta', 'wa', ?1, ?1)",
    ].map((sql) => d1.raw.prepare(sql).bind(T)),
  );
  attributionBefore = await all("SELECT * FROM order_attribution ORDER BY order_id");
  ordersBefore = await all("SELECT * FROM orders ORDER BY id");
  await d1.applyRemaining();
}, 120_000);

afterAll(async () => {
  await d1?.dispose();
});

describe("migration 0084", () => {
  it("keeps every attribution row as it was, with the new columns empty", async () => {
    expect(attributionBefore).toHaveLength(3);
    expect(await all("SELECT * FROM order_attribution ORDER BY order_id")).toEqual(attributionBefore.map((row) => ({ ...row, ...NEW_COLUMNS })));
  });

  it("keeps every order as it was", async () => {
    const columns = Object.keys(ordersBefore[0] ?? {});
    expect((await all("SELECT * FROM orders ORDER BY id")).map((row) => Object.fromEntries(columns.map((column) => [column, (row as Record<string, unknown>)[column]])))).toEqual(ordersBefore);
  });

  it("stores a row's channel and visit through the schema, and finds rows by channel", async () => {
    await d1.db
      .update(schema.orderAttribution)
      .set({ channel: "paid_social", visitAt: T, visitChannel: "direct", visitPlatform: "direct", visitLandingPath: "/" })
      .where(eq(schema.orderAttribution.orderId, "o2"));
    expect(await d1.db.select({ orderId: schema.orderAttribution.orderId }).from(schema.orderAttribution).where(eq(schema.orderAttribution.channel, "paid_social")).all()).toEqual([{ orderId: "o2" }]);
    expect(await all("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'order_attribution_channel_idx'")).toEqual([{ name: "order_attribution_channel_idx" }]);
  });

  it("still drops a row with its order", async () => {
    await d1.raw.prepare("DELETE FROM orders WHERE id = 'o1'").run();
    expect(await all("SELECT order_id FROM order_attribution ORDER BY order_id")).toEqual([{ order_id: "o2" }, { order_id: "o3" }]);
  });
});
