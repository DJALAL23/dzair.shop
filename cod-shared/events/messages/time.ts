/** An instant as Algeria's clock shows it, with its day, in a language's numbers. */
export function storeTime(numbers: string, at: string): string {
  return new Intl.DateTimeFormat(numbers, {
    timeZone: "Africa/Algiers",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(at));
}
