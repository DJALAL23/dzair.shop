/**
 * The row of an `INSERT … SELECT`, complete and in table order.
 *
 * Drizzle requires an insert-select to name every column of the table in the
 * table's own order. Writing that list by hand is how a new column silently
 * shifts every value into the wrong place; this builds it from the table:
 * the values given, and for every other column its declared default, or NULL.
 */
import { getTableColumns, sql, type SQL } from "drizzle-orm";
import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";

type Value = SQL | SQLiteColumn;

export function insertSelectRow<T extends SQLiteTable>(
  table: T,
  values: Partial<Record<keyof T["_"]["columns"], Value>>,
): { [K in keyof T["_"]["columns"]]: SQL.Aliased | SQLiteColumn } {
  const row: Record<string, SQL.Aliased | SQLiteColumn> = {};
  for (const [key, column] of Object.entries(getTableColumns(table)) as Array<[string, SQLiteColumn]>) {
    const given = (values as Record<string, Value | undefined>)[key];
    if (given !== undefined) {
      row[key] = "getSQL" in given && !(given as SQLiteColumn).table ? (given as SQL).as(column.name) : (given as SQLiteColumn);
      continue;
    }
    const fallback = column.default;
    row[key] = (fallback === undefined || fallback === null ? sql`null` : sql`${fallback}`).as(column.name);
  }
  return row as { [K in keyof T["_"]["columns"]]: SQL.Aliased | SQLiteColumn };
}
