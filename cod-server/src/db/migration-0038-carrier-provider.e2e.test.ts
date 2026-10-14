/**
 * Migration 0038 on real D1: every existing delivery company gets the adapter
 * that serves it, and Yalidine's settings move out of free-text `notes` into
 * typed `provider_config` — without losing a setting or another note.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import { buildCarrier } from "@/carriers/registry";

let legacy: TestD1;
let textNotes: TestD1;
let noNotes: TestD1;

async function seed(db: TestD1, id: string, code: string, notes: string | null, stopDesk = false) {
  const now = new Date().toISOString();
  await db.raw
    .prepare(
      "INSERT INTO delivery_companies (id, name, name_ar, code, active, api_token, api_user_guid, api_endpoint, notes, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 'tok', 'guid', 'https://x.ecotrack.dz', ?, ?, ?)",
    )
    .bind(id, code, code, code, notes, now, now)
    .run();
  if (stopDesk) {
    await db.raw
      .prepare("INSERT INTO company_stop_desks (id, company_id, code, name, active, synced_at) VALUES (?, ?, '161', 'Desk', 0, ?)")
      .bind(`desk-${id}`, id, now)
      .run();
  }
}

// `code` is unique, so a store has one Yalidine and one Guepex: each notes
// shape a Yalidine-platform company can have gets its own database.
beforeAll(async () => {
  const before = "0038_carrier_provider.sql";
  [legacy, textNotes, noNotes] = await Promise.all([createTestD1({ before }), createTestD1({ before }), createTestD1({ before })]);
  await seed(legacy, "yal-relay", "yalidine", JSON.stringify({ from_wilaya_name: "Batna", proxy_base_url: "https://relay.example", proxy_secret: "s3cret" }), true);
  await seed(legacy, "guepex", "guepex", JSON.stringify({ from_wilaya_name: "Oran", contact: "Karim" }));
  await seed(legacy, "zr", "zr_express", "ZR notes");
  await seed(legacy, "noest", "noest", null);
  await seed(legacy, "eco", "ecotrack", null);
  await seed(legacy, "packers", "packers_ecotrack", null);
  await seed(legacy, "maystro", "maystro", "manual carrier");
  await seed(textNotes, "yal-text", "yalidine", "Primary carrier for Algiers");
  await seed(noNotes, "yal-none", "yalidine", null);
  await Promise.all([legacy.applyRemaining(), textNotes.applyRemaining(), noNotes.applyRemaining()]);
}, 120_000);

afterAll(async () => {
  await Promise.all([legacy?.dispose(), textNotes?.dispose(), noNotes?.dispose()]);
});

const row = (id: string, db: TestD1 = legacy) =>
  db.raw
    .prepare("SELECT provider, provider_config, notes FROM delivery_companies WHERE id = ?")
    .bind(id)
    .first<{ provider: string | null; provider_config: string | null; notes: string | null }>();

describe("migration 0038", () => {
  it.each([
    ["yal-relay", "yalidine"],
    ["guepex", "yalidine"],
    ["zr", "zr_express"],
    ["noest", "noest"],
    ["eco", "ecotrack"],
    ["packers", "ecotrack"],
    ["maystro", null],
  ])("%s is served by %s", async (id, provider) => {
    expect((await row(id))?.provider).toBe(provider);
  });

  it("moves Yalidine's settings out of notes, keeping every one of them", async () => {
    const r = await row("yal-relay");
    expect(JSON.parse(r!.provider_config!)).toEqual({ platform: "yalidine", fromWilayaName: "Batna", proxyBaseUrl: "https://relay.example", proxySecret: "s3cret" });
    expect(r!.notes).toBeNull();
  });

  it("leaves a merchant's own notes in place", async () => {
    const mixed = await row("guepex");
    expect(JSON.parse(mixed!.provider_config!)).toEqual({ platform: "guepex", fromWilayaName: "Oran" });
    expect(JSON.parse(mixed!.notes!)).toEqual({ contact: "Karim" });
    const text = await row("yal-text", textNotes);
    expect(text!.notes).toBe("Primary carrier for Algiers");
    expect(JSON.parse(text!.provider_config!)).toEqual({ platform: "yalidine" });
    expect((await row("zr"))!.notes).toBe("ZR notes");
  });

  it("a Yalidine company with no notes gets the platform and nothing else", async () => {
    const r = await row("yal-none", noNotes);
    expect(r!.provider).toBe("yalidine");
    expect(JSON.parse(r!.provider_config!)).toEqual({ platform: "yalidine" });
    expect(r!.notes).toBeNull();
  });

  it("gives other providers no settings yet", async () => {
    for (const id of ["zr", "noest", "eco", "packers", "maystro"]) expect((await row(id))!.provider_config).toBeNull();
  });

  it("adds columns without rebuilding the table: stop desks and their on/off choice survive", async () => {
    const desk = await legacy.raw.prepare("SELECT active FROM company_stop_desks WHERE company_id = 'yal-relay'").first<{ active: number }>();
    expect(desk?.active).toBe(0);
  });

  it("every migrated company builds a working adapter from its new columns", async () => {
    for (const [id, db] of [["yal-relay", legacy], ["guepex", legacy], ["yal-text", textNotes], ["yal-none", noNotes], ["zr", legacy], ["noest", legacy], ["eco", legacy], ["packers", legacy]] as const) {
      const r = await db.raw
        .prepare("SELECT provider, provider_config, api_token, api_user_guid, api_endpoint FROM delivery_companies WHERE id = ?")
        .bind(id)
        .first<{ provider: never; provider_config: string | null; api_token: string; api_user_guid: string; api_endpoint: string }>();
      expect(() =>
        buildCarrier({ provider: r!.provider, providerConfig: r!.provider_config, apiToken: r!.api_token, apiUserGuid: r!.api_user_guid, apiEndpoint: r!.api_endpoint }),
        id,
      ).not.toThrow();
    }
  });
});
