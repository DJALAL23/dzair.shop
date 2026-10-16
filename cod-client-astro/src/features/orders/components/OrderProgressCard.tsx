import { Check } from "lucide-react";
import { useLocale, useT } from "@/i18n/react";
import { Card } from "@/components/ui";
import type { StatusHistoryItem } from "@/features/orders/types";

/** The order's processing as it happened: who confirmed, prepared or cancelled it, and when. */
export function OrderProgressCard({ history }: { history: StatusHistoryItem[] }) {
  const t = useT("orders");
  const locale = useLocale();
  const steps = [...history].sort((left, right) => right.timestamp.localeCompare(left.timestamp));
  return (
    <Card title={t("progress.title")}>
      {steps.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("progress.none")}</p>
      ) : (
        <ol className="space-y-3">
          {steps.map((step) => (
            <li key={step.id} className="flex items-start gap-3">
              <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
                <Check size={12} />
              </span>
              <div>
                <p className="text-sm font-medium">{t(`status.${step.status}`)}</p>
                <p className="text-xs text-muted-foreground">
                  {new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(step.timestamp))}
                  {step.byName ? ` · ${step.byName}` : ""}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
