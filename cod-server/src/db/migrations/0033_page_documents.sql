-- Theme page documents — the persisted composition for one storefront surface
-- (Phase 6: cod-sdk/theme-sdk/19-phase-6-reassessment.md,
-- 20-phase-6-page-data-foundation.md).
--
-- Why this exists: the Home surface renders from a page document (theme-00
-- `pages/home.page.json` today). This table is where a store's OWN document
-- lives once an editor (Codflow Cloud Studio, future) saves one — one row per
-- store per surface, so the document stays a reviewable, replaceable unit
-- instead of one giant store-wide blob (slice 05 D5.1).
--
-- Access model:
--   read  — `GET /store/page-documents/{surface}` (store API key, read-only);
--           the theme falls back to its shipped default when no row exists,
--           so applying this migration changes nothing for any store today.
--   write — Codflow Cloud control plane only (Studio phase), via the same
--           consented Cloudflare-API channel that applies migrations. There is
--           no runtime write route, and none is planned on the merchant's
--           server.
--
-- document: the PageData JSON verbatim ({ version, surface, sections }).
--   `version` lives INSIDE the document and is preserved verbatim (slice 05
--   §5) — no mirror column. Parsed (never evaluated) at read time; an
--   unparseable row degrades to "no document" rather than failing the page.
--
-- Deterministic id `pd-<store>-<surface>` (seed script + upsert helper) keeps
-- re-seeding idempotent beside the unique (store_id, surface) index.
--
-- Additive only. No existing table is touched.
CREATE TABLE IF NOT EXISTS page_documents (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id),
  surface TEXT NOT NULL,
  document TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_page_documents_store_surface
  ON page_documents(store_id, surface);
