-- An order's processing timeline is its Business Events (order.created,
-- order.confirmed, …), which carry who did it and when, frozen as it was.
-- order_status_history kept a second copy of the same facts, and the status
-- change used its row as the claim that applies the change's effects once.
-- The claim moves to the order itself, the pattern shipments use: a fresh
-- random revision written by each status change, which every other statement
-- of that batch checks.
--
-- business_events gets the index an order's timeline reads by.

ALTER TABLE orders ADD COLUMN revision TEXT;
CREATE INDEX business_events_order ON business_events (order_id, seq);

-- data-safety: rebuild order_status_history — the table is dropped: its rows repeat the orders' Business Events, and no table references it
-- data-safety: order_status_history — its rows are dropped with it; the timeline reads the Event Log
DROP TABLE order_status_history;
