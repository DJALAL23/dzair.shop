-- 0064_drop_dashboard_brand.sql
-- Drop the dashboard_brand table.
--
-- The table held a brand name, logo, colour, title and favicon that no dashboard
-- or server ever displayed. The release before this one stopped reading it (the
-- image sweep no longer names it); this release drops it. No table references it,
-- so the drop removes nothing else.
--
-- Ships only in a release after the one that stops reading it: a store still on
-- the older server reads this table.

-- The drop is declared twice, because the guard reads two forms: `rebuild` for the
-- drop itself, and the plain table form for the rows it removes.
-- data-safety: rebuild dashboard_brand — the table is dropped: never read, its values were never shown, and no table references it
-- data-safety: dashboard_brand — the table's rows (the partner's brand values) are dropped with it; no merchant value is in them, and no screen ever showed them
DROP TABLE IF EXISTS dashboard_brand;
