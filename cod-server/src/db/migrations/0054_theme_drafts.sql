-- Theme drafts and publications, and page documents per theme (ADR 0010).
--
-- A store's live theme state is kept per theme: its page documents (here,
-- from now on, with theme_key), its settings (store_theme_settings, 0045) and
-- its text edits (store_content_overrides, 0036). CodFlow Cloud's editor
-- writes all of it through the merchant's Cloudflare connection; this
-- repository only reads the live state for the storefront, and reads drafts
-- and publications only for the image keys they hold (the orphan sweep).
--
-- page_documents is rebuilt with theme_key: switching themes must never lose
-- another theme's pages. A document takes the key its provenance names
-- (PageData.theme.key) when that is a theme key, else 'theme-00', the only
-- theme that has had documents. A row that is not a JSON object, or whose
-- surface is not a surface key, could never be shown and is not carried over.
-- The table has no dependents, so the rebuild touches nothing else.
--
-- theme_drafts is one working copy of one theme's state; theme_draft_parts
-- holds what it changes, at the live tables' grain, each part a whole value:
--   document (key = surface)  the page document, or NULL: back to the theme's default
--   settings (key = '')       the settings object ({} = every default)
--   content  (key = language) that language's edit map ({} = no edits)
-- A part that is absent shows as live. base_updated_at is the live row's
-- updated_at the part started from (NULL when there was none). revision is the
-- draft's optimistic lock: every write is one batch that starts by setting it
-- to the revision the writer last saw + 1, and the database refuses any other
-- step with THEME_DRAFT_CHANGED, so a stale batch is rolled back whole; parts
-- written for a draft that is gone fail its foreign key the same way.
--
-- theme_publications keeps the theme's whole live state after each publish,
-- as an array of { kind, key, value } parts — a restore point that depends on
-- no other row. The newest 50 per store and theme are kept.
--
-- Removing a store's language removes the drafts' text parts for it, as it
-- removes that language's live edits. Theme keys and surfaces follow the SDK's
-- rules (THEME_KEY_RE, PAGE_DOCUMENT_SURFACE_RE). Each trigger is one line:
-- the test harness splits statements on ";" + newline.

PRAGMA defer_foreign_keys = ON;

CREATE TABLE page_documents_0054 (
  id text PRIMARY KEY NOT NULL,
  store_id text NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  theme_key text NOT NULL CHECK (length(theme_key) BETWEEN 1 AND 64 AND theme_key GLOB '[a-z]*' AND theme_key NOT GLOB '*[^a-z0-9-]*' AND theme_key NOT GLOB '*--*' AND theme_key NOT GLOB '*-'),
  surface text NOT NULL CHECK (length(surface) BETWEEN 1 AND 64 AND surface GLOB '[a-z0-9]*' AND surface NOT GLOB '*[^a-z0-9._:-]*'),
  document text NOT NULL CHECK (json_valid(document) AND json_type(document) = 'object'),
  created_at text NOT NULL,
  updated_at text NOT NULL
);

INSERT INTO page_documents_0054 (id, store_id, theme_key, surface, document, created_at, updated_at)
SELECT id, store_id,
  CASE WHEN typeof(provenance) = 'text' AND length(provenance) BETWEEN 1 AND 64 AND provenance GLOB '[a-z]*' AND provenance NOT GLOB '*[^a-z0-9-]*' AND provenance NOT GLOB '*--*' AND provenance NOT GLOB '*-' THEN provenance ELSE 'theme-00' END,
  surface, document, created_at, updated_at
FROM (
  SELECT *, json_extract(document, '$.theme.key') AS provenance
  FROM page_documents
  WHERE json_valid(document) AND json_type(document) = 'object'
    AND length(surface) BETWEEN 1 AND 64 AND surface GLOB '[a-z0-9]*' AND surface NOT GLOB '*[^a-z0-9._:-]*'
);

DROP TABLE page_documents;

ALTER TABLE page_documents_0054 RENAME TO page_documents;

CREATE UNIQUE INDEX idx_page_documents_theme_surface ON page_documents (store_id, theme_key, surface);

CREATE TABLE theme_drafts (
  id text PRIMARY KEY NOT NULL,
  store_id text NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  theme_key text NOT NULL CHECK (length(theme_key) BETWEEN 1 AND 64 AND theme_key GLOB '[a-z]*' AND theme_key NOT GLOB '*[^a-z0-9-]*' AND theme_key NOT GLOB '*--*' AND theme_key NOT GLOB '*-'),
  theme_version text NOT NULL CHECK (length(theme_version) BETWEEN 1 AND 64),
  name text CHECK (name IS NULL OR length(name) BETWEEN 1 AND 100),
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_by text,
  updated_by text,
  created_at text NOT NULL,
  updated_at text NOT NULL
);

CREATE INDEX idx_theme_drafts_store_theme ON theme_drafts (store_id, theme_key, updated_at);

CREATE TABLE theme_draft_parts (
  draft_id text NOT NULL REFERENCES theme_drafts(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('document', 'settings', 'content')),
  key text NOT NULL,
  value text CHECK (value IS NULL OR (json_valid(value) AND json_type(value) = 'object')),
  base_updated_at text,
  updated_at text NOT NULL,
  PRIMARY KEY (draft_id, kind, key),
  CHECK (value IS NOT NULL OR kind = 'document'),
  CHECK ((kind = 'settings') = (key = '')),
  CHECK (kind <> 'document' OR (length(key) BETWEEN 1 AND 64 AND key GLOB '[a-z0-9]*' AND key NOT GLOB '*[^a-z0-9._:-]*')),
  CHECK (kind <> 'content' OR (length(key) BETWEEN 2 AND 16 AND key GLOB '[a-z]*' AND key NOT GLOB '*[^a-zA-Z0-9-]*'))
);

CREATE TABLE theme_publications (
  id text PRIMARY KEY NOT NULL,
  store_id text NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  theme_key text NOT NULL CHECK (length(theme_key) BETWEEN 1 AND 64 AND theme_key GLOB '[a-z]*' AND theme_key NOT GLOB '*[^a-z0-9-]*' AND theme_key NOT GLOB '*--*' AND theme_key NOT GLOB '*-'),
  theme_version text NOT NULL CHECK (length(theme_version) BETWEEN 1 AND 64),
  draft_id text,
  state text NOT NULL CHECK (json_valid(state) AND json_type(state) = 'array'),
  published_by text,
  published_at text NOT NULL
);

CREATE INDEX idx_theme_publications_store_theme ON theme_publications (store_id, theme_key, published_at);

CREATE TRIGGER theme_publications_keep_newest AFTER INSERT ON theme_publications BEGIN DELETE FROM theme_publications WHERE store_id = NEW.store_id AND theme_key = NEW.theme_key AND id NOT IN (SELECT id FROM theme_publications WHERE store_id = NEW.store_id AND theme_key = NEW.theme_key ORDER BY published_at DESC, id DESC LIMIT 50); END;

CREATE TRIGGER theme_drafts_revision_moves_by_one BEFORE UPDATE OF revision ON theme_drafts WHEN NEW.revision <> OLD.revision + 1 BEGIN SELECT RAISE(ABORT, 'THEME_DRAFT_CHANGED'); END;

CREATE TRIGGER theme_draft_parts_language_removed AFTER DELETE ON store_locales BEGIN DELETE FROM theme_draft_parts WHERE kind = 'content' AND key = OLD.locale AND draft_id IN (SELECT id FROM theme_drafts WHERE store_id = OLD.store_id); END;
