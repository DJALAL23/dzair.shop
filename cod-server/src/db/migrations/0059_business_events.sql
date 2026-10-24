-- The Event Log (ADR 0016): every Business Event the store records. A row is
-- written by the cod-shared function that makes the change, in the same D1
-- batch and under the same guard, so an event exists exactly when its change
-- committed. `seq` is the Sequence: D1 serialises writes, so it is commit
-- order. No foreign key to orders or shipments — an event outlives its
-- subject (orders are deleted for real, shipments voided) and keeps the facts
-- as they were. No CHECK on the type, actor or origin vocabularies: they grow,
-- and a CHECK in SQLite can only change by rebuilding the table.
--
-- Additive: a new table; no existing row or value changes.
CREATE TABLE business_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  version INTEGER NOT NULL,
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  actor_kind TEXT NOT NULL,
  actor_id TEXT,
  actor_name TEXT,
  origin TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  data TEXT NOT NULL
);
