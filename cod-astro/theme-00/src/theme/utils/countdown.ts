/**
 * When a countdown ends, as an instant: the next midnight in Algeria, or the
 * end of a day the merchant typed (`YYYY-MM-DD`), Algiers time. Algeria keeps
 * UTC+1 all year. `null` for a date that is not one, or a moment already
 * past: an ended countdown shows nothing, never zeros.
 */
const ALGERIA_OFFSET_MS = 60 * 60 * 1000;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export type CountdownEnd = "midnight" | string;

export function countdownEnd(ends: CountdownEnd | undefined, now: number = Date.now()): number | null {
  if (ends === undefined || ends === "") return null;
  if (ends === "midnight") {
    const local = new Date(now + ALGERIA_OFFSET_MS);
    return Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + 1) - ALGERIA_OFFSET_MS;
  }
  const match = DATE.exec(ends.trim());
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const end = Date.UTC(year, month - 1, day + 1) - ALGERIA_OFFSET_MS;
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return end > now ? end : null;
}

/** The time left until `end`, in whole days, hours, minutes and seconds. */
export function timeLeft(end: number, now: number = Date.now()): { days: number; hours: number; minutes: number; seconds: number } {
  const total = Math.max(0, Math.floor((end - now) / 1000));
  return { days: Math.floor(total / 86400), hours: Math.floor((total % 86400) / 3600), minutes: Math.floor((total % 3600) / 60), seconds: total % 60 };
}
