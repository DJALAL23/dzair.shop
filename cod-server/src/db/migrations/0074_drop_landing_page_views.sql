-- Landing pages carry no analytics of their own. landing_pages.views counted
-- the server's renders of a page, not its visits: the storefront caches a
-- landing page, so most visits never reached the counter, and every rate
-- built on it was wrong. The count is dropped with the code that wrote and
-- read it. An order still remembers the page it was placed from
-- (orders.landing_page_id); reporting reads that.
--
-- data-safety: landing_pages.views — a render count that was never a measure of visits; no screen, API or tool reads it any more
ALTER TABLE landing_pages DROP COLUMN views;
