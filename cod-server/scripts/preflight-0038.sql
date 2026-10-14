-- Read-only. Run before migration 0038 to see the data it will convert.
-- Local:  npx wrangler d1 execute <DB> --local --persist-to ../.wrangler-shared --file scripts/preflight-0038.sql
-- Remote: npx wrangler d1 execute <DB> --remote --file scripts/preflight-0038.sql

SELECT 'orders_by_status' AS check_name, status AS k, count(*) AS n FROM orders GROUP BY status;

-- The 0038 guard aborts when this is not 0: delivered/returned/out-for-delivery
-- orders with neither a driver nor a carrier shipment have no truthful home.
SELECT 'guard_orphan_delivery_orders' AS check_name, NULL AS k, count(*) AS n
FROM orders o
WHERE o.status IN ('out_for_delivery', 'delivered', 'returned')
  AND o.driver_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM company_shipments s WHERE s.order_id = o.id AND s.tracking_number = o.tracking_number);

SELECT 'orders_with_several_carrier_rows' AS check_name, NULL AS k, count(*) AS n
FROM (SELECT order_id FROM company_shipments GROUP BY order_id HAVING count(*) > 1);

SELECT 'carrier_rows_not_matching_order_tracking' AS check_name, NULL AS k, count(*) AS n
FROM company_shipments s JOIN orders o ON o.id = s.order_id
WHERE o.tracking_number IS NULL OR o.tracking_number <> s.tracking_number;

SELECT 'orders_with_driver_and_tracking' AS check_name, NULL AS k, count(*) AS n
FROM orders WHERE driver_id IS NOT NULL AND tracking_number IS NOT NULL;

SELECT 'driver_cash_drift' AS check_name, d.id AS k,
       d.pending_cash - coalesce((SELECT sum(o.cod_amount) FROM orders o
         WHERE o.driver_id = d.id AND o.status = 'delivered' AND o.cod_payment_id IS NULL), 0) AS n
FROM drivers d;

SELECT 'companies' AS check_name, code AS k, (notes IS NOT NULL) + 2 * (webhook_status_mapping IS NOT NULL) AS n
FROM delivery_companies;

SELECT 'webhook_events_by_result' AS check_name, provider || ':' || result AS k, count(*) AS n
FROM webhook_events GROUP BY provider, result;
