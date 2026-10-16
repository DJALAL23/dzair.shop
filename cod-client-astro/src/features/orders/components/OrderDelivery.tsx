import { Building2, Truck } from "lucide-react";
import { useT } from "@/i18n/react";
import { CellEmpty } from "@/components/ui";
import { deliveredBy } from "@/features/orders/model";
import type { OrderListItem } from "@/features/orders/types";

/** Who carries the order — a carrier or the store's driver — on one line; a dash while nothing is shipped. */
export function OrderDelivery({ order }: { order: Pick<OrderListItem, "shipmentKind" | "carrierName" | "driverName"> }) {
  const t = useT("orders");
  const by = deliveredBy(order);
  if (!by) return <CellEmpty />;
  const Icon = by.kind === "carrier" ? Building2 : Truck;
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 text-sm text-muted-foreground">
      <Icon size={14} aria-hidden="true" className="shrink-0" />
      <span className="truncate">{by.name ?? t(by.kind === "carrier" ? "delivery.a_carrier" : "delivery.a_driver")}</span>
    </span>
  );
}
