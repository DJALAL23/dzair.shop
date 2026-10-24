-- Each driver's shipments, in the order they were given. The driver's page
-- reads them three ways — the recent deliveries (newest first), the cash
-- check (delivered, not yet handed over) and what is left to settle — and
-- each read scanned every shipment of the store: on D1, rows read are what
-- a query costs. Partial, like shipments_driver_open beside it: carrier
-- shipments have no driver and are not indexed.
--
-- Additive: an index writes no row and changes no value.
CREATE INDEX shipments_driver ON shipments (driver_id, created_at) WHERE driver_id IS NOT NULL;
