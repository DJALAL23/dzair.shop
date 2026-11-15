-- Calls without an answer: the confirmation team calls a customer once,
-- twice, three times, and the order reads Call 1, Call 2, Call 3. Each
-- "No answer" counts one; a callback, a confirmation or a cancellation
-- leaves the count as it is.
--
-- Additive. The count lives on the order, like decided_at, because the Event
-- Log is pruned after 90 days and the team's results must not change when it
-- is. It is filled here once from the no-answer moves the log still keeps;
-- an order on no answer now has had at least one call.
ALTER TABLE orders ADD COLUMN unanswered_calls INTEGER NOT NULL DEFAULT 0;

-- data-safety: orders.unanswered_calls — a new column, filled with the order's order.unreachable events, at least 1 for an order on no answer now
UPDATE orders SET unanswered_calls = max(CASE WHEN status = 'unreachable' THEN 1 ELSE 0 END, (SELECT count(*) FROM business_events e WHERE e.order_id = orders.id AND e.type = 'order.unreachable')) WHERE status = 'unreachable' OR EXISTS (SELECT 1 FROM business_events e WHERE e.order_id = orders.id AND e.type = 'order.unreachable');
