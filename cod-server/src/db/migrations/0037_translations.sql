-- Translations of merchant data (ADR 0005, phase C).
--
-- translations: one row per resource, language and key — Shopify's
--   Translations API model. resource_type names an entry of TRANSLATABLE
--   (cod-shared/i18n/translations.ts): product, category, offer, store. The
--   resource's own column stays the primary-language source; a translation
--   exists only for the store's other languages. source_digest is the SHA-256
--   of the source text the translation was written against, so an editor can
--   flag it outdated once the source changes.
--
-- One polymorphic table rather than one per resource: one write path, one
-- read overlay and one editor for every translatable field, and a new
-- translatable field needs no migration. The price is that a foreign key
-- cannot cascade, so the triggers below do it. Each trigger is one line: the
-- statement splitters used by the test harness split on ";" + newline.
CREATE TABLE translations (
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  locale TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  source_digest TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (resource_type, resource_id, locale, key)
);

CREATE TRIGGER translations_product_deleted AFTER DELETE ON products BEGIN DELETE FROM translations WHERE resource_type = 'product' AND resource_id = OLD.id; END;
CREATE TRIGGER translations_category_deleted AFTER DELETE ON product_categories BEGIN DELETE FROM translations WHERE resource_type = 'category' AND resource_id = OLD.id; END;
CREATE TRIGGER translations_offer_deleted AFTER DELETE ON offers BEGIN DELETE FROM translations WHERE resource_type = 'offer' AND resource_id = OLD.id; END;
CREATE TRIGGER translations_store_deleted AFTER DELETE ON stores BEGIN DELETE FROM translations WHERE resource_type = 'store' AND resource_id = OLD.id; END;
CREATE TRIGGER translations_locale_removed AFTER DELETE ON store_locales BEGIN DELETE FROM translations WHERE locale = OLD.locale; END;
