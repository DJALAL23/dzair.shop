import { Flag, Star, UserRound } from "lucide-react";
import { useLocale, useT } from "@/i18n/react";
import { listOf, useMatchName } from "@/features/apps/order-protection/words";
import { relativeTime } from "@/lib/relative-time";
import { CellEmpty, Initial, RowActions, TableCell, TableRow, openRowOnClick } from "@/components/ui";
import { formatMoney, orderTotal } from "@/features/orders/model";
import type { DeliveryCompany, Driver, OrderListItem } from "@/features/orders/types";
import { OrderStatusCard } from "@/features/orders/components/OrderStatusCard";
import { OrderRowActions } from "@/features/orders/components/OrderRowActions";
import { OrderSource } from "@/features/orders/components/OrderSourceCard";

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

const isWaiting = (order: OrderListItem) => order.status === "new" || order.status === "unreachable";

/** Who on the confirmation team has the order, in one short line; "Not assigned" while a waiting order is with no one. */
function OrderAssignee({ order }: { order: OrderListItem }) {
  const team = useT("confirmation");
  if (order.assigneeName) {
    return (
      <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
        <UserRound size={12} className="shrink-0" aria-hidden="true" />
        <span className="truncate">{team("order.with", { name: order.assigneeName })}</span>
      </span>
    );
  }
  if (!isWaiting(order)) return null;
  return <span className="block shrink-0 text-xs font-medium text-[var(--tone-warning-text)]">{team("order.nobody")}</span>;
}

/** The team member who has the order, under the "Assigned to" column: their initial and name. */
function AssigneeCell({ order }: { order: OrderListItem }) {
  const team = useT("confirmation");
  if (order.assigneeName) {
    return (
      <span className="flex min-w-0 items-center gap-2" title={order.assigneeName}>
        <Initial name={order.assigneeName} className="size-6 text-[11px]" />
        <span className="sr-only min-w-0 xl:not-sr-only">
          <span className="block truncate text-sm text-foreground">{order.assigneeName}</span>
        </span>
      </span>
    );
  }
  if (!isWaiting(order)) return <CellEmpty />;
  return <span className="text-xs font-medium text-[var(--tone-warning-text)]">{team("order.nobody")}</span>;
}

function OrderNumber({ order, className = "" }: { order: OrderListItem; className?: string }) {
  const t = useT("apps");
  const locale = useLocale();
  const matchName = useMatchName();
  const reasons = (order.flagReasons ?? []).map(matchName);
  const flagLabel = reasons.length > 0 ? t("order_protection.flag.label_because", { rules: listOf(reasons, locale) }) : t("order_protection.flag.label");
  return (
    <a
      href={`/orders/${order.id}`}
      className={`inline-flex items-center gap-1 whitespace-nowrap font-medium text-foreground underline-offset-2 hover:underline ${className}`}
    >
      {order.orderNumber}
      {(order.flagged ?? 0) > 0 && (
        <span role="img" aria-label={flagLabel} title={flagLabel} className="inline-flex">
          <Flag size={12} aria-hidden="true" className="text-[var(--tone-warning-text)]" />
        </span>
      )}
      {(order.hasReview ?? 0) > 0 && <Star size={12} aria-hidden="true" className="fill-[var(--tone-warning-text)] text-[var(--tone-warning-text)]" />}
    </a>
  );
}

function Placed({ order }: { order: OrderListItem }) {
  const locale = useLocale();
  return (
    <time dateTime={order.createdAt} title={new Date(order.createdAt).toLocaleString(locale)} className="shrink-0">
      {relativeTime(order.createdAt, locale)}
    </time>
  );
}

export function OrderDesktopRow({ order, selection, selectable = false, showAssignee = false, ...actions }: RowProps & { selectable?: boolean; showAssignee?: boolean }) {
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
      <TableCell className="max-w-60">
        <OrderNumber order={order} />
        <span className="mt-0.5 flex min-w-0 max-w-52 items-baseline gap-2 text-xs xl:hidden">
          <span className="truncate text-foreground">{order.customerName}</span>
          <span dir="ltr" className="shrink-0 tabular-nums text-muted-foreground">
            {order.phone}
          </span>
        </span>
        <span className="mt-0.5 flex min-w-0 max-w-52 items-center gap-1.5 text-xs text-muted-foreground xl:max-w-60">
          <Placed order={order} />
          {order.source && (
            <>
              <span aria-hidden="true">·</span>
              <OrderSource order={order} compact quiet />
            </>
          )}
        </span>
      </TableCell>
      <TableCell className="hidden max-w-52 xl:table-cell">
        <span className="block truncate text-foreground">{order.customerName}</span>
        <span className="block text-xs tabular-nums text-muted-foreground">
          <span dir="ltr">{order.phone}</span>
        </span>
      </TableCell>
      <TableCell className="max-w-64">
        <OrderStatusCard order={order} />
      </TableCell>
      {showAssignee && (
        <TableCell className="max-w-44">
          <AssigneeCell order={order} />
        </TableCell>
      )}
      <TableCell numeric className="font-medium">
        {formatMoney(orderTotal(order), locale)}
      </TableCell>
      <TableCell className="w-px">
        <RowActions>
          <OrderRowActions order={order} {...actions} />
        </RowActions>
      </TableCell>
    </TableRow>
  );
}

export function OrderMobileCard({ order, selection, showAssignee = false }: Pick<RowProps, "order" | "selection"> & { showAssignee?: boolean }) {
  const locale = useLocale();
  const assignee = showAssignee && (order.assigneeName || isWaiting(order));
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
          <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">{formatMoney(orderTotal(order), locale)}</span>
        </div>
        <div className="mt-0.5 flex items-baseline justify-between gap-3 text-sm">
          <span className="truncate text-foreground">{order.customerName}</span>
          <span dir="ltr" className="shrink-0 tabular-nums text-muted-foreground">
            {order.phone}
          </span>
        </div>
        <div className="mt-2 flex min-w-0 items-center justify-between gap-3">
          <OrderStatusCard order={order} />
          <span className="shrink-0 text-xs text-muted-foreground">
            <Placed order={order} />
          </span>
        </div>
        {(order.source || assignee) && (
          <div className="mt-2 flex min-w-0 items-center justify-between gap-3 text-xs">
            {order.source && (
              <span className="min-w-0">
                <OrderSource order={order} compact quiet />
              </span>
            )}
            {assignee && (
              <span className={`min-w-0 ${order.source ? "ms-auto" : ""}`}>
                <OrderAssignee order={order} />
              </span>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
