-- Carrier provider and typed settings (ADR 0006, plan stage 3a).
--
-- provider: which carrier adapter serves the company (yalidine, zr_express,
--   noest, ecotrack). A company row is one instance of one provider: every
--   EcoTrack-platform company is `ecotrack`; Guepex runs on the Yalidine
--   platform. Until now this was guessed from `code`.
-- provider_config: the adapter's own settings as JSON, validated by that
--   adapter's schema. Yalidine's settings move here out of free-text `notes`,
--   whose rewrite by the dashboard silently dropped the egress relay.
--
-- Columns are added, never rebuilt: rebuilding delivery_companies on D1
-- cascade-deletes company_stop_desks (ADR 0006).
ALTER TABLE delivery_companies ADD COLUMN provider TEXT;
ALTER TABLE delivery_companies ADD COLUMN provider_config TEXT;
UPDATE delivery_companies SET provider = CASE WHEN code IN ('yalidine', 'guepex') THEN 'yalidine' WHEN code = 'zr_express' THEN 'zr_express' WHEN code = 'noest' THEN 'noest' WHEN code = 'ecotrack' OR substr(code, -9) = '_ecotrack' THEN 'ecotrack' ELSE NULL END;
-- json_patch drops keys whose value is null, so absent notes keys stay absent.
UPDATE delivery_companies SET provider_config = json_patch(json_object('platform', CASE WHEN code = 'guepex' THEN 'guepex' ELSE 'yalidine' END), CASE WHEN json_valid(notes) AND json_type(notes) = 'object' THEN json_object('fromWilayaName', json_extract(notes, '$.from_wilaya_name'), 'proxyBaseUrl', json_extract(notes, '$.proxy_base_url'), 'proxySecret', json_extract(notes, '$.proxy_secret')) ELSE '{}' END) WHERE provider = 'yalidine';
UPDATE delivery_companies SET notes = NULLIF(json_remove(notes, '$.from_wilaya_name', '$.proxy_base_url', '$.proxy_secret'), '{}') WHERE provider = 'yalidine' AND json_valid(notes) AND json_type(notes) = 'object';
