-- Read-only. Run before migration 0041 (the order / shipment split) to see
-- the data it will move, and keep the output: verify-0041.sql is checked
-- against it.
-- Local:  npx wrangler d1 execute <DB> --local --persist-to ../.wrangler-shared --file scripts/preflight-0041.sql
-- Remote: npx wrangler d1 execute <DB> --remote --file scripts/preflight-0041.sql

-- The migration's guard: each must be 0, or it stops with nothing changed.
-- Sent to delivery, but with neither its carrier parcel nor a driver.
SELECT 'guard_stranded_deliveries' AS check_name, NULL AS k, count(*) AS n
FROM orders o
WHERE o.status IN ('dispatched', 'out_for_delivery', 'delivered', 'returned')
  AND NOT EXISTS (SELECT 1 FROM shipments s WHERE s.order_id = o.id)
  AND NOT EXISTS (SELECT 1 FROM company_shipments c WHERE c.order_id = o.id AND c.tracking_number = o.tracking_number)
  AND NOT (o.driver_id IS NOT NULL AND o.status IN ('out_for_delivery', 'delivered', 'returned'));

-- A carrier parcel and a driver on the same order.
SELECT 'guard_driver_and_carrier' AS check_name, NULL AS k, count(*) AS n
FROM orders o
WHERE o.status <> 'cancelled' AND o.driver_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM company_shipments c WHERE c.order_id = o.id AND c.tracking_number = o.tracking_number);

-- The same tracking number at the same company for two orders.
SELECT 'guard_duplicate_parcels' AS check_name, c.company_id || ':' || c.tracking_number AS k, count(DISTINCT c.order_id) AS n
FROM company_shipments c JOIN orders o ON o.id = c.order_id AND o.tracking_number = c.tracking_number AND o.status <> 'cancelled'
GROUP BY c.company_id, c.tracking_number HAVING count(DISTINCT c.order_id) > 1;

-- A settlement link on an order that is not a delivery by that payment's driver.
SELECT 'guard_unmatched_settlements' AS check_name, NULL AS k, count(*) AS n
FROM orders o
WHERE (o.cod_payment_id IS NOT NULL OR o.fee_payment_id IS NOT NULL)
  AND (o.status <> 'delivered' OR o.driver_id IS NULL
    OR (o.cod_payment_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM driver_payments p WHERE p.id = o.cod_payment_id AND p.driver_id = o.driver_id))
    OR (o.fee_payment_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM driver_payments p WHERE p.id = o.fee_payment_id AND p.driver_id = o.driver_id)));

-- What it will move.
SELECT 'orders_by_status' AS check_name, status AS k, count(*) AS n FROM orders GROUP BY status;

SELECT 'carrier_shipments_to_create' AS check_name, NULL AS k, count(*) AS n
FROM orders o
WHERE o.status <> 'cancelled'
  AND NOT EXISTS (SELECT 1 FROM shipments s WHERE s.order_id = o.id)
  AND EXISTS (SELECT 1 FROM company_shipments c WHERE c.order_id = o.id AND c.tracking_number = o.tracking_number);

SELECT 'driver_shipments_to_create' AS check_name, NULL AS k, count(*) AS n
FROM orders o
WHERE o.driver_id IS NOT NULL AND o.status IN ('assigned', 'out_for_delivery', 'delivered', 'returned')
  AND NOT EXISTS (SELECT 1 FROM shipments s WHERE s.order_id = o.id)
  AND NOT EXISTS (SELECT 1 FROM company_shipments c WHERE c.order_id = o.id AND c.tracking_number = o.tracking_number);

SELECT 'settlement_links' AS check_name, NULL AS k, (SELECT count(*) FROM orders WHERE cod_payment_id IS NOT NULL) + (SELECT count(*) FROM orders WHERE fee_payment_id IS NOT NULL) AS n;

-- Kept across the migration: each driver's cash drift must read the same after.
SELECT 'driver_cash_drift' AS check_name, d.id AS k,
       d.pending_cash - coalesce((SELECT sum(o.cod_amount) FROM orders o
         WHERE o.driver_id = d.id AND o.status = 'delivered' AND o.cod_payment_id IS NULL), 0) AS n
FROM drivers d;

SELECT 'zr_companies_with_a_mapping' AS check_name, code AS k, 1 AS n
FROM delivery_companies WHERE provider = 'zr_express' AND webhook_status_mapping IS NOT NULL;
