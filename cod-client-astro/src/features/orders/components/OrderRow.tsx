import { Flag, Star } from "lucide-react";
import { useLocale, useT } from "@/i18n/react";
import { relativeTime } from "@/lib/relative-time";
import { RowActions, TableCell, TableRow, openRowOnClick } from "@/components/ui";
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
      className="size-4 cursor-pointer rounded accent-[var(--primary)] pointer-coarse:size-5"
    />
  );
}

function OrderNumber({ order, className = "" }: { order: OrderListItem; className?: string }) {
  const flagLabel = useT("apps")("order_protection.flag.label");
  return (
    <a
      href={`/orders/${order.id}`}
      className={`inline-flex items-center gap-1 font-medium text-foreground underline-offset-2 hover:underline ${className}`}
    >
      {order.orderNumber}
      {(order.flagged ?? 0) > 0 && <Flag size={12} aria-label={flagLabel} className="text-[var(--tone-warning-text)]" />}
      {(order.hasReview ?? 0) > 0 && <Star size={12} aria-hidden="true" className="fill-[var(--tone-warning-text)] text-[var(--tone-warning-text)]" />}
    </a>
  );
}

export function OrderDesktopRow({ order, selection, selectable = false, ...actions }: RowProps & { selectable?: boolean }) {
  const locale = useLocale();
  return (
    <TableRow
      onClick={openRowOnClick(`/orders/${order.id}`)}
      className={`cursor-pointer ${selection?.selected ? "bg-[var(--tone-info-bg)]/40" : ""}`}
    >
      {selectable && (
        <TableCell className="w-10">
          <Pick order={order} selection={selection} />
        </TableCell>
      )}
      <TableCell className="whitespace-nowrap">
        <OrderNumber order={order} />
      </TableCell>
      <TableCell className="whitespace-nowrap text-muted-foreground">
        <time dateTime={order.createdAt} title={new Date(order.createdAt).toLocaleString()}>
          {relativeTime(order.createdAt, locale)}
        </time>
      </TableCell>
      <TableCell className="max-w-52 truncate">{order.customerName}</TableCell>
      <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
        <span dir="ltr">{order.phone}</span>
      </TableCell>
      <TableCell>
        <StageBadge stage={order.stage} needsAttention={order.needsAttention} />
      </TableCell>
      <TableCell className="max-w-48">
        <OrderDelivery order={order} />
      </TableCell>
      <TableCell numeric>{formatMoney(orderTotal(order), locale)}</TableCell>
      <TableCell className="w-px">
        <RowActions>
          <OrderRowActions order={order} {...actions} />
        </RowActions>
      </TableCell>
    </TableRow>
  );
}

export function OrderMobileCard({ order, selection }: Pick<RowProps, "order" | "selection">) {
  const locale = useLocale();
  return (
    <article
      onClick={openRowOnClick(`/orders/${order.id}`)}
      className="flex cursor-pointer gap-3 px-4 py-3 transition-colors active:bg-subtle"
    >
      {selection && (
        <div className="pt-0.5">
          <Pick order={order} selection={selection} />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <OrderNumber order={order} className="text-sm" />
          <span className="shrink-0 text-sm font-medium tabular-nums text-foreground">{formatMoney(orderTotal(order), locale)}</span>
        </div>
        <div className="mt-0.5 flex items-baseline justify-between gap-3 text-sm">
          <span className="truncate text-foreground">{order.customerName}</span>
          <span dir="ltr" className="shrink-0 tabular-nums text-muted-foreground">
            {order.phone}
          </span>
        </div>
        <div className="mt-2 flex min-w-0 items-center gap-3">
          <StageBadge stage={order.stage} needsAttention={order.needsAttention} />
          {order.shipmentKind && <OrderDelivery order={order} />}
          <time dateTime={order.createdAt} className="ms-auto shrink-0 text-xs text-muted-foreground">
            {relativeTime(order.createdAt, locale)}
          </time>
        </div>
      </div>
    </article>
  );
}
