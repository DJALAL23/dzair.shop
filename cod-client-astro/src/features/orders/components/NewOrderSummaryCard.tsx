import { Card } from "@/components/ui";
import { formatMoney } from "@/features/orders/model";
import { useT } from "@/i18n/react";
import type { Locale } from "@/i18n/config";

interface NewOrderSummaryCardProps {
  subtotal: number;
  deliveryFee: number;
  total: number;
  locale: Locale;
}

export function NewOrderSummaryCard({
  subtotal,
  deliveryFee,
  total,
  locale,
}: NewOrderSummaryCardProps) {
  const t = useT("orders");

  return (
    <Card title={t("form.summary_title")}>
      <div className="space-y-2.5">
        <div className="flex justify-between text-sm text-muted-foreground">
          <span>{t("form.products_section")}</span>
          <span className="tabular-nums">{formatMoney(subtotal, locale)}</span>
        </div>
        <div className="flex justify-between text-sm text-muted-foreground">
          <span>{t("form.delivery_fee_label")}</span>
          <span className="tabular-nums">{formatMoney(deliveryFee, locale)}</span>
        </div>
        <div className="flex items-end justify-between border-t border-border pt-3">
          <span className="text-sm font-semibold">
            {t("form.order_total")}
          </span>
          <span className="text-lg font-semibold tabular-nums">
            {formatMoney(total, locale)}
          </span>
        </div>
      </div>
    </Card>
  );
}
