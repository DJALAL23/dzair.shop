-- Attribution v2 (ADR 0026): every order says where it came from. `channel`
-- is the credited ad's channel, else this visit's, else the staff surface
-- that entered the order; the `visit_*` columns describe the shopper's latest
-- arrival before ordering (an ad or not, direct included), kept apart from
-- the credited ad.
--
-- Additive: new nullable columns and an index. No row is written or
-- changed; rows written before keep null and are read by the same rules.
ALTER TABLE order_attribution ADD COLUMN channel TEXT;
ALTER TABLE order_attribution ADD COLUMN visit_at TEXT;
ALTER TABLE order_attribution ADD COLUMN visit_channel TEXT;
ALTER TABLE order_attribution ADD COLUMN visit_platform TEXT;
ALTER TABLE order_attribution ADD COLUMN visit_site_source TEXT;
ALTER TABLE order_attribution ADD COLUMN visit_referrer_host TEXT;
ALTER TABLE order_attribution ADD COLUMN visit_landing_path TEXT;
ALTER TABLE order_attribution ADD COLUMN visit_landing_page_type TEXT;
ALTER TABLE order_attribution ADD COLUMN visit_utm_source TEXT;
ALTER TABLE order_attribution ADD COLUMN visit_utm_medium TEXT;
ALTER TABLE order_attribution ADD COLUMN visit_utm_campaign TEXT;
CREATE INDEX order_attribution_channel_idx ON order_attribution (channel);
