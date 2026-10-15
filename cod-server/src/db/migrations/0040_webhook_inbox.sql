-- The webhook inbox becomes durable (ADR 0006, plan stage 5).
--
-- A carrier's webhook is acknowledged as soon as its events are stored here;
-- they are processed afterwards — at once, and again by the scheduled sweep
-- when processing fails. Each event remembers the shipment it was matched
-- to, how many times processing was tried, and when it may be tried next.
-- An event that keeps failing becomes `dead` and stays visible.
--
-- result: pending | ok | ignored | unmatched | unknown_status |
--   deferred_settlement | error | dead (and `unmapped` on older rows).
--   Checked by the application, as before: older rows keep their values.
-- shipment_id: SET NULL when a shipment is voided — the event stays as audit.
-- order_id and new_status stay until the split migration.
ALTER TABLE webhook_events ADD COLUMN shipment_id TEXT REFERENCES shipments(id) ON DELETE SET NULL;
ALTER TABLE webhook_events ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE webhook_events ADD COLUMN next_attempt_at TEXT;
CREATE INDEX webhook_events_due ON webhook_events (next_attempt_at) WHERE result IN ('pending', 'error');
CREATE INDEX webhook_events_shipment ON webhook_events (shipment_id) WHERE shipment_id IS NOT NULL;
