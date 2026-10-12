/**
 * "now", "3 minutes ago", "il y a 2 jours", "منذ 3 دقائق" — in the dashboard's
 * language, with that language's grammar, from the platform's own CLDR data
 * (`Intl.RelativeTimeFormat`) rather than translated templates. Past a month
 * it is a calendar date. Latin digits, as Algerian business text writes them.
 */
import type { Locale } from "@/i18n/config";

const UNITS: readonly [Intl.RelativeTimeFormatUnit, number][] = [
  ["second", 60],
  ["minute", 60],
  ["hour", 24],
  ["day", 30],
];

/** The calendar locale per dashboard language: Algerian formats, Latin digits. */
const DATE_LOCALES: Record<Locale, string> = { ar: "ar-DZ", fr: "fr-DZ", en: "en-GB" };

export function relativeTime(value: string | Date, locale: Locale, now: number = Date.now()): string {
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return "-";
  let amount = (then - now) / 1000;
  const format = new Intl.RelativeTimeFormat(locale, { numeric: "auto", numberingSystem: "latn" } as Intl.RelativeTimeFormatOptions);
  for (const [unit, size] of UNITS) {
    if (Math.abs(amount) < size) return format.format(unit === "second" ? 0 : Math.round(amount), unit);
    amount /= size;
  }
  return new Intl.DateTimeFormat(DATE_LOCALES[locale], {
    year: "numeric",
    month: "short",
    day: "numeric",
    numberingSystem: "latn",
  }).format(new Date(then));
}
