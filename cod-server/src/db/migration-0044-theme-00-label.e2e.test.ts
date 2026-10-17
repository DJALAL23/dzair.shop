/**
 * Migration 0044 on real D1: a store labelled with the removed first theme
 * takes Theme-00's label; any other label is left as the merchant set it.
 */
import { describe, it, expect, afterAll } from "vitest";
import { createTestD1, type TestD1 } from "@/test-utils/d1";

let d1: TestD1;
const T = "2026-10-17T10:00:00.000Z";

afterAll(async () => {
  await d1?.dispose();
});

describe("migration 0044", () => {
  it("relabels stores of the removed first theme, and only those", async () => {
    d1 = await createTestD1({ before: "0044_theme_00_label.sql" });
    await d1.raw.prepare("INSERT INTO stores (id, name, created_at, updated_at) VALUES ('s-default', 'A', ?1, ?1)").bind(T).run();
    await d1.raw.prepare("INSERT INTO stores (id, name, theme_id, created_at, updated_at) VALUES ('s-custom', 'B', 'my-theme', ?1, ?1)").bind(T).run();
    await d1.applyRemaining();
    const rows = (await d1.raw.prepare("SELECT id, theme_id FROM stores ORDER BY id").all<{ id: string; theme_id: string }>()).results;
    expect(rows).toEqual([
      { id: "s-custom", theme_id: "my-theme" },
      { id: "s-default", theme_id: "theme-00" },
    ]);
  });
});
