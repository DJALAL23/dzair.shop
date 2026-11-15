/**
 * Store time as the dashboard shows it: days and months in Algeria's time
 * (UTC+1 all year, whatever the browser's clock says), written YYYY-MM-DD
 * and YYYY-MM, and named the way the merchant reads them.
 */

const ALGERIA_OFFSET_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** The store's calendar day (YYYY-MM-DD) at `now`. */
export function storeDay(now: Date = new Date()): string {
  return new Date(now.getTime() + ALGERIA_OFFSET_MS).toISOString().slice(0, 10);
}

export function shiftDay(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** The store's month (YYYY-MM) at `now`. */
export function storeMonth(now: Date = new Date()): string {
  return storeDay(now).slice(0, 7);
}

export function shiftMonth(month: string, months: number): string {
  const [year, index] = [Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + months];
  return new Date(Date.UTC(year, index, 1)).toISOString().slice(0, 7);
}

/** The first and last store days of a month (YYYY-MM). */
export function monthDays(month: string): { from: string; to: string } {
  return { from: `${month}-01`, to: shiftDay(`${shiftMonth(month, 1)}-01`, -1) };
}

export const intlLocale = (locale: string) => (locale === "ar" ? "ar-DZ" : `${locale}-DZ`);

/** A store day (YYYY-MM-DD) as the merchant reads it: 1 Nov 2026. */
export function formatStoreDay(day: string, locale: string): string {
  return new Intl.DateTimeFormat(intlLocale(locale), { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }).format(new Date(`${day}T00:00:00.000Z`));
}

/** A store day within a month the merchant already sees: 14 Nov. */
export function formatStoreDayShort(day: string, locale: string): string {
  return new Intl.DateTimeFormat(intlLocale(locale), { timeZone: "UTC", day: "numeric", month: "short" }).format(new Date(`${day}T00:00:00.000Z`));
}

/** A month (YYYY-MM) as the merchant reads it: November 2026. */
export function formatMonth(month: string, locale: string): string {
  return new Intl.DateTimeFormat(intlLocale(locale), { timeZone: "UTC", month: "long", year: "numeric" }).format(new Date(`${month}-01T00:00:00.000Z`));
}
