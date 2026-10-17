-- Collections: lists of products the merchant curates by hand — "Featured",
-- "Best sellers", "New arrivals", "Ramadan picks" — like Shopify's manual
-- collections. A collection is a handle, a title and an ordered list of
-- products; a product may be in any number of them. A theme section names one
-- by handle (a `collection` theme setting) and shows its products in order.
-- Categories stay what they are: the catalog's browsing tree, one per product.
--
-- products.store_featured was the first such list, as a flag the dashboard
-- never let a merchant set. Its products move into each store's `featured`
-- collection and the column goes. /store/* keeps answering `storeFeatured`
-- (membership of `featured`), because @wocart/storefront up to 1.7 requires
-- it.

CREATE TABLE collections (
  id text PRIMARY KEY NOT NULL,
  store_id text NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  handle text NOT NULL CHECK (length(handle) BETWEEN 1 AND 64 AND handle NOT GLOB '*[^a-z0-9-]*' AND substr(handle, 1, 1) <> '-'),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 100),
  description text CHECK (description IS NULL OR length(description) <= 1000),
  created_at text NOT NULL,
  updated_at text NOT NULL
);

CREATE UNIQUE INDEX idx_collections_handle ON collections (store_id, handle);

CREATE TABLE collection_products (
  collection_id text NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  product_id text NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0,
  added_at text NOT NULL,
  PRIMARY KEY (collection_id, product_id)
);

CREATE INDEX idx_collection_products_order ON collection_products (collection_id, position);
CREATE INDEX idx_collection_products_product ON collection_products (product_id);

CREATE TRIGGER translations_collection_deleted AFTER DELETE ON collections BEGIN DELETE FROM translations WHERE resource_type = 'collection' AND resource_id = OLD.id; END;

INSERT INTO collections (id, store_id, handle, title, created_at, updated_at)
SELECT
  s.id || ':collection:featured',
  s.id,
  'featured',
  CASE s.lang WHEN 'fr' THEN 'En vedette' WHEN 'en' THEN 'Featured' ELSE 'منتجات مميزة' END,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM stores s
WHERE EXISTS (SELECT 1 FROM products WHERE store_featured = 1);

INSERT INTO collection_products (collection_id, product_id, position, added_at)
SELECT c.id, p.id, row_number() OVER (ORDER BY p.created_at DESC, p.id) - 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM collections c
JOIN products p ON p.store_featured = 1
WHERE c.handle = 'featured';

ALTER TABLE products DROP COLUMN store_featured;
