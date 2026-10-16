-- What removing an order or a product takes with it, kept by the database.
--
-- A product can be removed even when orders hold it: the order lines keep what
-- was sold (name, variant label, SKU, price, quantity) and lose only the link.
-- Its variants, images, reviews, stock history and offers already cascade; its
-- landing pages go too, by trigger (landing_pages has dependents, so its
-- foreign key cannot be rebuilt), and the orders they brought lose only that
-- attribution.
--
-- An order can be removed only before it has a shipment, and the database
-- refuses it otherwise, so no code path can strand a parcel or a driver's
-- cash. A finished order is archived instead (orders.archived_at).
--
-- Tables with no dependents are rebuilt to change their foreign keys
-- (order_products, capi_event_log, company_api_logs). Tables with dependents
-- (orders, landing_pages) are never rebuilt — a rebuild would cascade-delete
-- their children (ADR 0006); triggers do their part instead. Each trigger is
-- one line: the statement splitters used by the test harness split on ";" +
-- newline.
--
-- products.deleted_at goes: deletion is a real delete, and the column was
-- never set.

PRAGMA defer_foreign_keys = ON;

-- ─── Order lines keep what was sold; the product link can go ─────────────────

CREATE TABLE order_products_0042 (
  id text PRIMARY KEY NOT NULL,
  order_id text NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id text REFERENCES products(id) ON DELETE SET NULL,
  product_name text NOT NULL,
  variant_id text REFERENCES product_variants(id) ON DELETE SET NULL,
  variant_label text,
  sku text,
  quantity integer NOT NULL,
  price_per_unit real NOT NULL,
  line_total real NOT NULL,
  created_at text NOT NULL,
  status text DEFAULT 'fulfilled' NOT NULL,
  returned_quantity integer DEFAULT 0 NOT NULL
);

INSERT INTO order_products_0042 (id, order_id, product_id, product_name, variant_id, variant_label, sku, quantity, price_per_unit, line_total, created_at, status, returned_quantity)
SELECT id, order_id, product_id, product_name, variant_id, variant_label, sku, quantity, price_per_unit, line_total, created_at, status, returned_quantity FROM order_products;

DROP TABLE order_products;
ALTER TABLE order_products_0042 RENAME TO order_products;
CREATE INDEX idx_order_products_order ON order_products (order_id);
CREATE INDEX idx_order_products_product ON order_products (product_id) WHERE product_id IS NOT NULL;
CREATE INDEX idx_order_products_variant ON order_products (variant_id) WHERE variant_id IS NOT NULL;

-- ─── An order's logs go with it ──────────────────────────────────────────────

CREATE TABLE capi_event_log_0042 (
  id text PRIMARY KEY NOT NULL,
  order_id text NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  event_name text NOT NULL,
  status text NOT NULL,
  meta_event_id text,
  error text,
  sent_at text NOT NULL,
  stage text NOT NULL DEFAULT 'delivered',
  pixel_id text
);

INSERT INTO capi_event_log_0042 (id, order_id, event_name, status, meta_event_id, error, sent_at, stage, pixel_id)
SELECT id, order_id, event_name, status, meta_event_id, error, sent_at, stage, pixel_id FROM capi_event_log;

DROP TABLE capi_event_log;
ALTER TABLE capi_event_log_0042 RENAME TO capi_event_log;
CREATE INDEX idx_capi_event_log_order ON capi_event_log (order_id);
CREATE UNIQUE INDEX idx_capi_event_log_claim ON capi_event_log (order_id, stage, event_name);

CREATE TABLE company_api_logs_0042 (
  id text PRIMARY KEY NOT NULL,
  company_id text NOT NULL REFERENCES delivery_companies(id),
  order_id text REFERENCES orders(id) ON DELETE CASCADE,
  action text NOT NULL,
  method text NOT NULL,
  endpoint text NOT NULL,
  request_body text,
  http_status integer,
  response_body text,
  success integer DEFAULT false NOT NULL,
  error_message text,
  duration_ms integer,
  created_at text NOT NULL
);

INSERT INTO company_api_logs_0042 (id, company_id, order_id, action, method, endpoint, request_body, http_status, response_body, success, error_message, duration_ms, created_at)
SELECT id, company_id, order_id, action, method, endpoint, request_body, http_status, response_body, success, error_message, duration_ms, created_at FROM company_api_logs;

DROP TABLE company_api_logs;
ALTER TABLE company_api_logs_0042 RENAME TO company_api_logs;
CREATE INDEX idx_company_api_logs_order ON company_api_logs (order_id) WHERE order_id IS NOT NULL;

-- ─── Orders: archived, and never removed once handed to delivery ─────────────

ALTER TABLE orders ADD COLUMN archived_at text;
CREATE INDEX idx_orders_archived_created_id ON orders (created_at DESC, id DESC) WHERE archived_at IS NOT NULL;

CREATE TRIGGER orders_keep_shipped BEFORE DELETE ON orders WHEN EXISTS (SELECT 1 FROM shipments WHERE order_id = OLD.id) BEGIN SELECT RAISE(ABORT, 'ORDER_HAS_SHIPMENT'); END;
CREATE TRIGGER orders_removed_unlink_checkouts AFTER DELETE ON orders BEGIN UPDATE abandoned_orders SET converted_order_id = NULL WHERE converted_order_id = OLD.id; END;

-- ─── Products: what has no foreign key, or one that cannot be rebuilt ────────

CREATE TRIGGER landing_pages_removed_unlink_orders BEFORE DELETE ON landing_pages BEGIN UPDATE orders SET landing_page_id = NULL WHERE landing_page_id = OLD.id; END;
CREATE TRIGGER products_removed_take_landing_pages BEFORE DELETE ON products BEGIN DELETE FROM landing_pages WHERE product_id = OLD.id; END;
CREATE TRIGGER products_removed_unlink_checkouts AFTER DELETE ON products BEGIN UPDATE abandoned_orders SET product_id = NULL, variant_id = NULL WHERE product_id = OLD.id; END;
CREATE TRIGGER variants_removed_unlink_checkouts AFTER DELETE ON product_variants BEGIN UPDATE abandoned_orders SET variant_id = NULL WHERE variant_id = OLD.id; END;

-- ─── Every child a removal reaches is found by an index, not a table scan ─────

CREATE INDEX idx_offers_trigger_product ON offers (trigger_product_id) WHERE trigger_product_id IS NOT NULL;
CREATE INDEX idx_offers_reward_product ON offers (reward_product_id) WHERE reward_product_id IS NOT NULL;
CREATE INDEX idx_offers_trigger_variant ON offers (trigger_variant_id) WHERE trigger_variant_id IS NOT NULL;
CREATE INDEX idx_offers_reward_variant ON offers (reward_variant_id) WHERE reward_variant_id IS NOT NULL;
CREATE INDEX idx_stock_movements_variant ON stock_movements (variant_id) WHERE variant_id IS NOT NULL;
CREATE INDEX idx_products_category ON products (category_id) WHERE category_id IS NOT NULL;
CREATE INDEX idx_webhook_events_order ON webhook_events (order_id) WHERE order_id IS NOT NULL;
CREATE INDEX idx_abandoned_orders_product ON abandoned_orders (product_id) WHERE product_id IS NOT NULL;
CREATE INDEX idx_abandoned_orders_variant ON abandoned_orders (variant_id) WHERE variant_id IS NOT NULL;
CREATE INDEX idx_abandoned_orders_converted ON abandoned_orders (converted_order_id) WHERE converted_order_id IS NOT NULL;

ALTER TABLE products DROP COLUMN deleted_at;
