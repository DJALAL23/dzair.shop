-- The store's Meta conversions Consumer (plan, Phase 7): conversions move from
-- a Workflow started by each surface onto the delivery engine. One built-in
-- Consumer, subscribed to the four events a conversion can follow; whether it
-- sends is the store's tracking settings' to say, read at each delivery.
--
-- Created now, so it receives the events recorded from this release on — the
-- old Workflow already sent what came before, and capi_event_log keeps either
-- from sending a conversion twice.
--
-- Additive: one new row; no existing row or value changes.
INSERT OR IGNORE INTO event_consumers (id, kind, name, enabled, subscription, catalogue_version, settings, created_at, updated_at)
VALUES (
  'meta-conversions',
  'meta_capi',
  'Meta conversions',
  1,
  '["order.created","order.confirmed","shipment.out_for_delivery","shipment.delivered"]',
  1,
  '{}',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
);
