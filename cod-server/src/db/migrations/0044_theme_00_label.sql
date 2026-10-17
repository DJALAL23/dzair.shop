-- The storefront theme is Theme-00; the first theme (theme01) was removed from
-- the repository. Stores still labelled with it take Theme-00's label.
--
-- The column's own default stays 'theme01' (migration 0000): SQLite changes a
-- default only by rebuilding the table, and stores has dependents (ADR 0006).
-- Every insert in the code names the theme (the Drizzle default is
-- 'theme-00'), so the column default is never used.

UPDATE stores SET theme_id = 'theme-00' WHERE theme_id = 'theme01';
