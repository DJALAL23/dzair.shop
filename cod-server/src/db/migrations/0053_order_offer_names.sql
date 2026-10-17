-- An order keeps the name of each offer it was given, as the offer was named
-- when the order was placed: order_products.offer_name beside offer_id, and
-- orders.delivery_offer_name beside delivery_offer_id. The ids still point at
-- the offer while it exists; the names stay when it is renamed or deleted, so
-- the merchant always reads which offer shaped a line or made delivery free.
--
-- Orders placed before this take the current name of an offer that still
-- exists; a line whose offer was already deleted has no name to recover.

ALTER TABLE order_products ADD COLUMN offer_name text;
ALTER TABLE orders ADD COLUMN delivery_offer_name text;

UPDATE order_products
SET offer_name = (SELECT name FROM offers WHERE offers.id = order_products.offer_id)
WHERE offer_id IS NOT NULL;

UPDATE orders
SET delivery_offer_name = (SELECT name FROM offers WHERE offers.id = orders.delivery_offer_id)
WHERE delivery_offer_id IS NOT NULL;
