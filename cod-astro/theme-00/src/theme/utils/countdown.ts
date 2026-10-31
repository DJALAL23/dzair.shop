/**
 * When a countdown ends, as an instant: the next midnight in Algeria, or a
 * day the merchant typed (`YYYY-MM-DD`) — at the end of that day, or at the
 * time they gave (`HH:MM`) — Algiers time. Algeria keeps UTC+1 all year.
 * `null` for a date or time that is not one, or a moment already past: an
 * ended countdown shows nothing, never zeros.
 */
const ALGERIA_OFFSET_MS = 60 * 60 * 1000;
const MOMENT = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/;
const TIME = /^(\d{1,2}):(\d{2})$/;

/** `midnight`, `YYYY-MM-DD` or `YYYY-MM-DDTHH:MM`. */
export type CountdownEnd = "midnight" | string;

/** What a countdown's fields say it counts to; undefined when it counts to nothing. */
export function countdownTarget(mode: string | undefined, endsOn: string | undefined, endsAt: string | undefined): CountdownEnd | undefined {
  if (mode === "midnight") return "midnight";
  if (mode !== "date" || !endsOn?.trim()) return undefined;
  const time = TIME.exec(endsAt?.trim() ?? "");
  return time ? `${endsOn.trim()}T${time[1]!.padStart(2, "0")}:${time[2]}` : endsOn.trim();
}

export function countdownEnd(ends: CountdownEnd | undefined, now: number = Date.now()): number | null {
  if (ends === undefined || ends === "") return null;
  if (ends === "midnight") {
    const local = new Date(now + ALGERIA_OFFSET_MS);
    return Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + 1) - ALGERIA_OFFSET_MS;
  }
  const match = MOMENT.exec(ends.trim());
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  let end = Date.UTC(year, month - 1, day + 1) - ALGERIA_OFFSET_MS;
  if (match[4] !== undefined) {
    const [hours, minutes] = [Number(match[4]), Number(match[5])];
    if (hours > 23 || minutes > 59) return null;
    end = Date.UTC(year, month - 1, day, hours, minutes) - ALGERIA_OFFSET_MS;
  }
  return end > now ? end : null;
}

/** The time left until `end`, in whole days, hours, minutes and seconds. */
export function timeLeft(end: number, now: number = Date.now()): { days: number; hours: number; minutes: number; seconds: number } {
  const total = Math.max(0, Math.floor((end - now) / 1000));
  return { days: Math.floor(total / 86400), hours: Math.floor((total % 86400) / 3600), minutes: Math.floor((total % 3600) / 60), seconds: total % 60 };
}
