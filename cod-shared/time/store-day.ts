/**
 * Store days: the calendar days of Algeria, which keeps UTC+1 all year. A
 * store day is written YYYY-MM-DD; the instants in the database are UTC.
 */
import { sql } from "drizzle-orm";

/** Algeria keeps UTC+1 all year: a store's day starts at 23:00 UTC the evening before. */
export const STORE_UTC_OFFSET_HOURS = 1;

const DAY_MS = 86_400_000;

/** The store day `days` after `day` (before it when negative). */
export function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** The store day after `day`. */
export function nextStoreDay(day: string): string {
  return addDays(day, 1);
}

/** The instant a store day starts. */
export function storeDayStart(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) - STORE_UTC_OFFSET_HOURS * 3_600_000).toISOString();
}

/** The store day an instant falls on. */
export function storeDayOf(instant: string): string {
  return new Date(Date.parse(instant) + STORE_UTC_OFFSET_HOURS * 3_600_000).toISOString().slice(0, 10);
}

/** The store day an instant column falls on, in SQL. Only for a column name written in code, never for input. */
export const storeDateOf = (column: string) => sql.raw(`date(${column}, '+${STORE_UTC_OFFSET_HOURS} hours')`);
