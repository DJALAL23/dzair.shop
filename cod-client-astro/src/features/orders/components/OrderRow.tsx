import { MapPin, Star } from "lucide-react";
import { useLocale } from "@/i18n/react";
import { TableCell, TableRow } from "@/components/ui";
import { formatMoney, orderTotal } from "@/features/orders/model";
import type { DeliveryCompany, Driver, OrderListItem } from "@/features/orders/types";
import { StageBadge } from "@/features/orders/components/StageBadge";
import { OrderDelivery } from "@/features/orders/components/OrderDelivery";
import { OrderRowActions } from "@/features/orders/components/OrderRowActions";

interface RowProps {
  order: OrderListItem;
  companies: DeliveryCompany[];
  drivers: Driver[];
  /** Present when the row can be picked for a handoff of several orders. */
  selection?: { selected: boolean; onToggle: () => void };
  onChanged: () => void | Promise<void>;
  onError: (message: string) => void;
}

function Pick({ order, selection }: Pick<RowProps, "order" | "selection">) {
  if (!selection) return null;
  return (
    <input
      type="checkbox"
      checked={selection.selected}
      onChange={selection.onToggle}
      aria-label={order.orderNumber}
      className="size-4 accent-primary"
    />
  );
}

function Place({ order }: { order: OrderListItem }) {
  return (
    <span className="inline-flex min-w-0 items-start gap-1.5 truncate text-xs font-medium">
      <MapPin size={14} className="mt-0.5 shrink-0 text-muted-foreground" />
      {order.wilaya}
      {order.commune ? ` · ${order.commune}` : ""}
    </span>
  );
}

export function OrderDesktopRow({ order, selection, selectable = false, ...actions }: RowProps & { selectable?: boolean }) {
  const locale = useLocale();
  return (
    <TableRow className="border-b border-border transition-colors last:border-0 hover:bg-muted/40">
      {selectable && (
        <TableCell className="w-10">
          <Pick order={order} selection={selection} />
        </TableCell>
      )}
      <TableCell>
        <a href={`/orders/${order.id}`} className="inline-flex items-center gap-1.5 font-semibold text-link underline-offset-4 hover:underline">
          {order.orderNumber}
          {(order.hasReview ?? 0) > 0 && <Star size={12} className="fill-warning text-warning" />}
        </a>
      </TableCell>
      <TableCell>
        <p className="font-medium text-foreground">{order.customerName}</p>
        <p className="text-xs text-muted-foreground" dir="ltr">
          {order.phone}
        </p>
      </TableCell>
      <TableCell>
        <StageBadge stage={order.stage} needsAttention={order.needsAttention} />
      </TableCell>
      <TableCell className="max-w-44">
        <Place order={order} />
      </TableCell>
      <TableCell>
        <OrderDelivery order={order} />
      </TableCell>
      <TableCell className="text-end font-bold tabular-nums text-foreground">{formatMoney(orderTotal(order), locale)}</TableCell>
      <TableCell className="text-end">
        <OrderRowActions order={order} {...actions} />
      </TableCell>
    </TableRow>
  );
}

export function OrderMobileCard({ order, selection, ...actions }: RowProps) {
  const locale = useLocale();
  return (
    <article className="flex gap-3 p-4">
      {selection && (
        <div className="pt-0.5">
          <Pick order={order} selection={selection} />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <a href={`/orders/${order.id}`} className="inline-flex items-center gap-1.5 text-sm font-semibold text-link hover:underline">
              {order.orderNumber}
              {(order.hasReview ?? 0) > 0 && <Star size={12} className="fill-warning text-warning" />}
            </a>
            <p className="mt-0.5 truncate text-sm font-medium text-foreground">{order.customerName}</p>
            <p className="mt-0.5 text-xs text-muted-foreground" dir="ltr">
              {order.phone}
            </p>
          </div>
          <div className="flex items-start gap-1">
            <StageBadge stage={order.stage} needsAttention={order.needsAttention} />
            <OrderRowActions order={order} {...actions} />
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <Place order={order} />
          <span className="shrink-0 text-sm font-bold tabular-nums text-foreground">{formatMoney(orderTotal(order), locale)}</span>
        </div>
        <div className="mt-2">
          <OrderDelivery order={order} />
        </div>
      </div>
    </article>
  );
}
