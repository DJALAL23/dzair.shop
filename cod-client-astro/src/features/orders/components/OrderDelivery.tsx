import { Building2, Truck } from "lucide-react";
import { useT } from "@/i18n/react";
import { deliveredBy } from "@/features/orders/model";
import type { OrderListItem } from "@/features/orders/types";

/** Who carries the order — a carrier with its tracking number, or the store's driver — or that it is not shipped yet. */
export function OrderDelivery({ order }: { order: Pick<OrderListItem, "shipmentKind" | "carrierName" | "driverName" | "trackingNumber"> }) {
  const t = useT("orders");
  const by = deliveredBy(order);
  if (!by) return <span className="text-xs text-muted-foreground">{t("table.not_shipped")}</span>;
  const Icon = by.kind === "carrier" ? Building2 : Truck;
  return (
    <span className="inline-flex max-w-48 flex-col text-xs font-medium text-foreground">
      <span className="inline-flex items-center gap-1.5 truncate">
        <Icon size={14} className="shrink-0 text-muted-foreground" />
        {by.name ?? t(by.kind === "carrier" ? "delivery.a_carrier" : "delivery.a_driver")}
      </span>
      {order.trackingNumber && (
        <span dir="ltr" className="ms-5 truncate font-mono text-[11px] text-muted-foreground">
          {order.trackingNumber}
        </span>
      )}
    </span>
  );
}
