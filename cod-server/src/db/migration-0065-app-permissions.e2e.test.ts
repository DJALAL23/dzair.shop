/**
 * Migration 0065 on real D1: whoever held a permission an App or the
 * Integrations page used to take holds its new ones; nobody gains anything
 * else, and every row that was there stays.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestD1, replay, type TestD1 } from "@/test-utils/d1";

let d1: TestD1;
const T1 = "2026-09-01T10:00:00.000Z";
const T2 = "2026-10-01T10:00:00.000Z";

const run = (sql: string, ...binds: unknown[]) => d1.raw.prepare(sql).bind(...binds).run();
const all = async <R = Record<string, unknown>>(sql: string, ...binds: unknown[]) => (await d1.raw.prepare(sql).bind(...binds).all<R>()).results;

const HELD: Record<string, string[]> = {
  verifier: ["settings:verification", "orders:read"],
  mailer: ["settings:email", "whatsapp_widget:read"],
  builder: ["whatsapp_widget:manage", "settings:integrations", "settings:notifications"],
  twice: ["settings:verification", "settings:verification"],
  already: ["settings:verification", "dzverify:read"],
  clerk: ["orders:read", "settings:view", "settings:team"],
  notifier: ["settings:notifications"],
  owner: ["*"],
};

let before: { id: string; user_id: string; scope: string; granted_by: string | null; granted_at: string }[];

async function scopesOf(userId: string): Promise<string[]> {
  return (await all<{ scope: string }>("SELECT scope FROM user_scopes WHERE user_id = ?1 ORDER BY scope", userId)).map((row) => row.scope);
}

beforeAll(async () => {
  d1 = await createTestD1({ before: "0065_app_permissions.sql" });
  for (const [user, scopes] of Object.entries(HELD)) {
    await run("INSERT INTO users (id, name, email, role, created_at, updated_at) VALUES (?1, ?1, ?1 || '@example.com', 'staff', 0, 0)", user);
    for (const [i, scope] of scopes.entries()) {
      await run("INSERT INTO user_scopes (id, user_id, scope, granted_by, granted_at) VALUES (?1, ?2, ?3, ?4, ?5)", `${user}-${i}`, user, scope, i === 0 ? "boss" : null, i === 0 ? T1 : T2);
    }
  }
  before = await all("SELECT * FROM user_scopes ORDER BY id");
  await d1.applyRemaining({ until: "0066_drop_settings_permissions.sql" });
});

afterAll(async () => {
  await d1?.dispose();
});

describe("migration 0065 on a store with staff", () => {
  it("gives each holder of an old permission its new ones, and nothing else", async () => {
    expect(await scopesOf("verifier")).toEqual(["dzverify:manage", "dzverify:read", "orders:read", "settings:verification", "turnstile:manage", "turnstile:read"]);
    expect(await scopesOf("mailer")).toEqual(["sendili:manage", "sendili:read", "settings:email", "whatsapp-button:read", "whatsapp_widget:read"]);
    expect(await scopesOf("builder")).toEqual([
      "integrations:manage",
      "integrations:read",
      "settings:integrations",
      "settings:notifications",
      "whatsapp-button:manage",
      "whatsapp_widget:manage",
    ]);
    expect(await scopesOf("clerk")).toEqual(["orders:read", "settings:team", "settings:view"]);
    expect(await scopesOf("notifier")).toEqual(["settings:notifications"]);
    expect(await scopesOf("owner")).toEqual(["*"]);
  });

  it("gives a permission once, however often the old one was held, and never one already held", async () => {
    expect(await scopesOf("twice")).toEqual(["dzverify:manage", "dzverify:read", "settings:verification", "settings:verification", "turnstile:manage", "turnstile:read"]);
    expect(await scopesOf("already")).toEqual(["dzverify:manage", "dzverify:read", "settings:verification", "turnstile:manage", "turnstile:read"]);
  });

  it("keeps who granted it and when", async () => {
    expect(await all("SELECT scope, granted_by, granted_at FROM user_scopes WHERE user_id = 'mailer' AND scope IN ('sendili:read', 'whatsapp-button:read') ORDER BY scope")).toEqual([
      { scope: "sendili:read", granted_by: "boss", granted_at: T1 },
      { scope: "whatsapp-button:read", granted_by: null, granted_at: T2 },
    ]);
  });

  it("keeps every row that was there, as it was", async () => {
    const ids = before.map((row) => row.id);
    const kept = await all(`SELECT * FROM user_scopes WHERE id IN (${ids.map(() => "?").join(",")}) ORDER BY id`, ...ids);
    expect(kept).toEqual(before);
  });

  it("adds nothing when it runs again", async () => {
    const rows = await all("SELECT id FROM user_scopes ORDER BY id");
    await replay(d1.raw, ["0065_app_permissions.sql"]);
    expect(await all("SELECT id FROM user_scopes ORDER BY id")).toEqual(rows);
  });
});
