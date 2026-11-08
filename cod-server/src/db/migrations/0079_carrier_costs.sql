-- Carrier costs (ADR 0024): what a delivery company charges the store.
--   * carrier_places holds the company's rate and return fee for each commune,
--     read from its API with the rest of its map of places;
--   * a carrier shipment freezes its Shipping Cost and Return Fee at handoff,
--     so a later change of rates never rewrites what a past parcel cost.
-- Additive: new nullable columns only. A shipment handed off before it has
-- no recorded cost.
ALTER TABLE carrier_places ADD COLUMN home_rate REAL;
ALTER TABLE carrier_places ADD COLUMN stop_desk_rate REAL;
ALTER TABLE carrier_places ADD COLUMN home_return_fee REAL;
ALTER TABLE carrier_places ADD COLUMN stop_desk_return_fee REAL;
ALTER TABLE shipments ADD COLUMN shipping_cost REAL;
ALTER TABLE shipments ADD COLUMN return_fee REAL;
