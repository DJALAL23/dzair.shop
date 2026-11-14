-- The store's own costs and exchange rates (marketing analytics Phase 2.4):
-- ads, packaging, calls, rent, subscriptions, each once, repeating, or per
-- order confirmed, shipped, delivered or returned; and what a dollar or a
-- euro costs the merchant, from a day on.
--
-- Additive: two new tables, empty, and two indexes on shipments. A cost is
-- kept as versions sharing a series, so a change from a day never rewrites a
-- past month. Amounts are integers in the currency's minor unit. The product
-- a cost is for may be deleted: the cost keeps its name (product_name is set
-- only for a product's cost) and stays the money it was. No CHECK on a
-- vocabulary (category, charge, currency): they grow, and a CHECK in SQLite
-- changes only by rebuilding the table.
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
  product_id TEXT REFERENCES products(id) ON DELETE SET NULL,
  product_name TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX costs_series ON costs (series_id, valid_from);

CREATE TABLE exchange_rates (
  id TEXT PRIMARY KEY NOT NULL,
  currency TEXT NOT NULL,
  centimes_per_unit INTEGER NOT NULL CHECK (centimes_per_unit > 0),
  valid_from TEXT NOT NULL,
  created_by TEXT,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX exchange_rates_from ON exchange_rates (currency, valid_from);

-- A cost per shipped or returned order counts them by day without reading
-- every shipment (confirmed and delivered have theirs since 0086).
CREATE INDEX shipments_shipped ON shipments (created_at) WHERE handoff_state = 'accepted';
CREATE INDEX shipments_returned ON shipments (returned_at) WHERE returned_at IS NOT NULL;
