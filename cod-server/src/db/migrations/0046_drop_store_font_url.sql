-- stores.font_url held a Google Fonts URL that nothing ever read: a theme
-- self-hosts its fonts, and the font a store renders in is the theme's `font`
-- setting (store_theme_settings, migration 0045), else stores.font_family.
-- /store/config still answers `fontUrl: null`, because @wocart/storefront up
-- to 1.7 requires the field.

ALTER TABLE stores DROP COLUMN font_url;
