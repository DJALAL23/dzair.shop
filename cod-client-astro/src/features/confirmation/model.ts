/**
 * The confirmation team as the dashboard shows it: store days and months in
 * Algeria's time (UTC+1 all year, whatever the browser's clock says), the
 * quick callback times an agent picks from, and what a member's row warns.
 */

import { shiftDay, storeDay } from "@/lib/store-time";
import type { TeamMember } from "./types";

const ALGERIA_OFFSET_MS = 3_600_000;

export const RESULTS_PERIODS = ["today", "7d", "30d", "month"] as const;
export type ResultsPeriod = (typeof RESULTS_PERIODS)[number];

/** The store days a results period covers, both included. */
export function periodRange(period: ResultsPeriod, now: Date = new Date()): { from: string; to: string } {
  const today = storeDay(now);
  if (period === "today") return { from: today, to: today };
  if (period === "7d") return { from: shiftDay(today, -6), to: today };
  if (period === "30d") return { from: shiftDay(today, -29), to: today };
  return { from: `${today.slice(0, 7)}-01`, to: today };
}

/** The instant of a time of day on a store day, Algeria's time. */
export function storeInstant(day: string, time: string): string {
  return new Date(`${day}T${time}:00+01:00`).toISOString();
}

export type CallbackChoice = { key: "in_1h" | "this_evening" | "tomorrow_morning" | "tomorrow_afternoon"; at: string };

/**
 * The callback times an agent picks in one tap: in an hour (to the next five
 * minutes), this evening at 18:00 while it is before 17:00, and tomorrow at
 * 10:00 and at 15:00 — Algeria's time.
 */
export function callbackChoices(now: Date = new Date()): CallbackChoice[] {
  const inAnHour = new Date(Math.ceil((now.getTime() + 3_600_000) / 300_000) * 300_000).toISOString();
  const today = storeDay(now);
  const tomorrow = shiftDay(today, 1);
  const storeHour = new Date(now.getTime() + ALGERIA_OFFSET_MS).getUTCHours();
  return [
    { key: "in_1h", at: inAnHour },
    ...(storeHour < 17 ? [{ key: "this_evening" as const, at: storeInstant(today, "18:00") }] : []),
    { key: "tomorrow_morning", at: storeInstant(tomorrow, "10:00") },
    { key: "tomorrow_afternoon", at: storeInstant(tomorrow, "15:00") },
  ];
}

/** A callback's time against now: due (call now), later today, or another day. */
export function callbackState(at: string, now: Date = new Date()): "due" | "today" | "later" {
  if (Date.parse(at) <= now.getTime()) return "due";
  return storeDay(new Date(at)) === storeDay(now) ? "today" : "later";
}

/** The value a `datetime-local` input shows for an instant, in Algeria's time (`@/lib/datetime-local` uses the browser's clock). */
export function toStoreInput(at: string): string {
  return new Date(Date.parse(at) + ALGERIA_OFFSET_MS).toISOString().slice(0, 16);
}

/** The instant a `datetime-local` value names, read in Algeria's time; null when it is not one. */
export function fromStoreInput(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const at = Date.parse(`${value}:00+01:00`);
  return Number.isNaN(at) ? null : new Date(at).toISOString();
}

/** Which store day an instant falls on, seen from now: today, tomorrow, or another. */
export function dayFromNow(at: string, now: Date = new Date()): "today" | "tomorrow" | "other" {
  const day = storeDay(new Date(at));
  const today = storeDay(now);
  if (day === today) return "today";
  return day === shiftDay(today, 1) ? "tomorrow" : "other";
}

/** An instant as Algeria's clock shows it: the time, or the date and time. */
export function storeClock(at: string, locale: string, withDate = false): string {
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-DZ" : `${locale}-DZ`, {
    timeZone: "Africa/Algiers",
    ...(withDate ? { weekday: "short", day: "numeric", month: "short" } : {}),
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(at));
}

/** What a member's row warns about: an account that cannot sign in, or permissions that show them no order. */
export function memberWarning(member: Pick<TeamMember, "active" | "reach">): "inactive" | "no_access" | null {
  if (!member.active) return "inactive";
  return member.reach === "none" ? "no_access" : null;
}

/** Minutes as hours and minutes, for "1 h 05". */
export function splitMinutes(total: number): { hours: number; minutes: number } {
  return { hours: Math.floor(total / 60), minutes: total % 60 };
}

/** The day a pay rate starts: a salary on the first of its month, a commission on its day. */
export function payStart(kind: "salary" | "per_confirmed" | "per_delivered", day: string): string {
  return kind === "salary" ? `${day.slice(0, 7)}-01` : day;
}
