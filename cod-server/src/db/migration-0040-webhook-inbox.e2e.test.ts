/**
 * Migration 0040 on real D1: the inbox gains its processing columns, rows
 * stored before it keep everything they had and are never picked up by the
 * sweep (the old handler already processed them).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import { dueInboxEvents } from "../../../cod-shared/inbound/inbox";

let d1: TestD1;
const NOW = "2026-10-14T10:00:00.000Z";

beforeAll(async () => {
  d1 = await createTestD1({ before: "0040_webhook_inbox.sql" });
  await d1.raw.batch([
    d1.raw.prepare("INSERT INTO delivery_companies (id, name, name_ar, code, provider, created_at, updated_at) VALUES ('co1', 'Yalidine', 'ياليدين', 'yalidine', 'yalidine', ?, ?)").bind(NOW, NOW),
    d1.raw
      .prepare("INSERT INTO webhook_events (id, provider, event_id, company_id, tracking, event_type, raw_payload, result, new_status, created_at) VALUES ('old-ok', 'yalidine', 'e1', 'co1', 'yal-1', 'parcel_status_updated', '{}', 'ok', 'delivered', ?)")
      .bind(NOW),
    d1.raw
      .prepare("INSERT INTO webhook_events (id, provider, event_id, company_id, event_type, raw_payload, result, created_at) VALUES ('old-pending', 'yalidine', 'e2', 'co1', 'parcel_status_updated', '{}', 'pending', ?)")
      .bind(NOW),
  ]);
  await d1.applyRemaining({ until: "0041_order_shipment_split.sql" });
}, 120_000);

afterAll(async () => {
  await d1?.dispose();
});

describe("migration 0040", () => {
  it("keeps every older row as it was, with no try counted and nothing due", async () => {
    // Read raw: the Drizzle schema describes the database after every migration.
    const { results: rows } = await d1.raw.prepare("SELECT * FROM webhook_events").all<Record<string, unknown>>();
    expect(rows.find((r) => r.id === "old-ok")).toMatchObject({ result: "ok", new_status: "delivered", tracking: "yal-1", attempts: 0, next_attempt_at: null, shipment_id: null });
    expect(rows.find((r) => r.id === "old-pending")).toMatchObject({ result: "pending", attempts: 0, next_attempt_at: null });
    expect(await dueInboxEvents(d1.db, 10, new Date("2030-01-01T00:00:00Z"))).toEqual([]);
  });

  it("adds its three columns", async () => {
    const { results } = await d1.raw.prepare("SELECT name FROM pragma_table_info('webhook_events')").all<{ name: string }>();
    expect(results.map((r) => r.name)).toEqual(expect.arrayContaining(["shipment_id", "attempts", "next_attempt_at"]));
  });

  it("indexes what the sweep and the shipment's audit read", async () => {
    const { results } = await d1.raw.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'webhook_events'").all<{ name: string; sql: string | null }>();
    const byName = new Map(results.map((r) => [r.name, r.sql ?? ""]));
    expect(byName.get("webhook_events_due")).toMatch(/next_attempt_at.*WHERE result IN \('pending', 'error'\)/);
    expect(byName.get("webhook_events_shipment")).toMatch(/shipment_id.*WHERE shipment_id IS NOT NULL/);
  });
});
