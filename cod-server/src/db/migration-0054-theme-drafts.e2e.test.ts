/**
 * Migration 0054 on real D1 (ADR 0010). Page documents written before it keep
 * themselves under the theme their provenance names, or Theme-00; rows no
 * reader could show are not carried over. Afterwards the database itself holds
 * the editor's rules: one document per theme and surface, draft parts in the
 * three kinds with whole JSON values, theme keys and surfaces in the SDK's
 * format, the newest 50 publications per theme, a removed language taking its
 * draft text with it, and everything going with its store. The draft lock the
 * editor relies on is proven with the statements it will use.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestD1, type TestD1 } from "@/test-utils/d1";
import { THEME_KEY_RE } from "../../../cod-shared/i18n/content-overrides";
import { PAGE_DOCUMENT_SURFACE_RE } from "../../../cod-shared/queries/page-document-surface";
import { THEME_DRAFT_CHANGED, THEME_PUBLICATIONS_KEPT } from "../../../cod-shared/themes/drafts";

let d1: TestD1;
const T = "2026-10-18T10:00:00.000Z";

const run = (sql: string, ...binds: unknown[]) => d1.raw.prepare(sql).bind(...binds).run();
const all = async <R = Record<string, unknown>>(sql: string, ...binds: unknown[]) => (await d1.raw.prepare(sql).bind(...binds).all<R>()).results;
const count = async (sql: string, ...binds: unknown[]) => Number((await all<{ n: number }>(sql, ...binds))[0].n);
const doc = (extra: Record<string, unknown> = {}) => JSON.stringify({ version: 1, surface: "home", sections: [], ...extra });
const accepts = async (sql: string, ...binds: unknown[]) => {
  try {
    await run(sql, ...binds);
    return true;
  } catch {
    return false;
  }
};

beforeAll(async () => {
  d1 = await createTestD1({ before: "0054_theme_drafts.sql" });
  await run("INSERT INTO stores (id, name, lang, created_at, updated_at) VALUES ('s1', 'Store', 'ar', ?1, ?1)", T);
  await run("INSERT INTO stores (id, name, lang, created_at, updated_at) VALUES ('s2', 'Other', 'ar', ?1, ?1)", T);
  const before = [
    ["pd-aurora", "s1", "home", doc({ theme: { key: "aurora", version: "2.0.0" } })],
    ["pd-plain", "s1", "lp:summer", doc({ surface: "lp:summer" })],
    ["pd-badkey", "s2", "home", doc({ theme: { key: "Not A Key", version: "1" } })],
    ["pd-notjson", "s2", "page:about", "{nope"],
    ["pd-array", "s2", "page:faq", "[]"],
    ["pd-badsurface", "s2", "Home Page", doc()],
  ];
  for (const [id, store, surface, document] of before) {
    await run("INSERT INTO page_documents (id, store_id, surface, document, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)", id, store, surface, document, "2026-01-01T00:00:00.000Z", "2026-02-01T00:00:00.000Z");
  }
  await d1.applyRemaining();
  await run("INSERT INTO store_locales (store_id, locale, published, created_at) VALUES ('s1', 'fr', 1, ?1)", T);
  await run("INSERT INTO store_locales (store_id, locale, published, created_at) VALUES ('s2', 'fr', 1, ?1)", T);
});

afterAll(async () => {
  await d1?.dispose();
});

describe("page documents written before 0054", () => {
  it("keep their row under the theme their provenance names, or Theme-00", async () => {
    expect(await all("SELECT id, store_id, theme_key, surface, created_at, updated_at FROM page_documents ORDER BY id")).toEqual([
      { id: "pd-aurora", store_id: "s1", theme_key: "aurora", surface: "home", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-02-01T00:00:00.000Z" },
      { id: "pd-badkey", store_id: "s2", theme_key: "theme-00", surface: "home", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-02-01T00:00:00.000Z" },
      { id: "pd-plain", store_id: "s1", theme_key: "theme-00", surface: "lp:summer", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-02-01T00:00:00.000Z" },
    ]);
    expect((await all<{ document: string }>("SELECT document FROM page_documents WHERE id = 'pd-aurora'"))[0].document).toBe(doc({ theme: { key: "aurora", version: "2.0.0" } }));
  });
});

describe("page documents after 0054", () => {
  it("hold one document per store, theme and surface", async () => {
    expect(await accepts("INSERT INTO page_documents (id, store_id, theme_key, surface, document, created_at, updated_at) VALUES ('pd-zero-home', 's1', 'theme-00', 'home', ?1, ?2, ?2)", doc(), T)).toBe(true);
    expect(await accepts("INSERT INTO page_documents (id, store_id, theme_key, surface, document, created_at, updated_at) VALUES ('pd-zero-home-2', 's1', 'theme-00', 'home', ?1, ?2, ?2)", doc(), T)).toBe(false);
  });

  it("refuse what is not a JSON object", async () => {
    for (const document of ["{nope", "[]", "1", "null"]) {
      expect(await accepts("INSERT INTO page_documents (id, store_id, theme_key, surface, document, created_at, updated_at) VALUES ('pd-x', 's1', 'theme-00', 'x', ?1, ?2, ?2)", document, T)).toBe(false);
    }
  });
});

describe("theme keys and surfaces follow the SDK's rules", () => {
  const themeKeys = ["theme-00", "aurora", "a", "a1-b2", "x".repeat(64), "", "Theme", "-a", "a-", "a--b", "1a", "a_b", "a b", "é", "x".repeat(65)];
  const surfaces = ["home", "lp:summer", "page:about-us", "product.compact", "0", "a_b", "", "Home", ".home", "a b", "home/x", "x".repeat(64), "x".repeat(65)];

  it("accepts exactly the theme keys THEME_KEY_RE accepts", async () => {
    for (const [i, key] of themeKeys.entries()) {
      const stored = await accepts("INSERT INTO theme_drafts (id, store_id, theme_key, theme_version, created_at, updated_at) VALUES (?1, 's1', ?2, '1.0.0', ?3, ?3)", `key-${i}`, key, T);
      expect(stored, JSON.stringify(key)).toBe(THEME_KEY_RE.test(key));
    }
    await run("DELETE FROM theme_drafts WHERE id GLOB 'key-*'");
  });

  it("accepts exactly the surfaces PAGE_DOCUMENT_SURFACE_RE accepts", async () => {
    for (const [i, surface] of surfaces.entries()) {
      const stored = await accepts("INSERT INTO page_documents (id, store_id, theme_key, surface, document, created_at, updated_at) VALUES (?1, 's2', 'surface-probe', ?2, ?3, ?4, ?4)", `surface-${i}`, surface, doc(), T);
      expect(stored, JSON.stringify(surface)).toBe(PAGE_DOCUMENT_SURFACE_RE.test(surface));
    }
    await run("DELETE FROM page_documents WHERE id GLOB 'surface-*'");
  });
});

describe("draft parts", () => {
  beforeAll(async () => {
    await run("INSERT INTO theme_drafts (id, store_id, theme_key, theme_version, created_at, updated_at) VALUES ('d1', 's1', 'theme-00', '1.4.0', ?1, ?1)", T);
  });
  const part = (kind: string, key: string, value: string | null) =>
    accepts("INSERT INTO theme_draft_parts (draft_id, kind, key, value, updated_at) VALUES ('d1', ?1, ?2, ?3, ?4)", kind, key, value, T);

  it("hold a document per surface, the settings once, and an edit map per language", async () => {
    expect(await part("document", "home", doc())).toBe(true);
    expect(await part("document", "lp:summer", null)).toBe(true);
    expect(await part("settings", "", JSON.stringify({ primaryColor: "#112233" }))).toBe(true);
    expect(await part("content", "fr", JSON.stringify({ heroTitle: "Soldes" }))).toBe(true);
    expect(await part("content", "ar", "{}")).toBe(true);
    expect(await count("SELECT count(*) n FROM theme_draft_parts WHERE draft_id = 'd1'")).toBe(5);
  });

  it("hold each part once", async () => {
    expect(await part("document", "home", doc())).toBe(false);
    expect(await part("settings", "", "{}")).toBe(false);
  });

  it("refuse any other kind, a misplaced key, and a value that is not a whole JSON object", async () => {
    expect(await part("menu", "main", "{}")).toBe(false);
    expect(await part("settings", "colors", "{}")).toBe(false);
    expect(await part("document", "", doc())).toBe(false);
    expect(await part("document", "Home Page", doc())).toBe(false);
    expect(await part("content", "", "{}")).toBe(false);
    expect(await part("content", "f", "{}")).toBe(false);
    expect(await part("content", "fr_FR", "{}")).toBe(false);
    expect(await part("settings", "", null)).toBe(false);
    expect(await part("content", "en", null)).toBe(false);
    for (const value of ["{nope", "[]", "\"text\"", "1"]) expect(await part("document", "page:x", value)).toBe(false);
  });

  it("go with their draft", async () => {
    await run("INSERT INTO theme_drafts (id, store_id, theme_key, theme_version, created_at, updated_at) VALUES ('d-gone', 's1', 'theme-00', '1.4.0', ?1, ?1)", T);
    await run("INSERT INTO theme_draft_parts (draft_id, kind, key, value, updated_at) VALUES ('d-gone', 'settings', '', '{}', ?1)", T);
    await run("DELETE FROM theme_drafts WHERE id = 'd-gone'");
    expect(await count("SELECT count(*) n FROM theme_draft_parts WHERE draft_id = 'd-gone'")).toBe(0);
  });
});

describe("removing a store's language", () => {
  it("removes the drafts' text for it in that store only, and nothing else", async () => {
    await run("INSERT INTO theme_drafts (id, store_id, theme_key, theme_version, created_at, updated_at) VALUES ('d-s2', 's2', 'theme-00', '1.4.0', ?1, ?1)", T);
    await run("INSERT INTO theme_draft_parts (draft_id, kind, key, value, updated_at) VALUES ('d-s2', 'content', 'fr', '{\"heroTitle\":\"Ailleurs\"}', ?1)", T);
    await run("DELETE FROM store_locales WHERE store_id = 's1' AND locale = 'fr'");
    expect(await all("SELECT draft_id, kind, key FROM theme_draft_parts WHERE kind = 'content' ORDER BY draft_id, key")).toEqual([
      { draft_id: "d-s2", kind: "content", key: "fr" },
      { draft_id: "d1", kind: "content", key: "ar" },
    ]);
    expect(await count("SELECT count(*) n FROM theme_draft_parts WHERE draft_id = 'd1' AND kind <> 'content'")).toBe(3);
  });
});

describe("publications", () => {
  it(`keep the newest ${THEME_PUBLICATIONS_KEPT} per store and theme`, async () => {
    const at = (i: number) => new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString();
    for (let i = 0; i < THEME_PUBLICATIONS_KEPT + 3; i++) {
      await run("INSERT INTO theme_publications (id, store_id, theme_key, theme_version, state, published_at) VALUES (?1, 's1', 'theme-00', '1.4.0', '[]', ?2)", `p${String(i).padStart(2, "0")}`, at(i));
    }
    await run("INSERT INTO theme_publications (id, store_id, theme_key, theme_version, state, published_at) VALUES ('other-theme', 's1', 'aurora', '2.0.0', '[]', ?1)", at(0));
    await run("INSERT INTO theme_publications (id, store_id, theme_key, theme_version, state, published_at) VALUES ('other-store', 's2', 'theme-00', '1.4.0', '[]', ?1)", at(0));

    const kept = await all<{ id: string }>("SELECT id FROM theme_publications WHERE store_id = 's1' AND theme_key = 'theme-00' ORDER BY published_at");
    expect(kept).toHaveLength(THEME_PUBLICATIONS_KEPT);
    expect(kept[0].id).toBe("p03");
    expect(kept.at(-1)!.id).toBe(`p${THEME_PUBLICATIONS_KEPT + 2}`);
    expect(await count("SELECT count(*) n FROM theme_publications WHERE id IN ('other-theme', 'other-store')")).toBe(2);
  });

  it("hold a JSON array of parts", async () => {
    for (const state of ["{}", "{nope", "null"]) {
      expect(await accepts("INSERT INTO theme_publications (id, store_id, theme_key, theme_version, state, published_at) VALUES ('bad', 's2', 'theme-00', '1.4.0', ?1, ?2)", state, T)).toBe(false);
    }
  });
});

describe("the draft lock", () => {
  /** One autosave, as the editor writes it: the lock first, then the part. */
  const save = (seen: number, title: string, draft = "lock") =>
    d1.raw.batch([
      d1.raw.prepare("UPDATE theme_drafts SET revision = ?2 + 1, updated_at = ?3 WHERE id = ?1").bind(draft, seen, T),
      d1.raw
        .prepare("INSERT INTO theme_draft_parts (draft_id, kind, key, value, updated_at) VALUES (?1, 'content', 'ar', ?2, ?3) ON CONFLICT (draft_id, kind, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
        .bind(draft, JSON.stringify({ heroTitle: title }), T),
    ]);
  const state = async () => ({
    revision: (await all<{ revision: number }>("SELECT revision FROM theme_drafts WHERE id = 'lock'"))[0]?.revision,
    parts: await all("SELECT value FROM theme_draft_parts WHERE draft_id = 'lock'"),
  });

  beforeAll(async () => {
    await run("INSERT INTO theme_drafts (id, store_id, theme_key, theme_version, created_at, updated_at) VALUES ('lock', 's1', 'theme-00', '1.4.0', ?1, ?1)", T);
  });

  it("saves for the writer that saw the current revision", async () => {
    await save(0, "first");
    await save(1, "second");
    expect(await state()).toEqual({ revision: 2, parts: [{ value: JSON.stringify({ heroTitle: "second" }) }] });
  });

  it("rolls back a stale writer's whole batch, naming the conflict", async () => {
    await expect(save(1, "stale")).rejects.toThrow(THEME_DRAFT_CHANGED);
    await expect(save(5, "ahead")).rejects.toThrow(THEME_DRAFT_CHANGED);
    expect(await state()).toEqual({ revision: 2, parts: [{ value: JSON.stringify({ heroTitle: "second" }) }] });
  });

  it("refuses parts for a draft that is gone", async () => {
    await expect(save(0, "orphan", "never-existed")).rejects.toThrow();
    expect(await count("SELECT count(*) n FROM theme_draft_parts WHERE draft_id = 'never-existed'")).toBe(0);
  });
});

describe("removing a store", () => {
  it("takes its documents, drafts, parts and publications with it", async () => {
    await run("DELETE FROM stores WHERE id = 's2'");
    for (const table of ["page_documents", "theme_drafts", "theme_publications"]) {
      expect(await count(`SELECT count(*) n FROM ${table} WHERE store_id = 's2'`), table).toBe(0);
    }
    expect(await count("SELECT count(*) n FROM theme_draft_parts WHERE draft_id = 'd-s2'")).toBe(0);
    expect(await all("PRAGMA foreign_key_check")).toEqual([]);
  });
});
