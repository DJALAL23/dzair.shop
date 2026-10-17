-- A menu item can point at a collection (`/collections/:handle`), as it can at
-- a category. The destination's CHECK names every allowed type, and SQLite
-- cannot change a CHECK in place: store_menu_items is rebuilt with the same
-- rows, the same ids — so translations keep their items — and the same
-- indexes and trigger. The trigger goes first: with foreign keys on, DROP
-- TABLE deletes every row before it drops the table, and the trigger would
-- delete every item's translations on the way.

PRAGMA defer_foreign_keys = true;

CREATE TABLE store_menu_items_next (
  id text PRIMARY KEY NOT NULL,
  menu_id text NOT NULL REFERENCES store_menus(id) ON DELETE CASCADE,
  parent_id text REFERENCES store_menu_items_next(id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0,
  label text NOT NULL CHECK (length(label) BETWEEN 1 AND 100),
  destination_type text NOT NULL CHECK (destination_type IN ('home', 'catalog', 'category', 'collection', 'product', 'page', 'landing', 'url')),
  destination_ref text,
  url text,
  created_at text NOT NULL,
  updated_at text NOT NULL,
  CHECK ((destination_type = 'url') = (url IS NOT NULL)),
  CHECK ((destination_type IN ('category', 'collection', 'product', 'page', 'landing')) = (destination_ref IS NOT NULL))
);

INSERT INTO store_menu_items_next (id, menu_id, parent_id, position, label, destination_type, destination_ref, url, created_at, updated_at)
SELECT id, menu_id, parent_id, position, label, destination_type, destination_ref, url, created_at, updated_at FROM store_menu_items;

DROP TRIGGER translations_menu_item_deleted;

DROP TABLE store_menu_items;

ALTER TABLE store_menu_items_next RENAME TO store_menu_items;

CREATE INDEX idx_store_menu_items_menu ON store_menu_items (menu_id, parent_id, position);
CREATE INDEX idx_store_menu_items_parent ON store_menu_items (parent_id) WHERE parent_id IS NOT NULL;

CREATE TRIGGER translations_menu_item_deleted AFTER DELETE ON store_menu_items BEGIN DELETE FROM translations WHERE resource_type = 'menuItem' AND resource_id = OLD.id; END;
