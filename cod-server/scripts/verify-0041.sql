-- Read-only. Run after migration 0041 (the order / shipment split) and
-- compare with the preflight-0041.sql output kept from before it.
-- Local:  npx wrangler d1 execute <DB> --local --persist-to ../.wrangler-shared --file scripts/verify-0041.sql
-- Remote: npx wrangler d1 execute <DB> --remote --file scripts/verify-0041.sql

-- Only the order statuses remain (each count is 0).
SELECT 'orders_in_an_old_status' AS check_name, NULL AS k, count(*) AS n
FROM orders WHERE status NOT IN ('new', 'confirmed', 'unreachable', 'preparing', 'ready', 'cancelled');

SELECT 'history_in_an_old_status' AS check_name, NULL AS k, count(*) AS n
FROM order_status_history WHERE status NOT IN ('new', 'confirmed', 'unreachable', 'preparing', 'ready', 'cancelled');

-- Every shipment's order is ready (0).
SELECT 'shipments_of_orders_not_ready' AS check_name, NULL AS k, count(*) AS n
FROM shipments s JOIN orders o ON o.id = s.order_id WHERE o.status <> 'ready';

-- The shipments moved — compare with carrier_ / driver_shipments_to_create.
SELECT 'shipments_by_kind' AS check_name, kind AS k, count(*) AS n FROM shipments GROUP BY kind;

-- Every settlement link moved — compare with settlement_links.
SELECT 'settlement_lines' AS check_name, NULL AS k, count(*) AS n FROM driver_payment_lines;

-- Each driver's cash drift, read as the API reads it — the same as before.
SELECT 'driver_cash_drift' AS check_name, d.id AS k,
       d.pending_cash - coalesce((SELECT sum(s.cod_amount) FROM shipments s
         WHERE s.kind = 'driver' AND s.driver_id = d.id AND s.delivered_at IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM driver_payment_lines l WHERE l.shipment_id = s.id AND l.component = 'cod')), 0) AS n
FROM drivers d;

-- The columns a FOREIGN KEY clause keeps are empty (0).
SELECT 'emptied_columns_holding_a_value' AS check_name, NULL AS k,
       (SELECT count(*) FROM orders WHERE driver_id IS NOT NULL OR company_id IS NOT NULL)
       + (SELECT count(*) FROM webhook_events WHERE order_id IS NOT NULL) AS n;

-- Events moved, by where they came from.
SELECT 'shipment_events_by_source' AS check_name, source AS k, count(*) AS n FROM shipment_events GROUP BY source;

-- ZR state names now in the settings — compare with zr_companies_with_a_mapping.
SELECT 'zr_companies_with_a_status_map' AS check_name, code AS k, 1 AS n
FROM delivery_companies WHERE provider = 'zr_express' AND json_valid(provider_config) AND json_extract(provider_config, '$.statusMap') IS NOT NULL;
