-- 0068_media.sql
-- Media on a Media Host behind one module (ADR 0021, docs/media/PLAN.md).
--
-- `media` records every file the store keeps to show: its Media Key, the host
-- holding its bytes, the host's own id for it, and whether its upload is
-- pending or ready. Each table that shows a file gains a key column, filled
-- here from what it held: the old key column, else the key inside the old URL
-- (the path from its `products/` folder on). A URL that names no stored file
-- (an image elsewhere on the web) gives no key; the URL itself stays.
--
-- Every key found gets its `media` row, on R2 — where every file stored
-- before this migration is — ready. Theme image fields already held keys:
-- theirs are found in the JSON documents. Images inside rich text keep their
-- URLs, which still show; they get no row, so no sweep ever deletes them.
--
-- The server this migration ships with writes only keys, so the old columns
-- that were NOT NULL — product_images.src, landing_page_images.r2_key and
-- src, review_media.r2_key — become nullable: those three tables are rebuilt,
-- every row and value copied, with the key filled as they are copied. Nothing
-- references them, and no trigger is on them. A server of the release before
-- still reads every old value; 0069, a release later, drops the old columns.
-- Elsewhere the change is additive: one table, three columns, one index.

CREATE TABLE media (
  id TEXT PRIMARY KEY NOT NULL,
  "key" TEXT NOT NULL UNIQUE,
  host TEXT NOT NULL,
  host_ref TEXT,
  kind TEXT NOT NULL,
  content_type TEXT NOT NULL,
  bytes INTEGER,
  width INTEGER,
  height INTEGER,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  ready_at TEXT
);

CREATE INDEX idx_media_status_created ON media (status, created_at);

-- data-safety: rebuild product_images — every row and value copied; src becomes nullable, and media_key is filled from r2_key, else from the key inside src
CREATE TABLE product_images_new (
  id TEXT PRIMARY KEY NOT NULL,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  src TEXT,
  r2_key TEXT,
  src_sm TEXT,
  src_md TEXT,
  src_lg TEXT,
  alt_text TEXT,
  width INTEGER,
  height INTEGER,
  type INTEGER NOT NULL DEFAULT 1,
  position INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  media_key TEXT
);
INSERT INTO product_images_new (id, product_id, src, r2_key, src_sm, src_md, src_lg, alt_text, width, height, type, position, created_at, updated_at, media_key)
SELECT id, product_id, src, r2_key, src_sm, src_md, src_lg, alt_text, width, height, type, position, created_at, updated_at,
  CASE
    WHEN r2_key IS NOT NULL AND r2_key <> '' THEN r2_key
    WHEN instr(src, '/products/') > 0 THEN substr(src, instr(src, '/products/') + 1)
  END
FROM product_images;
DROP TABLE product_images;
ALTER TABLE product_images_new RENAME TO product_images;
CREATE INDEX idx_product_images_product_position ON product_images (product_id, position);

-- data-safety: rebuild landing_page_images — every row and value copied; r2_key and src become nullable, and media_key, always set, is filled from r2_key
CREATE TABLE landing_page_images_new (
  id TEXT PRIMARY KEY,
  landing_page_id TEXT NOT NULL REFERENCES landing_pages(id) ON DELETE CASCADE,
  r2_key TEXT,
  src TEXT,
  alt_text TEXT,
  source TEXT NOT NULL DEFAULT 'upload',
  position INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  media_key TEXT NOT NULL
);
INSERT INTO landing_page_images_new (id, landing_page_id, r2_key, src, alt_text, source, position, created_at, width, height, media_key)
SELECT id, landing_page_id, r2_key, src, alt_text, source, position, created_at, width, height, r2_key
FROM landing_page_images;
DROP TABLE landing_page_images;
ALTER TABLE landing_page_images_new RENAME TO landing_page_images;
CREATE INDEX idx_landing_page_images_lp ON landing_page_images (landing_page_id, position);

ALTER TABLE product_categories ADD COLUMN image_key TEXT;
ALTER TABLE stores ADD COLUMN logo_key TEXT;
ALTER TABLE stores ADD COLUMN og_image_key TEXT;

-- data-safety: product_categories.image_key — the new column is filled from the key inside image_url; no other column is written
UPDATE product_categories SET image_key = substr(image_url, instr(image_url, '/products/') + 1)
WHERE instr(image_url, '/products/') > 0;

-- data-safety: stores.logo_key — the new column is filled from the key inside logo_url; no other column is written
UPDATE stores SET logo_key = substr(logo_url, instr(logo_url, '/products/') + 1)
WHERE instr(logo_url, '/products/') > 0;

-- data-safety: stores.og_image_key — the new column is filled from the key inside og_image; no other column is written
UPDATE stores SET og_image_key = substr(og_image, instr(og_image, '/products/') + 1)
WHERE instr(og_image, '/products/') > 0;

-- data-safety: rebuild review_media — every row and value copied; r2_key becomes nullable, and media_key, always set and unique, is filled from r2_key
CREATE TABLE review_media_new (
  id TEXT PRIMARY KEY NOT NULL,
  review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('image', 'audio')),
  r2_key TEXT UNIQUE,
  thumb_key TEXT UNIQUE,
  content_type TEXT NOT NULL,
  bytes INTEGER NOT NULL CHECK (bytes > 0),
  width INTEGER,
  height INTEGER,
  duration_ms INTEGER,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  media_key TEXT NOT NULL UNIQUE
);
INSERT INTO review_media_new (id, review_id, kind, r2_key, thumb_key, content_type, bytes, width, height, duration_ms, position, created_at, media_key)
SELECT id, review_id, kind, r2_key, thumb_key, content_type, bytes, width, height, duration_ms, position, created_at, r2_key
FROM review_media;
DROP TABLE review_media;
ALTER TABLE review_media_new RENAME TO review_media;
CREATE INDEX idx_review_media_review ON review_media (review_id, position);

-- Review files: their kind, type and size are known.
INSERT OR IGNORE INTO media (id, "key", host, host_ref, kind, content_type, bytes, width, height, status, created_at, ready_at)
SELECT lower(hex(randomblob(16))), media_key, 'r2', NULL, kind, content_type, bytes, width, height, 'ready', created_at, created_at
FROM review_media;

INSERT OR IGNORE INTO media (id, "key", host, host_ref, kind, content_type, bytes, width, height, status, created_at, ready_at)
SELECT lower(hex(randomblob(16))), thumb_key, 'r2', NULL, 'image', 'image/webp', NULL, NULL, NULL, 'ready', created_at, created_at
FROM review_media WHERE thumb_key IS NOT NULL;

-- Every other key is an image, typed by its extension; one statement per
-- source, because D1 caps the terms of a compound SELECT.

-- Product images.
INSERT OR IGNORE INTO media (id, "key", host, host_ref, kind, content_type, bytes, width, height, status, created_at, ready_at)
SELECT lower(hex(randomblob(16))), k, 'r2', NULL, 'image',
  CASE
    WHEN lower(k) LIKE '%.webp' THEN 'image/webp'
    WHEN lower(k) LIKE '%.png' THEN 'image/png'
    WHEN lower(k) LIKE '%.gif' THEN 'image/gif'
    WHEN lower(k) LIKE '%.jpg' OR lower(k) LIKE '%.jpeg' THEN 'image/jpeg'
    ELSE 'application/octet-stream'
  END,
  NULL, w, h, 'ready', at, at
FROM (SELECT media_key AS k, width AS w, height AS h, created_at AS at FROM product_images WHERE media_key IS NOT NULL) WHERE k <> '';

-- Landing images.
INSERT OR IGNORE INTO media (id, "key", host, host_ref, kind, content_type, bytes, width, height, status, created_at, ready_at)
SELECT lower(hex(randomblob(16))), k, 'r2', NULL, 'image',
  CASE
    WHEN lower(k) LIKE '%.webp' THEN 'image/webp'
    WHEN lower(k) LIKE '%.png' THEN 'image/png'
    WHEN lower(k) LIKE '%.gif' THEN 'image/gif'
    WHEN lower(k) LIKE '%.jpg' OR lower(k) LIKE '%.jpeg' THEN 'image/jpeg'
    ELSE 'application/octet-stream'
  END,
  NULL, w, h, 'ready', at, at
FROM (SELECT media_key AS k, width AS w, height AS h, created_at AS at FROM landing_page_images WHERE media_key IS NOT NULL) WHERE k <> '';

-- Category images.
INSERT OR IGNORE INTO media (id, "key", host, host_ref, kind, content_type, bytes, width, height, status, created_at, ready_at)
SELECT lower(hex(randomblob(16))), k, 'r2', NULL, 'image',
  CASE
    WHEN lower(k) LIKE '%.webp' THEN 'image/webp'
    WHEN lower(k) LIKE '%.png' THEN 'image/png'
    WHEN lower(k) LIKE '%.gif' THEN 'image/gif'
    WHEN lower(k) LIKE '%.jpg' OR lower(k) LIKE '%.jpeg' THEN 'image/jpeg'
    ELSE 'application/octet-stream'
  END,
  NULL, w, h, 'ready', at, at
FROM (SELECT image_key AS k, NULL AS w, NULL AS h, created_at AS at FROM product_categories WHERE image_key IS NOT NULL) WHERE k <> '';

-- The logo.
INSERT OR IGNORE INTO media (id, "key", host, host_ref, kind, content_type, bytes, width, height, status, created_at, ready_at)
SELECT lower(hex(randomblob(16))), k, 'r2', NULL, 'image',
  CASE
    WHEN lower(k) LIKE '%.webp' THEN 'image/webp'
    WHEN lower(k) LIKE '%.png' THEN 'image/png'
    WHEN lower(k) LIKE '%.gif' THEN 'image/gif'
    WHEN lower(k) LIKE '%.jpg' OR lower(k) LIKE '%.jpeg' THEN 'image/jpeg'
    ELSE 'application/octet-stream'
  END,
  NULL, w, h, 'ready', at, at
FROM (SELECT logo_key AS k, NULL AS w, NULL AS h, created_at AS at FROM stores WHERE logo_key IS NOT NULL) WHERE k <> '';

-- The share image.
INSERT OR IGNORE INTO media (id, "key", host, host_ref, kind, content_type, bytes, width, height, status, created_at, ready_at)
SELECT lower(hex(randomblob(16))), k, 'r2', NULL, 'image',
  CASE
    WHEN lower(k) LIKE '%.webp' THEN 'image/webp'
    WHEN lower(k) LIKE '%.png' THEN 'image/png'
    WHEN lower(k) LIKE '%.gif' THEN 'image/gif'
    WHEN lower(k) LIKE '%.jpg' OR lower(k) LIKE '%.jpeg' THEN 'image/jpeg'
    ELSE 'application/octet-stream'
  END,
  NULL, w, h, 'ready', at, at
FROM (SELECT og_image_key AS k, NULL AS w, NULL AS h, created_at AS at FROM stores WHERE og_image_key IS NOT NULL) WHERE k <> '';

-- Theme image fields in page documents.
INSERT OR IGNORE INTO media (id, "key", host, host_ref, kind, content_type, bytes, width, height, status, created_at, ready_at)
SELECT lower(hex(randomblob(16))), k, 'r2', NULL, 'image',
  CASE
    WHEN lower(k) LIKE '%.webp' THEN 'image/webp'
    WHEN lower(k) LIKE '%.png' THEN 'image/png'
    WHEN lower(k) LIKE '%.gif' THEN 'image/gif'
    WHEN lower(k) LIKE '%.jpg' OR lower(k) LIKE '%.jpeg' THEN 'image/jpeg'
    ELSE 'application/octet-stream'
  END,
  NULL, w, h, 'ready', at, at
FROM (SELECT j.value AS k, NULL AS w, NULL AS h, d.updated_at AS at FROM page_documents d, json_tree(d.document) j
  WHERE json_valid(d.document) AND j.key = 'key' AND j.type = 'text' AND j.value LIKE 'products/%') WHERE k <> '';

-- Theme image fields in the theme's settings.
INSERT OR IGNORE INTO media (id, "key", host, host_ref, kind, content_type, bytes, width, height, status, created_at, ready_at)
SELECT lower(hex(randomblob(16))), k, 'r2', NULL, 'image',
  CASE
    WHEN lower(k) LIKE '%.webp' THEN 'image/webp'
    WHEN lower(k) LIKE '%.png' THEN 'image/png'
    WHEN lower(k) LIKE '%.gif' THEN 'image/gif'
    WHEN lower(k) LIKE '%.jpg' OR lower(k) LIKE '%.jpeg' THEN 'image/jpeg'
    ELSE 'application/octet-stream'
  END,
  NULL, w, h, 'ready', at, at
FROM (SELECT j.value AS k, NULL AS w, NULL AS h, s.updated_at AS at FROM store_theme_settings s, json_tree(s."values") j
  WHERE json_valid(s."values") AND j.key = 'key' AND j.type = 'text' AND j.value LIKE 'products/%') WHERE k <> '';

-- Theme image fields in drafts.
INSERT OR IGNORE INTO media (id, "key", host, host_ref, kind, content_type, bytes, width, height, status, created_at, ready_at)
SELECT lower(hex(randomblob(16))), k, 'r2', NULL, 'image',
  CASE
    WHEN lower(k) LIKE '%.webp' THEN 'image/webp'
    WHEN lower(k) LIKE '%.png' THEN 'image/png'
    WHEN lower(k) LIKE '%.gif' THEN 'image/gif'
    WHEN lower(k) LIKE '%.jpg' OR lower(k) LIKE '%.jpeg' THEN 'image/jpeg'
    ELSE 'application/octet-stream'
  END,
  NULL, w, h, 'ready', at, at
FROM (SELECT j.value AS k, NULL AS w, NULL AS h, p.updated_at AS at FROM theme_draft_parts p, json_tree(p.value) j
  WHERE json_valid(p.value) AND j.key = 'key' AND j.type = 'text' AND j.value LIKE 'products/%') WHERE k <> '';

-- Theme image fields in publications kept as restore points.
INSERT OR IGNORE INTO media (id, "key", host, host_ref, kind, content_type, bytes, width, height, status, created_at, ready_at)
SELECT lower(hex(randomblob(16))), k, 'r2', NULL, 'image',
  CASE
    WHEN lower(k) LIKE '%.webp' THEN 'image/webp'
    WHEN lower(k) LIKE '%.png' THEN 'image/png'
    WHEN lower(k) LIKE '%.gif' THEN 'image/gif'
    WHEN lower(k) LIKE '%.jpg' OR lower(k) LIKE '%.jpeg' THEN 'image/jpeg'
    ELSE 'application/octet-stream'
  END,
  NULL, w, h, 'ready', at, at
FROM (SELECT j.value AS k, NULL AS w, NULL AS h, t.published_at AS at FROM theme_publications t, json_tree(t.state) j
  WHERE json_valid(t.state) AND j.key = 'key' AND j.type = 'text' AND j.value LIKE 'products/%') WHERE k <> '';

-- Theme image fields in text edits.
INSERT OR IGNORE INTO media (id, "key", host, host_ref, kind, content_type, bytes, width, height, status, created_at, ready_at)
SELECT lower(hex(randomblob(16))), k, 'r2', NULL, 'image',
  CASE
    WHEN lower(k) LIKE '%.webp' THEN 'image/webp'
    WHEN lower(k) LIKE '%.png' THEN 'image/png'
    WHEN lower(k) LIKE '%.gif' THEN 'image/gif'
    WHEN lower(k) LIKE '%.jpg' OR lower(k) LIKE '%.jpeg' THEN 'image/jpeg'
    ELSE 'application/octet-stream'
  END,
  NULL, w, h, 'ready', at, at
FROM (SELECT j.value AS k, NULL AS w, NULL AS h, o.updated_at AS at FROM store_content_overrides o, json_tree(o.value) j
  WHERE json_valid(o.value) AND j.key = 'key' AND j.type = 'text' AND j.value LIKE 'products/%') WHERE k <> '';
