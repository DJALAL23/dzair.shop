-- A landing page's own documents live and die with the page (ADR 0022).
--
-- CodFlow Cloud's editor stores a landing page's composition as the page
-- document `lp:<landing page id>`, one per theme, and drafts it as a draft
-- part of kind 'document' with that key. Deleting the page deletes them, as
-- 0054 deletes a removed language's draft text; and a document written for
-- a page that no longer exists (a draft published after the page was
-- deleted) is removed as it lands, so none outlives its page.
--
-- Additive: two triggers; no existing row or value changes.
CREATE TRIGGER landing_page_documents_removed AFTER DELETE ON landing_pages BEGIN DELETE FROM page_documents WHERE surface = 'lp:' || OLD.id; DELETE FROM theme_draft_parts WHERE kind = 'document' AND key = 'lp:' || OLD.id; END;

CREATE TRIGGER landing_page_documents_need_their_page AFTER INSERT ON page_documents WHEN NEW.surface GLOB 'lp:*' AND NOT EXISTS (SELECT 1 FROM landing_pages WHERE id = substr(NEW.surface, 4)) BEGIN DELETE FROM page_documents WHERE id = NEW.id; END;
