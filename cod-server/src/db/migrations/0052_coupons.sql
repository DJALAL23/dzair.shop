-- Coupons: codes a shopper enters at checkout, applied after offers (ADR 0007).
--
-- coupons holds one coupon per code, and the database keeps each coherent on
-- its own:
--   * a code is stored in its one form — upper case, A–Z 0–9 - _, 3 to 32 —
--     and is unique;
--   * a percentage is 1–100, a fixed amount at least one dinar, free delivery
--     carries no value; only a percentage has a most-off cap;
--   * a minimum is an amount or a number of items, never both;
--   * a schedule ends after it starts.
-- What a coupon covers and who may use it are rows: coupon_products,
-- coupon_collections, coupon_customers, coupon_customer_groups. A removed
-- product, collection, customer or group leaves its coupons, which then cover
-- or admit less — never more.
--
-- An order records its coupon (set null when the coupon is deleted), the code
-- as it was, and what the coupon took off; each line carries its share in
-- order_products.discount, so orders.price stays the sum of its lines and the
-- cash a carrier collects needs no knowledge of coupons.
--
-- A use is an order with the coupon that is not cancelled. The triggers check
-- the usage limit and one use per customer in the statement that inserts the
-- order, so two orders can never take the last use; cancellation is final, so
-- a cancelled order gives its use back for good. A coupon is applied when an
-- order is placed and never afterwards.

CREATE TABLE coupons (
  id text PRIMARY KEY NOT NULL,
  code text NOT NULL UNIQUE CHECK (length(code) BETWEEN 3 AND 32 AND code NOT GLOB '*[^A-Z0-9_-]*'),
  kind text NOT NULL,
  value integer NOT NULL,
  max_discount integer,
  min_subtotal integer CHECK (min_subtotal IS NULL OR min_subtotal >= 1),
  min_quantity integer CHECK (min_quantity IS NULL OR min_quantity >= 1),
  scope text NOT NULL DEFAULT 'store' CHECK (scope IN ('store', 'products', 'collections')),
  audience text NOT NULL DEFAULT 'everyone' CHECK (audience IN ('everyone', 'selected')),
  usage_limit integer CHECK (usage_limit IS NULL OR usage_limit >= 1),
  once_per_customer integer NOT NULL DEFAULT 0 CHECK (once_per_customer IN (0, 1)),
  starts_at text,
  ends_at text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at text NOT NULL,
  updated_at text NOT NULL,
  CHECK (
    (kind = 'percentage' AND value BETWEEN 1 AND 100)
    OR (kind = 'fixed_amount' AND value >= 1)
    OR (kind = 'free_shipping' AND value = 0)
  ),
  CHECK (max_discount IS NULL OR (kind = 'percentage' AND max_discount >= 1)),
  CHECK (min_subtotal IS NULL OR min_quantity IS NULL),
  CHECK (starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at)
);

CREATE TABLE coupon_products (
  coupon_id text NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
  product_id text NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  PRIMARY KEY (coupon_id, product_id)
);
CREATE INDEX idx_coupon_products_product ON coupon_products (product_id);

CREATE TABLE coupon_collections (
  coupon_id text NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
  collection_id text NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  PRIMARY KEY (coupon_id, collection_id)
);
CREATE INDEX idx_coupon_collections_collection ON coupon_collections (collection_id);

CREATE TABLE coupon_customers (
  coupon_id text NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
  customer_id text NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  PRIMARY KEY (coupon_id, customer_id)
);
CREATE INDEX idx_coupon_customers_customer ON coupon_customers (customer_id);

CREATE TABLE coupon_customer_groups (
  coupon_id text NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
  group_id text NOT NULL REFERENCES customer_groups(id) ON DELETE CASCADE,
  PRIMARY KEY (coupon_id, group_id)
);
CREATE INDEX idx_coupon_customer_groups_group ON coupon_customer_groups (group_id);

ALTER TABLE orders ADD COLUMN coupon_id text REFERENCES coupons(id) ON DELETE SET NULL;
ALTER TABLE orders ADD COLUMN coupon_code text;
ALTER TABLE orders ADD COLUMN coupon_discount integer NOT NULL DEFAULT 0 CHECK (coupon_discount >= 0);
ALTER TABLE order_products ADD COLUMN discount integer NOT NULL DEFAULT 0 CHECK (discount >= 0);

CREATE INDEX idx_orders_coupon_customer ON orders (coupon_id, customer_id) WHERE coupon_id IS NOT NULL;

CREATE TRIGGER orders_coupon_usage_limit BEFORE INSERT ON orders
WHEN NEW.coupon_id IS NOT NULL
  AND (SELECT usage_limit FROM coupons WHERE id = NEW.coupon_id) IS NOT NULL
  AND (SELECT count(*) FROM orders WHERE coupon_id = NEW.coupon_id AND status <> 'cancelled')
      >= (SELECT usage_limit FROM coupons WHERE id = NEW.coupon_id)
BEGIN SELECT RAISE(ABORT, 'COUPON_USED_UP'); END;

CREATE TRIGGER orders_coupon_once_per_customer BEFORE INSERT ON orders
WHEN NEW.coupon_id IS NOT NULL
  AND (SELECT once_per_customer FROM coupons WHERE id = NEW.coupon_id) = 1
  AND EXISTS (SELECT 1 FROM orders WHERE coupon_id = NEW.coupon_id AND customer_id = NEW.customer_id AND status <> 'cancelled')
BEGIN SELECT RAISE(ABORT, 'COUPON_ALREADY_USED'); END;

CREATE TRIGGER orders_coupon_at_placement BEFORE UPDATE OF coupon_id ON orders
WHEN NEW.coupon_id IS NOT NULL AND NEW.coupon_id IS NOT OLD.coupon_id
BEGIN SELECT RAISE(ABORT, 'COUPON_AT_PLACEMENT_ONLY'); END;
