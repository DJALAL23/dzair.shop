/**
 * Migration 0073 on real D1: the WhatsApp button's translations go with
 * their store, and only theirs — another store's, and the store's other
 * resources' rows, are left to their own triggers.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestD1, type TestD1 } from "@/test-utils/d1";

let d1: TestD1;
const T = "2026-11-01T10:00:00.000Z";

const run = (sql: string, ...binds: unknown[]) => d1.raw.prepare(sql).bind(...binds).run();
const all = async <R = Record<string, unknown>>(sql: string, ...binds: unknown[]) => (await d1.raw.prepare(sql).bind(...binds).all<R>()).results;

const translation = (type: string, id: string, key: string) =>
  run(
    "INSERT INTO translations (resource_type, resource_id, locale, key, value, source_digest, updated_at) VALUES (?1, ?2, 'fr', ?3, ?4, 'd', ?5)",
    type,
    id,
    key,
    `${type}:${id}:${key}`,
    T,
  );

beforeAll(async () => {
  d1 = await createTestD1();
  for (const id of ["s1", "s2"]) await run("INSERT INTO stores (id, name, lang, created_at, updated_at) VALUES (?1, ?1, 'ar', ?2, ?2)", id, T);
  await translation("whatsappWidget", "s1", "ctaLabel");
  await translation("whatsappWidget", "s1", "prefillGeneral");
  await translation("whatsappWidget", "s2", "ctaLabel");
  await translation("product", "s1", "name");
}, 120_000);

afterAll(async () => d1?.dispose());

describe("migration 0073: the WhatsApp button's translations", () => {
  it("are deleted with their store, and no other row is", async () => {
    await run("DELETE FROM stores WHERE id = 's1'");

    expect(await all("SELECT resource_type, resource_id, key FROM translations ORDER BY resource_type, resource_id, key")).toEqual([
      { resource_type: "product", resource_id: "s1", key: "name" },
      { resource_type: "whatsappWidget", resource_id: "s2", key: "ctaLabel" },
    ]);
  });
});
