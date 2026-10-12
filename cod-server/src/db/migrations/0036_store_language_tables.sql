-- Store languages and theme text as rows (ADR 0005, phase B revision).
--
-- store_locales: the languages a store has added, each published (shown to
--   shoppers) or not (being translated) — Shopify's shop locales. Every store
--   gets its primary language, published. Each language 0035 listed as served
--   stays published.
--
-- store_content_overrides: a store's edits to a theme's storefront text, one
--   row per theme, language and key. A row per key lets two editors change
--   different keys without overwriting each other; the theme key keeps one
--   theme's wording off another theme's keys. Edits 0035 kept per language are
--   carried over under 'theme-00', the reference theme whose content-pack keys
--   they name.
--
-- The JSON columns 0035 added are then dropped: one source of truth.
CREATE TABLE store_locales (
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  locale TEXT NOT NULL,
  published INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  PRIMARY KEY (store_id, locale)
);

CREATE TABLE store_content_overrides (
  store_id TEXT NOT NULL,
  theme_key TEXT NOT NULL,
  locale TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (store_id, theme_key, locale, key),
  FOREIGN KEY (store_id, locale) REFERENCES store_locales(store_id, locale) ON DELETE CASCADE
);

INSERT INTO store_locales (store_id, locale, published, created_at)
SELECT id, lang, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM stores;

INSERT OR IGNORE INTO store_locales (store_id, locale, published, created_at)
SELECT s.id, j.value, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM stores s,
  json_each(CASE WHEN json_valid(s.enabled_locales_json) THEN s.enabled_locales_json ELSE '[]' END) j
WHERE j.type = 'text' AND j.value IN ('ar', 'fr', 'en');

INSERT OR IGNORE INTO store_content_overrides (store_id, theme_key, locale, key, value, updated_at)
SELECT s.id, 'theme-00', l.key, e.key, e.value, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM stores s,
  json_each(CASE WHEN json_valid(s.content_overrides_json) THEN s.content_overrides_json ELSE '{}' END) l,
  json_each(CASE WHEN l.type = 'object' THEN l.value ELSE '{}' END) e
WHERE e.type = 'text'
  AND length(e.key) BETWEEN 1 AND 100
  AND e.key <> '__proto__'
  AND length(e.value) <= 5000
  AND EXISTS (SELECT 1 FROM store_locales sl WHERE sl.store_id = s.id AND sl.locale = l.key);

ALTER TABLE stores DROP COLUMN enabled_locales_json;
ALTER TABLE stores DROP COLUMN content_overrides_json;
