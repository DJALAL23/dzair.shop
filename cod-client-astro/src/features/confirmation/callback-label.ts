import { useLocale, useT } from "@/i18n/react";
import { dayFromNow, storeClock } from "@/features/confirmation/model";

/** A callback's time as an agent reads it: today at 15:30, tomorrow at 10:00, or the day and time. */
export function useCallbackLabel() {
  const t = useT("confirmation");
  const locale = useLocale();
  return (at: string) => {
    const day = dayFromNow(at);
    if (day === "today") return t("order.today_at", { time: storeClock(at, locale) });
    if (day === "tomorrow") return t("order.tomorrow_at", { time: storeClock(at, locale) });
    return storeClock(at, locale, true);
  };
}
