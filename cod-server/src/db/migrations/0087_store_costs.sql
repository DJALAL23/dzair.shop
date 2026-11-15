-- The store's own costs and exchange rates (marketing analytics Phase 2.4):
-- ads, packaging, calls, rent, subscriptions, each once, repeating, or per
-- order confirmed, shipped, delivered or returned; and what a dollar or a
-- euro costs the merchant, from a day on.
--
-- Additive: three new tables, empty; two triggers; five indexes. No
-- existing row or column is changed. A cost is kept as versions sharing a
-- series, one per day at most, so a change from a day never rewrites a past
-- month; every write gives all of a cost's versions one new revision, the
-- guard against two changes at once. Amounts are integers in the
-- currency's minor unit. No CHECK on a vocabulary (category, charge,
-- currency): they grow, and a CHECK in SQLite changes only by rebuilding the
-- table.
--
-- A product's cost keeps counting the orders of that product after it is
-- deleted, so no past month changes: costs.product_id is no foreign key,
-- one trigger keeps which order lines were of the deleted product
-- (order_products.product_id becomes null), another the product's name, as
-- it was then, on its costs.
CREATE TABLE costs (
  id TEXT PRIMARY KEY NOT NULL,
  series_id TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  charge TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  currency TEXT NOT NULL,
  valid_from TEXT NOT NULL,
  valid_to TEXT CHECK (valid_to IS NULL OR valid_to >= valid_from),
  product_id TEXT,
  product_name TEXT,
  created_by TEXT,
  revision TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX costs_series ON costs (series_id, valid_from);

CREATE TABLE exchange_rates (
  id TEXT PRIMARY KEY NOT NULL,
  currency TEXT NOT NULL,
  centimes_per_unit INTEGER NOT NULL CHECK (centimes_per_unit > 0),
  valid_from TEXT NOT NULL,
  created_by TEXT,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX exchange_rates_from ON exchange_rates (currency, valid_from);

CREATE TABLE removed_product_lines (
  order_product_id TEXT PRIMARY KEY NOT NULL REFERENCES order_products(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL
);

CREATE INDEX removed_product_lines_product ON removed_product_lines (product_id);

CREATE TRIGGER products_removed_keep_order_lines BEFORE DELETE ON products BEGIN INSERT INTO removed_product_lines (order_product_id, product_id) SELECT id, OLD.id FROM order_products WHERE product_id = OLD.id; END;

CREATE TRIGGER products_removed_keep_cost_names BEFORE DELETE ON products BEGIN UPDATE costs SET product_name = OLD.name WHERE product_id = OLD.id; END;

-- A cost per shipped or returned order counts them by day without reading
-- every shipment (confirmed and delivered have theirs since 0086).
CREATE INDEX shipments_shipped ON shipments (created_at) WHERE handoff_state = 'accepted';
CREATE INDEX shipments_returned ON shipments (returned_at) WHERE returned_at IS NOT NULL;
