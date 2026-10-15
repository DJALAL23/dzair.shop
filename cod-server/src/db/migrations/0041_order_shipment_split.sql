-- The order / shipment split, for existing data (ADR 0006, plan §8).
--
-- Every order that went to delivery the old way — a carrier parcel in
-- company_shipments, or a driver on the order — gets the shipment it would
-- have had: its company or driver, its parcel, the cash and the driver's fee
-- frozen on the order, and its milestones from the order's history. Old
-- history rows and webhook payloads become the shipment's events. Driver
-- settlement links become driver_payment_lines. The order is `ready` again.
-- No effect is run again: stock, spend and the drivers' counters already
-- reflect what happened, so the driver's cash drift is the same after.
--
-- A delivery that cannot be told for sure stops the migration, with nothing
-- changed (a migration is one transaction): the guard names the case and the
-- orders are decided by hand before the release.
--
-- Then the old columns and tables go, by DROP COLUMN only — a table rebuild
-- would cascade-delete its children (plan §8, ADR 0006). Three columns are
-- named in a table FOREIGN KEY clause, which SQLite cannot drop a column
-- from: orders.driver_id, orders.company_id and webhook_events.order_id stay,
-- emptied, unread and unwritten — so they never hold a driver, a company or
-- an order in place again.

-- ─── The legacy deliveries to move ──────────────────────────────────────────

-- The carrier parcel each order still has: the company_shipments row whose
-- tracking number is the order's (other rows are earlier, voided attempts).
-- ZR Express addresses parcels by an id kept in the create response; the
-- other carriers by the tracking number.
CREATE TABLE _carrier_0041 AS
SELECT cs.id AS shipment_id, o.id AS order_id, cs.company_id, cs.tracking_number, cs.validated, cs.label_url, cs.created_at, cs.updated_at,
  coalesce(
    CASE WHEN json_valid(cs.raw_response) THEN coalesce(
      json_extract(cs.raw_response, '$.parcelId'),
      json_extract(cs.raw_response, '$.parcel.id'),
      json_extract(cs.raw_response, '$.rawResponse.parcelId'),
      json_extract(cs.raw_response, '$.createRes.id')
    ) END,
    cs.tracking_number
  ) AS parcel_id
FROM orders o
JOIN (
  SELECT c.*, row_number() OVER (PARTITION BY c.order_id ORDER BY c.created_at DESC, c.id DESC) AS rank
  FROM company_shipments c
) cs ON cs.order_id = o.id AND cs.tracking_number = o.tracking_number AND cs.rank = 1
WHERE o.status <> 'cancelled'
  AND NOT EXISTS (SELECT 1 FROM shipments s WHERE s.order_id = o.id);

-- The orders the store's driver has out or delivered.
CREATE TABLE _driver_0041 AS
SELECT o.id AS order_id, lower(hex(randomblob(16))) AS shipment_id
FROM orders o
WHERE o.driver_id IS NOT NULL
  AND o.status IN ('assigned', 'out_for_delivery', 'delivered', 'returned')
  AND NOT EXISTS (SELECT 1 FROM shipments s WHERE s.order_id = o.id)
  AND NOT EXISTS (SELECT 1 FROM _carrier_0041 c WHERE c.order_id = o.id);

-- ─── Guard: nothing is guessed ───────────────────────────────────────────────

CREATE TABLE _guard_0041 (
  -- Sent to delivery, but with neither its carrier parcel nor a driver.
  stranded_deliveries INTEGER NOT NULL CONSTRAINT stranded_deliveries CHECK (stranded_deliveries = 0),
  -- A carrier parcel and a driver on the same order.
  driver_and_carrier INTEGER NOT NULL CONSTRAINT driver_and_carrier CHECK (driver_and_carrier = 0),
  -- The same parcel at the same company for two orders (or one already moved).
  duplicate_parcels INTEGER NOT NULL CONSTRAINT duplicate_parcels CHECK (duplicate_parcels = 0),
  -- A settlement link on an order that is not a delivery by that payment's driver.
  unmatched_settlements INTEGER NOT NULL CONSTRAINT unmatched_settlements CHECK (unmatched_settlements = 0)
);

INSERT INTO _guard_0041 (stranded_deliveries, driver_and_carrier, duplicate_parcels, unmatched_settlements)
SELECT
  (SELECT count(*) FROM orders o
    WHERE o.status IN ('dispatched', 'out_for_delivery', 'delivered', 'returned')
      AND NOT EXISTS (SELECT 1 FROM shipments s WHERE s.order_id = o.id)
      AND NOT EXISTS (SELECT 1 FROM _carrier_0041 c WHERE c.order_id = o.id)
      AND NOT EXISTS (SELECT 1 FROM _driver_0041 d WHERE d.order_id = o.id)),
  (SELECT count(*) FROM _carrier_0041 c JOIN orders o ON o.id = c.order_id WHERE o.driver_id IS NOT NULL),
  (SELECT count(*) FROM (SELECT 1 FROM _carrier_0041 GROUP BY company_id, parcel_id HAVING count(*) > 1))
    + (SELECT count(*) FROM _carrier_0041 c WHERE EXISTS (SELECT 1 FROM shipments s WHERE s.company_id = c.company_id AND s.carrier_parcel_id = c.parcel_id)),
  (SELECT count(*) FROM orders o
    WHERE (o.cod_payment_id IS NOT NULL OR o.fee_payment_id IS NOT NULL)
      AND (o.status <> 'delivered'
        OR NOT EXISTS (SELECT 1 FROM _driver_0041 d WHERE d.order_id = o.id)
        OR (o.cod_payment_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM driver_payments p WHERE p.id = o.cod_payment_id AND p.driver_id = o.driver_id))
        OR (o.fee_payment_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM driver_payments p WHERE p.id = o.fee_payment_id AND p.driver_id = o.driver_id))));

-- ─── Shipments ───────────────────────────────────────────────────────────────

-- Carrier parcels. The cash to collect is what was sent: the price and the
-- delivery fee. A 'deferred' label was a marker, not a URL.
INSERT INTO shipments (
  id, order_id, kind, company_id, driver_id, handoff_state, carrier_parcel_id, tracking_number, carrier_data, label_url,
  delivery_type, station_code, cod_amount, driver_fee, weight, is_fragile,
  validated_at, out_for_delivery_at, delivered_at, returned_at, delivery_attempts, created_by, revision, created_at, updated_at
)
SELECT c.shipment_id, o.id, 'carrier', c.company_id, NULL, 'accepted', c.parcel_id, c.tracking_number,
  CASE WHEN c.parcel_id <> c.tracking_number THEN json_object('parcelId', c.parcel_id) END,
  CASE WHEN c.label_url IS NOT NULL AND c.label_url <> 'deferred' THEN c.label_url END,
  o.delivery_type, CASE WHEN o.delivery_type = 'stop_desk' THEN o.station_code END, o.price + o.delivery_fee, 0, o.weight, o.is_fragile,
  CASE WHEN c.validated THEN c.updated_at END,
  CASE WHEN o.status IN ('out_for_delivery', 'delivered', 'returned') THEN coalesce(
    (SELECT min(h.timestamp) FROM order_status_history h WHERE h.order_id = o.id AND h.status = 'out_for_delivery'),
    CASE WHEN o.status = 'out_for_delivery' THEN o.updated_at END) END,
  CASE WHEN o.status = 'delivered' THEN coalesce(
    (SELECT min(h.timestamp) FROM order_status_history h WHERE h.order_id = o.id AND h.status = 'delivered'), o.delivery_time, o.updated_at) END,
  CASE WHEN o.status = 'returned' THEN coalesce(
    (SELECT min(h.timestamp) FROM order_status_history h WHERE h.order_id = o.id AND h.status = 'returned'), o.updated_at) END,
  coalesce(o.delivery_attempts, 0), NULL, lower(hex(randomblob(16))), c.created_at, c.updated_at
FROM _carrier_0041 c JOIN orders o ON o.id = c.order_id;

-- The store's driver. The cash and fee are the order's, as the driver was
-- credited with them; the shipment began when the driver was assigned.
INSERT INTO shipments (
  id, order_id, kind, company_id, driver_id, handoff_state, carrier_parcel_id, tracking_number, carrier_data, label_url,
  delivery_type, station_code, cod_amount, driver_fee, weight, is_fragile,
  validated_at, out_for_delivery_at, delivered_at, returned_at, delivery_attempts, created_by, revision, created_at, updated_at
)
SELECT d.shipment_id, o.id, 'driver', NULL, o.driver_id, 'accepted', NULL, NULL, NULL, NULL,
  o.delivery_type, CASE WHEN o.delivery_type = 'stop_desk' THEN o.station_code END, o.cod_amount, o.driver_fee, o.weight, o.is_fragile,
  NULL,
  CASE WHEN o.status IN ('out_for_delivery', 'delivered', 'returned') THEN coalesce(
    (SELECT min(h.timestamp) FROM order_status_history h WHERE h.order_id = o.id AND h.status = 'out_for_delivery'),
    CASE WHEN o.status = 'out_for_delivery' THEN o.updated_at END) END,
  CASE WHEN o.status = 'delivered' THEN coalesce(
    (SELECT min(h.timestamp) FROM order_status_history h WHERE h.order_id = o.id AND h.status = 'delivered'), o.delivery_time, o.updated_at) END,
  CASE WHEN o.status = 'returned' THEN coalesce(
    (SELECT min(h.timestamp) FROM order_status_history h WHERE h.order_id = o.id AND h.status = 'returned'), o.updated_at) END,
  coalesce(o.delivery_attempts, 0), o.assigned_by, lower(hex(randomblob(16))),
  coalesce(o.assigned_at, (SELECT min(h.timestamp) FROM order_status_history h WHERE h.order_id = o.id AND h.status = 'assigned'), o.updated_at),
  o.updated_at
FROM _driver_0041 d JOIN orders o ON o.id = d.order_id;

CREATE TABLE _moved_0041 AS
SELECT order_id, shipment_id FROM _carrier_0041
UNION ALL
SELECT order_id, shipment_id FROM _driver_0041;

-- ─── Settlement ──────────────────────────────────────────────────────────────

INSERT INTO driver_payment_lines (id, payment_id, shipment_id, component, amount)
SELECT lower(hex(randomblob(16))), o.cod_payment_id, d.shipment_id, 'cod', o.cod_amount
FROM _driver_0041 d JOIN orders o ON o.id = d.order_id
WHERE o.cod_payment_id IS NOT NULL;

INSERT INTO driver_payment_lines (id, payment_id, shipment_id, component, amount)
SELECT lower(hex(randomblob(16))), o.fee_payment_id, d.shipment_id, 'fee', o.driver_fee
FROM _driver_0041 d JOIN orders o ON o.id = d.order_id
WHERE o.fee_payment_id IS NOT NULL;

-- ─── History ─────────────────────────────────────────────────────────────────

-- The order's delivery steps, as legacy events of its shipment.
INSERT INTO shipment_events (id, shipment_id, source, event_key, vocabulary, provider_status, interpretation, milestone, attention, occurred_at, recorded_at, actor_id)
SELECT lower(hex(randomblob(16))), m.shipment_id, 'legacy', 'legacy:' || h.id, 'legacy', h.status,
  CASE WHEN h.status IN ('out_for_delivery', 'delivered', 'returned') THEN 'milestone' ELSE 'progress' END,
  CASE WHEN h.status IN ('out_for_delivery', 'delivered', 'returned') THEN h.status END,
  0, h.timestamp, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), h.by
FROM order_status_history h JOIN _moved_0041 m ON m.order_id = h.order_id
WHERE h.status IN ('assigned', 'dispatched', 'out_for_delivery', 'delivered', 'returned');

-- The carriers' webhook reports, as reported (not interpreted again), keyed
-- like the events the adapters record so a later sync adds no duplicate.
CREATE TABLE _reports_0041 AS
SELECT w.id AS webhook_event_id, m.shipment_id, w.reason, w.raw_payload,
  CASE w.provider WHEN 'yalidine' THEN 'status' ELSE CASE w.event_type WHEN 'parcel.state.situation.created' THEN 'situation' ELSE 'state' END END AS vocabulary,
  CASE w.provider
    WHEN 'yalidine' THEN json_extract(w.raw_payload, '$.event.data.status')
    ELSE CASE w.event_type
      WHEN 'parcel.state.situation.created' THEN json_extract(w.raw_payload, '$.data.situation.name')
      ELSE json_extract(w.raw_payload, '$.data.state.name') END
  END AS status,
  CASE w.provider WHEN 'yalidine' THEN json_extract(w.raw_payload, '$.event.occurred_at') ELSE json_extract(w.raw_payload, '$.occurredAt') END AS reported_at
FROM webhook_events w JOIN _moved_0041 m ON m.order_id = w.order_id
WHERE json_valid(w.raw_payload)
  AND ((w.provider = 'yalidine' AND w.event_type = 'parcel_status_updated')
    OR (w.provider = 'zr_express' AND w.event_type IN ('parcel.state.updated', 'parcel.state.situation.created')));

-- Carriers write Algiers wall-clock time (UTC+1, no daylight saving) unless a zone is given.
CREATE TABLE _report_times_0041 AS
SELECT r.*,
  CASE WHEN r.reported_at GLOB '*Z' OR r.reported_at GLOB '*[+-][0-9][0-9]:[0-9][0-9]'
    THEN strftime('%Y-%m-%dT%H:%M:%fZ', r.reported_at)
    ELSE strftime('%Y-%m-%dT%H:%M:%fZ', r.reported_at, '-1 hours') END AS occurred_at
FROM _reports_0041 r
WHERE r.status IS NOT NULL AND trim(r.status) <> '';

INSERT OR IGNORE INTO shipment_events (id, shipment_id, source, event_key, vocabulary, provider_status, interpretation, milestone, attention, reason, occurred_at, recorded_at, webhook_event_id, raw)
SELECT lower(hex(randomblob(16))), t.shipment_id, 'webhook', t.vocabulary || ':' || t.status || '@' || t.occurred_at, t.vocabulary, t.status, NULL, NULL, 0, t.reason,
  t.occurred_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), t.webhook_event_id, t.raw_payload
FROM _report_times_0041 t
WHERE t.occurred_at IS NOT NULL;

UPDATE webhook_events
SET shipment_id = (SELECT m.shipment_id FROM _moved_0041 m WHERE m.order_id = webhook_events.order_id)
WHERE order_id IN (SELECT order_id FROM _moved_0041);

-- Each moved shipment's provider status is its newest reported one.
UPDATE shipments
SET provider_status = (SELECT e.provider_status FROM shipment_events e WHERE e.shipment_id = shipments.id ORDER BY e.occurred_at DESC, e.source = 'webhook' DESC LIMIT 1),
  provider_status_kind = (SELECT coalesce(e.interpretation, 'unknown') FROM shipment_events e WHERE e.shipment_id = shipments.id ORDER BY e.occurred_at DESC, e.source = 'webhook' DESC LIMIT 1),
  provider_status_at = (SELECT e.occurred_at FROM shipment_events e WHERE e.shipment_id = shipments.id ORDER BY e.occurred_at DESC, e.source = 'webhook' DESC LIMIT 1)
WHERE id IN (SELECT shipment_id FROM _moved_0041)
  AND EXISTS (SELECT 1 FROM shipment_events e WHERE e.shipment_id = shipments.id);

-- ─── What does not move ──────────────────────────────────────────────────────

-- Earlier carrier attempts, and every parcel or driver of a cancelled order:
-- voided, kept in the activity log.
INSERT INTO activity_logs (id, actor_id, actor_name, actor_role, action, entity_type, entity_id, entity_label, metadata, created_at)
SELECT lower(hex(randomblob(16))), 'system', 'Migration 0041', 'admin', 'shipment.voided', 'order', o.id, o.order_number,
  json_object('source', 'migration', 'kind', 'carrier', 'companyId', cs.company_id, 'trackingNumber', cs.tracking_number),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM company_shipments cs JOIN orders o ON o.id = cs.order_id
WHERE NOT EXISTS (SELECT 1 FROM _carrier_0041 c WHERE c.shipment_id = cs.id)
  AND NOT EXISTS (SELECT 1 FROM shipments s WHERE s.id = cs.id);

INSERT INTO activity_logs (id, actor_id, actor_name, actor_role, action, entity_type, entity_id, entity_label, metadata, created_at)
SELECT lower(hex(randomblob(16))), 'system', 'Migration 0041', 'admin', 'shipment.voided', 'order', o.id, o.order_number,
  json_object('source', 'migration', 'kind', 'driver', 'driverId', o.driver_id),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM orders o
WHERE o.driver_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM _driver_0041 d WHERE d.order_id = o.id)
  AND NOT EXISTS (SELECT 1 FROM _carrier_0041 c WHERE c.order_id = o.id);

-- ─── Orders ──────────────────────────────────────────────────────────────────

-- Delivery is the shipment's: an order that went to delivery is `ready`.
UPDATE orders SET status = 'ready'
WHERE status IN ('assigned', 'dispatched', 'out_for_delivery', 'delivered', 'returned')
   OR id IN (SELECT order_id FROM _moved_0041);

DELETE FROM order_status_history WHERE status IN ('assigned', 'dispatched', 'out_for_delivery', 'delivered', 'returned');

-- ─── Companies ───────────────────────────────────────────────────────────────

-- ZR Express: the tenant's state names, from the old order-status keys to the
-- meanings the adapter reads (provider_config.statusMap). A key that was a
-- delivery outcome keeps it; every other one only moved a parcel along.
UPDATE delivery_companies
SET provider_config = json_set(coalesce(CASE WHEN json_valid(provider_config) THEN provider_config END, '{}'), '$.statusMap', json((
  SELECT json_group_object(meaning, json(names)) FROM (
    SELECT meaning, json_group_array(name) AS names FROM (
      SELECT CASE WHEN m.key IN ('delivered', 'returned', 'out_for_delivery', 'cancelled') THEN m.key ELSE 'progress' END AS meaning, trim(n.value) AS name
      FROM json_each(delivery_companies.webhook_status_mapping) m, json_each(m.value) n
      WHERE m.type = 'array' AND n.type = 'text' AND trim(n.value) <> ''
    ) GROUP BY meaning
  )
)))
WHERE provider = 'zr_express'
  AND json_valid(webhook_status_mapping)
  AND json_type(webhook_status_mapping) = 'object'
  AND EXISTS (
    SELECT 1 FROM json_each(delivery_companies.webhook_status_mapping) m, json_each(m.value) n
    WHERE m.type = 'array' AND n.type = 'text' AND trim(n.value) <> ''
  );

-- ─── The old columns and tables go ───────────────────────────────────────────

DROP TABLE _report_times_0041;
DROP TABLE _reports_0041;
DROP TABLE _moved_0041;
DROP TABLE _driver_0041;
DROP TABLE _carrier_0041;
DROP TABLE _guard_0041;

DROP INDEX IF EXISTS idx_orders_tracking;
DROP INDEX IF EXISTS idx_orders_driver;
DROP INDEX IF EXISTS idx_orders_company;
DROP INDEX IF EXISTS idx_orders_active;

UPDATE orders SET driver_id = NULL, company_id = NULL WHERE driver_id IS NOT NULL OR company_id IS NOT NULL;
UPDATE webhook_events SET order_id = NULL WHERE order_id IS NOT NULL;

ALTER TABLE orders DROP COLUMN delivery_method;
ALTER TABLE orders DROP COLUMN assigned_at;
ALTER TABLE orders DROP COLUMN assigned_by;
ALTER TABLE orders DROP COLUMN assignment_notes;
ALTER TABLE orders DROP COLUMN tracking_number;
ALTER TABLE orders DROP COLUMN tracking_url;
ALTER TABLE orders DROP COLUMN external_order_id;
ALTER TABLE orders DROP COLUMN driver_fee;
ALTER TABLE orders DROP COLUMN weight;
ALTER TABLE orders DROP COLUMN is_fragile;
ALTER TABLE orders DROP COLUMN pickup_time;
ALTER TABLE orders DROP COLUMN delivery_time;
ALTER TABLE orders DROP COLUMN delivery_attempts;
ALTER TABLE orders DROP COLUMN photos;
ALTER TABLE orders DROP COLUMN cod_payment_id;
ALTER TABLE orders DROP COLUMN fee_payment_id;

ALTER TABLE webhook_events DROP COLUMN new_status;

ALTER TABLE delivery_companies DROP COLUMN supports_tracking;
ALTER TABLE delivery_companies DROP COLUMN webhook_status_mapping;

DROP TABLE company_shipments;
DROP TABLE order_assignments;
