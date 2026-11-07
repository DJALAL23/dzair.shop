-- A customer's totals are read from their orders (cod-shared/queries/
-- customers.ts, customerTotals): how many they placed, what their delivered
-- orders' goods were worth net of units refused at the door, and when they
-- last ordered. The three running counters each writer adjusted drift from
-- the orders they summarise, and total_spent counted orders never delivered.
--
-- data-safety: customers.total_orders — a running count of the customer's orders, now counted from them
-- data-safety: customers.total_spent — a running sum that counted undelivered orders, now summed from delivered ones
-- data-safety: customers.last_order_at — the newest order's time, now read from the orders
ALTER TABLE customers DROP COLUMN total_orders;
ALTER TABLE customers DROP COLUMN total_spent;
ALTER TABLE customers DROP COLUMN last_order_at;
