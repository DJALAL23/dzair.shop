-- Order Protection's lists read a page of attempts newest first: Activity
-- across every outcome, the Spam page and Activity's filter within one. With
-- only (outcome, created_at), Activity read every attempt of the last 60 days
-- and sorted them for each page, and a page within an outcome sorted its ties
-- by id. Both now read their page in order from an index.
--
-- (outcome, created_at, id) also serves every read the two-column index
-- served, so that one goes. Additive for the data: an index writes no row and
-- changes no value.
CREATE INDEX order_attempts_recent ON order_attempts (created_at, id);
CREATE INDEX order_attempts_outcome_recent ON order_attempts (outcome, created_at, id);
DROP INDEX order_attempts_outcome;
