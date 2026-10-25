-- One checkout, one order (docs/events/PLAN.md, Phase 9). The storefront
-- stamps each checkout attempt with a key; a double click, a resubmitted form
-- or a retried request carries the same key and gets back the order it
-- already placed — never a second order, a second stock deduction, or a
-- second order.created for the merchant's and customer's notifications.
--
-- Null for every order placed before, by the dashboard or an AI agent, or by
-- a storefront without the key: the index covers only keyed orders.
--
-- Additive: a new nullable column and its index; no existing row or value
-- changes.
ALTER TABLE orders ADD COLUMN checkout_key TEXT;
CREATE UNIQUE INDEX orders_checkout_key ON orders (checkout_key) WHERE checkout_key IS NOT NULL;
