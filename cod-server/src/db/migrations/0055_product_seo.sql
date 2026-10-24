-- A product's own title and description for search engines and shared links,
-- as categories and store pages already have. Both start empty for every
-- product: a storefront falls back to the product's name and description, so
-- nothing a shopper or a search engine sees changes until the merchant writes
-- them. Their translations live in `translations` (resource `product`, keys
-- `metaTitle` and `metaDescription`).

ALTER TABLE products ADD COLUMN meta_title text;
ALTER TABLE products ADD COLUMN meta_description text;
