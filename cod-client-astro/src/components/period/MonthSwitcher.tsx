import { ChevronLeft, ChevronRight } from "lucide-react";
import { useLocale, useT } from "@/i18n/react";
import { Button, IconButton } from "@/components/ui";
import { formatMonth, shiftMonth, storeMonth } from "@/lib/store-time";

/** A month to look at (YYYY-MM): back and forth, never past the store's current month, and back to it in one tap. */
export function MonthSwitcher({ month, onChange }: { month: string; onChange: (month: string) => void }) {
  const t = useT("common");
  const locale = useLocale();
  const thisMonth = storeMonth();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1 rounded-xl bg-card p-1 shadow-card">
        <IconButton type="button" onClick={() => onChange(shiftMonth(month, -1))} aria-label={t("month.previous")}>
          <ChevronLeft size={16} className="rtl:rotate-180" aria-hidden="true" />
        </IconButton>
        <span className="min-w-36 text-center text-sm font-semibold capitalize text-foreground" aria-live="polite">
          {formatMonth(month, locale)}
        </span>
        <IconButton type="button" disabled={month >= thisMonth} onClick={() => onChange(shiftMonth(month, 1))} aria-label={t("month.next")}>
          <ChevronRight size={16} className="rtl:rotate-180" aria-hidden="true" />
        </IconButton>
      </div>
      {month !== thisMonth && (
        <Button type="button" variant="ghost" size="sm" onClick={() => onChange(thisMonth)}>
          {t("month.this")}
        </Button>
      )}
    </div>
  );
}
