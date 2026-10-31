-- A customer's email: typed by the merchant on the customer, or taken from
-- the first order that brings one. Not unique: the phone stays what makes a
-- customer one person, and a family often shares an email. Lower-cased and
-- trimmed on the way in, like `orders.customer_email`.
--
-- Additive: a new nullable column; no existing row or value changes. Existing
-- customers start without one (the owner chose no backfill from their orders).
ALTER TABLE customers ADD COLUMN email text;
