-- Store languages and per-language storefront text (ADR 0005, phase B).
--
-- enabled_locales_json: the languages a store serves (JSON array). Every
-- existing store serves exactly its current language.
--
-- content_overrides_json: the store's text overrides, one map per language.
-- The old single-language content_json blob is carried over under the store's
-- current language when it is a JSON object (the only shape any reader ever
-- honoured), then dropped, so there is one source of truth.
ALTER TABLE stores ADD COLUMN enabled_locales_json TEXT;
ALTER TABLE stores ADD COLUMN content_overrides_json TEXT;
UPDATE stores SET enabled_locales_json = json_array(lang);
UPDATE stores SET content_overrides_json = json_object(lang, json(content_json)) WHERE content_json IS NOT NULL AND json_valid(content_json) AND json_type(content_json) = 'object';
ALTER TABLE stores DROP COLUMN content_json;
