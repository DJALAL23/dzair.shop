-- Columns nothing reads any more, dropped with the code that once did:
--   * the store's old branding (colours, font) — a theme's settings style the
--     storefront (migration 0045) — and its status, which nothing checks;
--   * the URLs and R2 keys images had before Media Keys (migration 0068): the
--     store's logo and share image, a category's image, a product's and a
--     landing page's images, a review's media;
--   * the index on webhook_events.order_id, a column the delivery inbox
--     stopped writing when deliveries moved to shipments (the column keeps a
--     FOREIGN KEY clause, so SQLite drops it only with a rebuild of a table
--     shipment_events references — it stays, empty).
--
-- data-safety: stores.primary_color — the old brand colour; a theme's settings style the storefront
-- data-safety: stores.accent_color — the old accent colour; a theme's settings style the storefront
-- data-safety: stores.bg_color — the old background colour; a theme's settings style the storefront
-- data-safety: stores.font_family — the old font; a theme's settings choose it
-- data-safety: stores.status — never checked by any surface
-- data-safety: stores.logo_url — the logo's URL before Media Keys; the logo is logo_key
-- data-safety: stores.og_image — the share image's URL before Media Keys; it is og_image_key
-- data-safety: product_categories.image_url — the image's URL before Media Keys
-- data-safety: product_images.src — the image's URL before Media Keys; it is media_key
-- data-safety: product_images.r2_key — the image's R2 key before Media Keys
-- data-safety: product_images.src_sm — a resized URL before Media Keys
-- data-safety: product_images.src_md — a resized URL before Media Keys
-- data-safety: product_images.src_lg — a resized URL before Media Keys
-- data-safety: landing_page_images.r2_key — the image's R2 key before Media Keys; it is media_key
-- data-safety: landing_page_images.src — the image's URL before Media Keys
ALTER TABLE stores DROP COLUMN primary_color;
ALTER TABLE stores DROP COLUMN accent_color;
ALTER TABLE stores DROP COLUMN bg_color;
ALTER TABLE stores DROP COLUMN font_family;
ALTER TABLE stores DROP COLUMN status;
ALTER TABLE stores DROP COLUMN logo_url;
ALTER TABLE stores DROP COLUMN og_image;
ALTER TABLE product_categories DROP COLUMN image_url;
ALTER TABLE product_images DROP COLUMN src;
ALTER TABLE product_images DROP COLUMN r2_key;
ALTER TABLE product_images DROP COLUMN src_sm;
ALTER TABLE product_images DROP COLUMN src_md;
ALTER TABLE product_images DROP COLUMN src_lg;
ALTER TABLE landing_page_images DROP COLUMN r2_key;
ALTER TABLE landing_page_images DROP COLUMN src;
DROP INDEX IF EXISTS idx_webhook_events_order;

-- review_media.r2_key is UNIQUE, which SQLite drops only by rebuilding the
-- table. No table references review_media, so the rebuild copies every row
-- and every other column, constraint and index.
-- data-safety: rebuild review_media — every row and every column but r2_key copied; no table references review_media
-- data-safety: review_media.r2_key — the file's R2 key before Media Keys; it is media_key
CREATE TABLE review_media_new (
  id TEXT PRIMARY KEY NOT NULL,
  review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('image', 'audio')),
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
INSERT INTO review_media_new (id, review_id, kind, thumb_key, content_type, bytes, width, height, duration_ms, position, created_at, media_key)
  SELECT id, review_id, kind, thumb_key, content_type, bytes, width, height, duration_ms, position, created_at, media_key FROM review_media;
DROP TABLE review_media;
ALTER TABLE review_media_new RENAME TO review_media;
CREATE INDEX idx_review_media_review ON review_media (review_id, position);
