-- The announcement bar is a theme's own content, not store data: a theme that
-- has one declares it among its settings (`@wocart/theme`), and the merchant
-- edits it in the theme editor. stores.announcement_bar goes, with its
-- translations. /store/config still answers `announcementBar: null`, because
-- @wocart/storefront up to 1.7 requires the field.

DELETE FROM translations WHERE resource_type = 'store' AND key = 'announcementBar';

ALTER TABLE stores DROP COLUMN announcement_bar;
