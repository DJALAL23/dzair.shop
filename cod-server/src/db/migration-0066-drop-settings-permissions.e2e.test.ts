/**
 * Migration 0066 on real D1: the old permission names leave, every holder
 * keeps the new ones 0065 gave them, and every other row stays as it was.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestD1, replay, type TestD1 } from "@/test-utils/d1";

let d1: TestD1;

const run = (sql: string, ...binds: unknown[]) => d1.raw.prepare(sql).bind(...binds).run();
const all = async <R = Record<string, unknown>>(sql: string, ...binds: unknown[]) => (await d1.raw.prepare(sql).bind(...binds).all<R>()).results;

const OLD = ["settings:verification", "settings:email", "settings:integrations", "settings:notifications", "whatsapp_widget:read", "whatsapp_widget:manage"];

const HELD: Record<string, string[]> = {
  verifier: ["settings:verification", "orders:read"],
  mailer: ["settings:email", "whatsapp_widget:read", "customers:read"],
  builder: ["whatsapp_widget:manage", "settings:integrations", "settings:notifications"],
  clerk: ["orders:read", "settings:view", "settings:team"],
  owner: ["*"],
};

let kept: Record<string, unknown>[];

async function scopesOf(userId: string): Promise<string[]> {
  return (await all<{ scope: string }>("SELECT scope FROM user_scopes WHERE user_id = ?1 ORDER BY scope", userId)).map((row) => row.scope);
}

beforeAll(async () => {
  d1 = await createTestD1({ before: "0065_app_permissions.sql" });
  for (const [user, scopes] of Object.entries(HELD)) {
    await run("INSERT INTO users (id, name, email, role, created_at, updated_at) VALUES (?1, ?1, ?1 || '@example.com', 'staff', 0, 0)", user);
    for (const [i, scope] of scopes.entries()) {
      await run("INSERT INTO user_scopes (id, user_id, scope, granted_by, granted_at) VALUES (?1, ?2, ?3, 'boss', '2026-09-01T10:00:00.000Z')", `${user}-${i}`, user, scope);
    }
  }
  await d1.applyRemaining({ until: "0066_drop_settings_permissions.sql" });
  kept = await all(`SELECT * FROM user_scopes WHERE scope NOT IN (${OLD.map(() => "?").join(",")}) ORDER BY id`, ...OLD);
  await d1.applyRemaining();
}, 120_000);

afterAll(async () => {
  await d1?.dispose();
});

describe("migration 0066 on a store that ran 0065", () => {
  it("removes every old permission name, and each holder keeps the new ones", async () => {
    expect(await all(`SELECT scope FROM user_scopes WHERE scope IN (${OLD.map(() => "?").join(",")})`, ...OLD)).toEqual([]);
    expect(await scopesOf("verifier")).toEqual(["dzverify:manage", "dzverify:read", "orders:read", "turnstile:manage", "turnstile:read"]);
    expect(await scopesOf("mailer")).toEqual(["customers:read", "sendili:manage", "sendili:read", "whatsapp-button:read"]);
    expect(await scopesOf("builder")).toEqual(["integrations:manage", "integrations:read", "whatsapp-button:manage"]);
  });

  it("keeps every other row as it was", async () => {
    expect(await all("SELECT * FROM user_scopes ORDER BY id")).toEqual(kept);
    expect(await scopesOf("clerk")).toEqual(["orders:read", "settings:team", "settings:view"]);
    expect(await scopesOf("owner")).toEqual(["*"]);
  });

  it("changes nothing when it runs again", async () => {
    const rows = await all("SELECT * FROM user_scopes ORDER BY id");
    await replay(d1.raw, ["0066_drop_settings_permissions.sql"]);
    expect(await all("SELECT * FROM user_scopes ORDER BY id")).toEqual(rows);
  });
});
