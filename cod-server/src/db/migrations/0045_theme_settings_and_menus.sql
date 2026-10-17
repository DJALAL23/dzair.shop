-- A store's theme settings, and its navigation menus.
--
-- store_theme_settings holds the merchant's values for the settings a theme
-- declares (`@wocart/theme` ThemeDefinition.settings), one row per theme: a
-- value is only meaningful against the theme that declared it, as a text
-- edit is (store_content_overrides). Written by CodFlow Cloud; this
-- repository only reads it (/store/config, for the requesting theme).
--
-- store_menus / store_menu_items are store data, like products: a menu is a
-- handle ("main-menu"), a title and up to three levels of items. An item
-- points at a page type of the storefront (a product, a category, a store
-- page, a landing page, the home or the catalog) or at a URL; a theme reads
-- a menu by handle and never builds the links itself. Items go with their
-- menu, children with their parent; an item's translated labels go with it
-- (trigger, like every translatable resource since 0037).

CREATE TABLE store_theme_settings (
  store_id text NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  theme_key text NOT NULL,
  "values" text NOT NULL CHECK (json_valid("values") AND json_type("values") = 'object'),
  updated_at text NOT NULL,
  PRIMARY KEY (store_id, theme_key)
);

CREATE TABLE store_menus (
  id text PRIMARY KEY NOT NULL,
  store_id text NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  handle text NOT NULL CHECK (length(handle) BETWEEN 1 AND 64 AND handle NOT GLOB '*[^a-z0-9-]*' AND substr(handle, 1, 1) <> '-'),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 100),
  created_at text NOT NULL,
  updated_at text NOT NULL
);

CREATE UNIQUE INDEX idx_store_menus_handle ON store_menus (store_id, handle);

CREATE TABLE store_menu_items (
  id text PRIMARY KEY NOT NULL,
  menu_id text NOT NULL REFERENCES store_menus(id) ON DELETE CASCADE,
  parent_id text REFERENCES store_menu_items(id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0,
  label text NOT NULL CHECK (length(label) BETWEEN 1 AND 100),
  destination_type text NOT NULL CHECK (destination_type IN ('home', 'catalog', 'category', 'product', 'page', 'landing', 'url')),
  destination_ref text,
  url text,
  created_at text NOT NULL,
  updated_at text NOT NULL,
  CHECK ((destination_type = 'url') = (url IS NOT NULL)),
  CHECK ((destination_type IN ('category', 'product', 'page', 'landing')) = (destination_ref IS NOT NULL))
);

CREATE INDEX idx_store_menu_items_menu ON store_menu_items (menu_id, parent_id, position);
CREATE INDEX idx_store_menu_items_parent ON store_menu_items (parent_id) WHERE parent_id IS NOT NULL;

CREATE TRIGGER translations_menu_item_deleted AFTER DELETE ON store_menu_items BEGIN DELETE FROM translations WHERE resource_type = 'menuItem' AND resource_id = OLD.id; END;
