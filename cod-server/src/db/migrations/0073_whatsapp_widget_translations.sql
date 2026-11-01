-- The WhatsApp button App's texts are translated into the store's other
-- languages (resource `whatsappWidget`, keyed by the store's id). Translations
-- have no foreign keys (0037): a trigger deletes a resource's rows with it, as
-- 0037's do for the store's own texts.

CREATE TRIGGER translations_whatsapp_widget_deleted AFTER DELETE ON stores BEGIN DELETE FROM translations WHERE resource_type = 'whatsappWidget' AND resource_id = OLD.id; END;
