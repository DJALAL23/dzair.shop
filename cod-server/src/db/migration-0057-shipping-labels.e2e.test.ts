/**
 * Migration 0057 on real D1: the store row gains one nullable column for its
 * shipping-label settings, and nothing else changes — every value a store
 * had before is kept, and every store reads the defaults (NULL) until it
 * saves settings of its own.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestD1, type TestD1 } from "@/test-utils/d1";

let d1: TestD1;
const T = "2026-10-24T10:00:00.000Z";

const all = async <R = Record<string, unknown>>(sql: string) => (await d1.raw.prepare(sql).all<R>()).results;
let before: Record<string, unknown>;

beforeAll(async () => {
  d1 = await createTestD1({ before: "0057_shipping_labels.sql" });
  await d1.raw
    .prepare("INSERT INTO stores (id, name, logo_url, lang, checkout_form_json, whatsapp_widget_json, review_max_photos, created_at, updated_at) VALUES ('s1', 'Boutique', 'https://media/logo.webp', 'ar', '{\"v\":1}', '{\"enabled\":true}', 4, ?1, ?1)")
    .bind(T)
    .run();
  [before] = await all("select * from stores");
  await d1.applyRemaining({ until: "0058" });
}, 120_000);

afterAll(async () => {
  await d1?.dispose();
});

describe("migration 0057", () => {
  it("keeps every value the store had", async () => {
    const [after] = await all<Record<string, unknown>>("select * from stores");
    const { shipping_label_json, ...rest } = after;
    expect(rest).toEqual(before);
    expect(shipping_label_json).toBeNull();
  });

  it("adds the label settings as a nullable text column", async () => {
    const columns = await all<{ name: string; type: string; notnull: number; dflt_value: unknown }>("select name, type, \"notnull\", dflt_value from pragma_table_info('stores') where name = 'shipping_label_json'");
    expect(columns).toEqual([{ name: "shipping_label_json", type: "TEXT", notnull: 0, dflt_value: null }]);
  });
});
