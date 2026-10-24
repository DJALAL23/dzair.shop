-- The store's own driver delivers to the customer's door: a driver is not a
-- carrier and has no stop desks. A driver shipment is therefore always home
-- delivery with no stop desk, and the database refuses any other — whatever
-- writes it — as it refuses removing a shipped order (0042). A customer who
-- chose a stop desk keeps that choice and its price on the order; the driver
-- brings the parcel to their address.
--
-- Only new writes are checked: a row recorded before keeps its values and
-- still records its delivery, since the update trigger fires only when the
-- kind, the delivery type or the stop desk is written.

CREATE TRIGGER shipments_driver_delivers_home_insert BEFORE INSERT ON shipments WHEN NEW.kind = 'driver' AND (NEW.delivery_type <> 'home' OR NEW.station_code IS NOT NULL) BEGIN SELECT RAISE(ABORT, 'DRIVER_DELIVERS_HOME'); END;
CREATE TRIGGER shipments_driver_delivers_home_update BEFORE UPDATE OF kind, delivery_type, station_code ON shipments WHEN NEW.kind = 'driver' AND (NEW.delivery_type <> 'home' OR NEW.station_code IS NOT NULL) BEGIN SELECT RAISE(ABORT, 'DRIVER_DELIVERS_HOME'); END;
