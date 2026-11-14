import { AlarmClock, Flag, Star, UserRound } from "lucide-react";
import { useLocale, useT } from "@/i18n/react";
import { listOf, useMatchName } from "@/features/apps/order-protection/words";
import { relativeTime } from "@/lib/relative-time";
import { RowActions, TableCell, TableRow, openRowOnClick } from "@/components/ui";
import { formatMoney, orderTotal } from "@/features/orders/model";
import type { DeliveryCompany, Driver, OrderListItem } from "@/features/orders/types";
import { StageBadge } from "@/features/orders/components/StageBadge";
import { OrderDelivery } from "@/features/orders/components/OrderDelivery";
import { OrderRowActions } from "@/features/orders/components/OrderRowActions";
import { OrderSource } from "@/features/orders/components/OrderSourceCard";
import { callbackState, dayFromNow, storeClock } from "@/features/confirmation/model";

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

/** When to call the customer back, on an order still waiting, in a few words: red once the time has come. */
function CallbackChip({ order }: { order: OrderListItem }) {
  const team = useT("confirmation");
  const locale = useLocale();
  if (!order.callbackAt || !isWaiting(order)) return null;
  const due = callbackState(order.callbackAt) === "due";
  const day = dayFromNow(order.callbackAt);
  const when = due
    ? team("order.callback_due")
    : day === "today"
      ? team("list.callback_today", { time: storeClock(order.callbackAt, locale) })
      : day === "tomorrow"
        ? team("list.callback_tomorrow", { time: storeClock(order.callbackAt, locale) })
        : storeClock(order.callbackAt, locale, true);
  return (
    <span
      title={team("order.callback")}
      className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${
        due ? "bg-[var(--tone-critical-bg)] text-[var(--tone-critical-text)]" : "bg-muted text-muted-foreground"
      }`}
    >
      <AlarmClock size={11} aria-hidden="true" />
      <span className="sr-only">{team("order.callback")}: </span>
      {when}
    </span>
  );
}

/** Who on the confirmation team has the order, in one short line; "With nobody" while a waiting order is with no one. */
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
  return <span className="block text-xs font-medium text-[var(--tone-warning-text)]">{team("order.nobody")}</span>;
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
      className={`inline-flex items-center gap-1 font-medium text-foreground underline-offset-2 hover:underline ${className}`}
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
      <TableCell className="whitespace-nowrap">
        <OrderNumber order={order} />
      </TableCell>
      <TableCell className="whitespace-nowrap text-muted-foreground">
        <time dateTime={order.createdAt} title={new Date(order.createdAt).toLocaleString()}>
          {relativeTime(order.createdAt, locale)}
        </time>
      </TableCell>
      <TableCell className="max-w-52">
        <span className="block truncate">{order.customerName}</span>
        {showAssignee && <OrderAssignee order={order} />}
      </TableCell>
      <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
        <span dir="ltr">{order.phone}</span>
      </TableCell>
      <TableCell>
        <span className="flex flex-wrap items-center gap-1.5">
          <StageBadge stage={order.stage} needsAttention={order.needsAttention} />
          <CallbackChip order={order} />
        </span>
      </TableCell>
      <TableCell className="max-w-44">
        <OrderSource order={order} />
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

export function OrderMobileCard({ order, selection, showAssignee = false }: Pick<RowProps, "order" | "selection"> & { showAssignee?: boolean }) {
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
          <span className="min-w-0 max-w-32">
            <OrderSource order={order} compact />
          </span>
          <time dateTime={order.createdAt} className="ms-auto shrink-0 text-xs text-muted-foreground">
            {relativeTime(order.createdAt, locale)}
          </time>
        </div>
        {((showAssignee && (order.assigneeName || isWaiting(order))) || (order.callbackAt && isWaiting(order))) && (
          <div className="mt-1.5 flex min-w-0 items-center gap-2">
            <CallbackChip order={order} />
            {showAssignee && <OrderAssignee order={order} />}
          </div>
        )}
      </div>
    </article>
  );
}
