-- The language an order was placed in (docs/events/PLAN.md, Phase 9): the
-- shopper's storefront language at checkout, the store's primary language for
-- an order the dashboard or an AI agent creates. Customer messages are
-- written in it, and the order's Business Events carry it.
--
-- Null for every order placed before: their language was never recorded, and
-- none is guessed for them.
--
-- Additive: a new nullable column; no existing row or value changes.
ALTER TABLE orders ADD COLUMN locale TEXT;
