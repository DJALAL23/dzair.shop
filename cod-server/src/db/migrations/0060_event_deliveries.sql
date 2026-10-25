-- The delivery side of Business Events (ADR 0017): who receives them, and
-- each one on its way to each receiver. The state lives here, in the store's
-- D1, not in a queue: a Delivery is due, delivered, skipped or dead, with
-- every Attempt kept beside it.
--
-- business_events.fanned_out_at says an event's Deliveries exist; the drain
-- finds the events still to fan out through a partial index on the rest.
--
-- No CHECK on kinds or states: they grow, and a CHECK in SQLite can only
-- change by rebuilding its table — which event_deliveries and its attempts,
-- referenced, may never be.
--
-- Additive: one new nullable column and three new tables; no existing row
-- or value changes.
ALTER TABLE business_events ADD COLUMN fanned_out_at TEXT;
CREATE INDEX business_events_unfanned ON business_events (seq) WHERE fanned_out_at IS NULL;

CREATE TABLE event_consumers (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  subscription TEXT NOT NULL,
  catalogue_version INTEGER NOT NULL DEFAULT 1,
  settings TEXT NOT NULL DEFAULT '{}',
  signing_secret TEXT,
  previous_signing_secret TEXT,
  secret_rotated_at TEXT,
  failing_since TEXT,
  disabled_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE event_deliveries (
  id TEXT PRIMARY KEY NOT NULL,
  event_seq INTEGER NOT NULL REFERENCES business_events(seq) ON DELETE CASCADE,
  consumer_id TEXT NOT NULL REFERENCES event_consumers(id) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'due',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  settled_at TEXT,
  UNIQUE (event_seq, consumer_id)
);
CREATE INDEX event_deliveries_due ON event_deliveries (next_attempt_at) WHERE state = 'due';
CREATE INDEX event_deliveries_consumer ON event_deliveries (consumer_id, created_at);

CREATE TABLE event_delivery_attempts (
  id TEXT PRIMARY KEY NOT NULL,
  delivery_id TEXT NOT NULL REFERENCES event_deliveries(id) ON DELETE CASCADE,
  attempt INTEGER NOT NULL,
  attempted_at TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  outcome TEXT NOT NULL,
  http_status INTEGER,
  response_excerpt TEXT,
  error TEXT
);
CREATE INDEX event_delivery_attempts_delivery ON event_delivery_attempts (delivery_id, attempt);
