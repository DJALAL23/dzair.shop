import { Card } from "@/components/ui";
import { StageBadge } from "@/features/orders/components/StageBadge";
import { formatDeliveryMoney } from "@/features/delivery/model";
import { useLocale, useT } from "@/i18n/react";
import type { DriverShipment } from "@/features/delivery/types";

/** The orders most recently given to the driver, where each stands, and the cash each carries. */
export function DriverShipmentsCard({ shipments }: { shipments: DriverShipment[] }) {
  const t = useT("delivery");
  const locale = useLocale();
  if (shipments.length === 0) return null;
  return (
    <Card title={t("driver_card.recent_shipments")}>
      <div className="divide-y divide-border rounded-lg border border-border">
        {shipments.map((shipment) => (
          <div key={shipment.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
            <div className="min-w-0">
              <a href={`/orders/${encodeURIComponent(shipment.orderId)}`} className="text-sm font-semibold text-link hover:underline">
                {shipment.orderNumber}
              </a>
              <p className="truncate text-xs text-muted-foreground">{shipment.customerName}</p>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium tabular-nums">{formatDeliveryMoney(shipment.codAmount, locale)}</span>
              <StageBadge stage={shipment.stage} />
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
