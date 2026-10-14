-- Shipments, their events, and driver settlement lines (ADR 0006, plan stage 3b).
--
-- shipments: one delivery execution of one order — by an integrated carrier
--   or by the store's own driver. An order has at most one (UNIQUE order_id).
--   The carrier's raw status is kept as reported; CodFlow's conclusions are
--   set-once milestone timestamps, never a status column. The CHECKs make the
--   model's invariants the database's: a carrier shipment has a company and,
--   once accepted, the carrier's parcel id; a driver shipment has a driver and
--   is accepted from the start; at most one of delivered / returned /
--   cancelled; a carrier-cancelled shipment never went out for delivery.
--   `revision` is a fresh random token per write: a writer claims the row by
--   replacing the revision it read, and every other statement of its batch
--   applies only while its own token stands — so two writers that read the
--   same shipment can never both apply their effects (no transaction API on
--   D1; a batch is atomic, a read-then-write is not).
-- shipment_events: every status reported for a shipment, raw and as
--   interpreted, with its reason, time and source. UNIQUE(shipment_id,
--   event_key) drops the same fact arriving twice (webhook and pull).
-- driver_payment_lines: which driver shipment a driver payment settles, and
--   for which part — settlement owns the link; a shipment holds no money state.
--
-- The old tables (company_shipments, order delivery columns) stay until the
-- split migration moves their data (stage 7).
CREATE TABLE shipments (
  id TEXT PRIMARY KEY NOT NULL,
  order_id TEXT NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('carrier', 'driver')),
  company_id TEXT REFERENCES delivery_companies(id),
  driver_id TEXT REFERENCES drivers(id),
  handoff_state TEXT NOT NULL CHECK (handoff_state IN ('submitting', 'accepted', 'unknown')),
  carrier_parcel_id TEXT,
  tracking_number TEXT,
  carrier_data TEXT,
  label_url TEXT,
  delivery_type TEXT NOT NULL CHECK (delivery_type IN ('home', 'stop_desk')),
  station_code TEXT,
  cod_amount REAL NOT NULL,
  driver_fee REAL NOT NULL DEFAULT 0,
  weight REAL,
  is_fragile INTEGER,
  provider_status TEXT,
  provider_status_label TEXT,
  provider_status_kind TEXT CHECK (provider_status_kind IN ('milestone', 'failed_attempt', 'exception', 'collection', 'progress', 'unknown')),
  provider_status_at TEXT,
  validated_at TEXT,
  out_for_delivery_at TEXT,
  delivered_at TEXT,
  return_started_at TEXT,
  returned_at TEXT,
  cancelled_at TEXT,
  delivery_attempts INTEGER NOT NULL DEFAULT 0,
  attention_since TEXT,
  last_synced_at TEXT,
  created_by TEXT,
  revision TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((kind = 'carrier' AND company_id IS NOT NULL AND driver_id IS NULL) OR (kind = 'driver' AND driver_id IS NOT NULL AND company_id IS NULL AND handoff_state = 'accepted')),
  CHECK (kind = 'driver' OR handoff_state <> 'accepted' OR carrier_parcel_id IS NOT NULL),
  CHECK ((delivered_at IS NOT NULL) + (returned_at IS NOT NULL) + (cancelled_at IS NOT NULL) <= 1),
  CHECK (cancelled_at IS NULL OR out_for_delivery_at IS NULL)
);
CREATE UNIQUE INDEX shipments_carrier_parcel ON shipments (company_id, carrier_parcel_id) WHERE carrier_parcel_id IS NOT NULL;
CREATE INDEX shipments_carrier_tracking ON shipments (company_id, tracking_number) WHERE tracking_number IS NOT NULL;
CREATE INDEX shipments_driver_open ON shipments (driver_id) WHERE driver_id IS NOT NULL AND delivered_at IS NULL AND returned_at IS NULL AND cancelled_at IS NULL;
CREATE INDEX shipments_sync_due ON shipments (company_id, last_synced_at) WHERE company_id IS NOT NULL AND delivered_at IS NULL AND returned_at IS NULL AND cancelled_at IS NULL;
CREATE INDEX shipments_attention ON shipments (attention_since) WHERE attention_since IS NOT NULL;
CREATE INDEX shipments_handoff_pending ON shipments (handoff_state, created_at) WHERE handoff_state <> 'accepted';
CREATE TABLE shipment_events (
  id TEXT PRIMARY KEY NOT NULL,
  shipment_id TEXT NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('webhook', 'pull', 'handoff', 'merchant', 'system', 'legacy')),
  event_key TEXT NOT NULL,
  vocabulary TEXT,
  provider_status TEXT,
  provider_status_label TEXT,
  interpretation TEXT CHECK (interpretation IN ('milestone', 'failed_attempt', 'exception', 'collection', 'progress', 'unknown')),
  milestone TEXT CHECK (milestone IN ('out_for_delivery', 'delivered', 'return_started', 'returned', 'cancelled')),
  attention INTEGER NOT NULL DEFAULT 0,
  anomaly TEXT,
  reason TEXT,
  occurred_at TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  actor_id TEXT,
  webhook_event_id TEXT REFERENCES webhook_events(id),
  raw TEXT,
  UNIQUE (shipment_id, event_key),
  CHECK ((interpretation = 'milestone') = (milestone IS NOT NULL) OR interpretation IS NULL)
);
CREATE INDEX shipment_events_timeline ON shipment_events (shipment_id, occurred_at);
CREATE TABLE driver_payment_lines (
  id TEXT PRIMARY KEY NOT NULL,
  payment_id TEXT NOT NULL REFERENCES driver_payments(id) ON DELETE CASCADE,
  shipment_id TEXT NOT NULL REFERENCES shipments(id),
  component TEXT NOT NULL CHECK (component IN ('cod', 'fee')),
  amount REAL NOT NULL,
  UNIQUE (shipment_id, component)
);
CREATE INDEX driver_payment_lines_payment ON driver_payment_lines (payment_id);
