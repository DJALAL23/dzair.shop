-- Reviews with photos and a voice note, reviews a merchant enters, and one
-- review per product of an order.
--
-- reviews is rebuilt (nothing references it yet):
--   - order_id becomes nullable: a merchant review needs no order;
--   - one review per product of an order, instead of one per order, so a
--     basket can review each thing it contained;
--   - customer_id links a merchant review to a customer of the list;
--   - source says who entered it, verified whether it rests on a delivered
--     order (the "verified purchase" badge), media_dropped how many files
--     could not be kept, created_by the staff member who entered it;
--   - status gains 'processing': received, its media still being prepared;
--   - rating, status and source get the CHECKs the app always assumed.
-- review_media holds each photo or voice note of a review and goes with it.
-- stores gains what the merchant decides: how many photos, how long a voice
-- note (NULL = no voice), and what is published without checking. Stores that
-- exist keep checking every review, as before; a new store publishes text
-- reviews at once.

PRAGMA defer_foreign_keys = ON;

CREATE TABLE reviews_0043 (
  id text PRIMARY KEY NOT NULL,
  store_id text NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  product_id text NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  order_id text REFERENCES orders(id) ON DELETE CASCADE,
  customer_id text REFERENCES customers(id) ON DELETE SET NULL,
  order_number text,
  customer_name text NOT NULL,
  rating integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title text,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('processing', 'pending', 'approved', 'rejected')),
  source text NOT NULL DEFAULT 'storefront' CHECK (source IN ('storefront', 'merchant')),
  verified integer NOT NULL DEFAULT 0 CHECK (verified IN (0, 1)),
  media_dropped integer NOT NULL DEFAULT 0 CHECK (media_dropped >= 0),
  created_by text,
  helpful_count integer NOT NULL DEFAULT 0,
  created_at text NOT NULL,
  updated_at text NOT NULL
);

INSERT INTO reviews_0043 (id, store_id, product_id, order_id, customer_id, order_number, customer_name, rating, title, body, status, source, verified, media_dropped, created_by, helpful_count, created_at, updated_at)
SELECT r.id, r.store_id, r.product_id, r.order_id, o.customer_id, r.order_number, r.customer_name, min(max(r.rating, 1), 5), r.title, r.body,
  CASE WHEN r.status IN ('pending', 'approved', 'rejected') THEN r.status ELSE 'pending' END,
  'storefront',
  CASE WHEN EXISTS (SELECT 1 FROM shipments s WHERE s.order_id = r.order_id AND s.delivered_at IS NOT NULL) THEN 1 ELSE 0 END,
  0, NULL, r.helpful_count, r.created_at, r.updated_at
FROM reviews r LEFT JOIN orders o ON o.id = r.order_id;

DROP TABLE reviews;
ALTER TABLE reviews_0043 RENAME TO reviews;

CREATE UNIQUE INDEX reviews_order_product ON reviews (order_id, product_id) WHERE order_id IS NOT NULL;
CREATE INDEX idx_reviews_product_status ON reviews (product_id, status, created_at DESC);
CREATE INDEX idx_reviews_status_created ON reviews (status, created_at DESC);
CREATE INDEX idx_reviews_customer ON reviews (customer_id) WHERE customer_id IS NOT NULL;

CREATE TABLE review_media (
  id text PRIMARY KEY NOT NULL,
  review_id text NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('image', 'audio')),
  r2_key text NOT NULL UNIQUE,
  thumb_key text UNIQUE,
  content_type text NOT NULL,
  bytes integer NOT NULL CHECK (bytes > 0),
  width integer,
  height integer,
  duration_ms integer,
  position integer NOT NULL DEFAULT 0,
  created_at text NOT NULL
);

CREATE INDEX idx_review_media_review ON review_media (review_id, position);

ALTER TABLE stores ADD COLUMN review_max_photos integer NOT NULL DEFAULT 3 CHECK (review_max_photos BETWEEN 0 AND 6);
ALTER TABLE stores ADD COLUMN review_voice_max_seconds integer CHECK (review_voice_max_seconds IS NULL OR review_voice_max_seconds IN (30, 60, 90, 120));
ALTER TABLE stores ADD COLUMN review_auto_publish text NOT NULL DEFAULT 'text_only' CHECK (review_auto_publish IN ('off', 'text_only', 'all'));

UPDATE stores SET review_auto_publish = 'off';
