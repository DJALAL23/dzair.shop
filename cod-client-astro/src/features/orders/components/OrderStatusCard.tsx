import { AlarmClock, Building2, Truck } from "lucide-react";
import { useLocale, useT } from "@/i18n/react";
import { stageClass, stageLabel, statusContext, type StatusContext } from "@/features/orders/model";
import type { OrderListItem } from "@/features/orders/types";
import { StageIcon } from "@/features/orders/components/StageBadge";
import { callbackState, dayFromNow, storeClock } from "@/features/confirmation/model";

type CardOrder = Pick<
  OrderListItem,
  "status" | "stage" | "needsAttention" | "unansweredCalls" | "callbackAt" | "shipmentKind" | "carrierName" | "driverName" | "confirmedAt"
>;

function ContextLine({ context }: { context: StatusContext }) {
  const t = useT("orders");
  const team = useT("confirmation");
  const locale = useLocale();
  if (context.kind === "callback") {
    const due = callbackState(context.at) === "due";
    const day = dayFromNow(context.at);
    const when = due
      ? team("order.callback_due")
      : day === "today"
        ? team("list.callback_today", { time: storeClock(context.at, locale) })
        : day === "tomorrow"
          ? team("list.callback_tomorrow", { time: storeClock(context.at, locale) })
          : storeClock(context.at, locale, true);
    return (
      <span className={`flex items-center gap-1 ${due ? "font-semibold text-[var(--tone-critical-text)]" : "text-muted-foreground"}`}>
        <AlarmClock size={11} aria-hidden="true" className="shrink-0" />
        <span className="sr-only">{team("order.callback")}: </span>
        <span className="truncate">{when}</span>
      </span>
    );
  }
  if (context.kind === "no_answer_cancel") {
    return <span className="block text-muted-foreground">{t("status_card.no_answer_cancel", { count: context.calls })}</span>;
  }
  const Icon = context.kind === "carrier" ? Building2 : Truck;
  const who = t(context.kind === "carrier" ? "delivery.by_carrier" : "delivery.by_driver");
  return (
    <span className="flex items-center gap-1 text-muted-foreground" title={who}>
      <Icon size={11} aria-hidden="true" className="shrink-0" />
      <span className="sr-only">{who}: </span>
      <span className="truncate">{context.name ?? who}</span>
    </span>
  );
}

/**
 * Where an order stands, as a small card: its stage with its own icon, and
 * under it the one fact that goes with it — when to call back, who carries
 * it, or how many calls went unanswered before it was cancelled.
 */
export function OrderStatusCard({ order }: { order: CardOrder }) {
  const t = useT("orders");
  const context = statusContext(order);
  return (
    <span className="inline-flex min-w-0 max-w-52 items-center gap-2 rounded-lg xl:max-w-64 border border-border bg-card py-1 ps-1 pe-2.5 shadow-xs">
      <span className={`grid size-7 shrink-0 place-items-center rounded-md ${stageClass(order.stage)}`}>
        <StageIcon stage={order.stage} needsAttention={order.needsAttention} size={14} />
      </span>
      <span className="flex min-w-0 flex-col text-start">
        <span className="truncate text-[13px] font-medium leading-4 text-foreground">{stageLabel(t, order.stage, order.unansweredCalls)}</span>
        {context && (
          <span className="mt-0.5 min-w-0 text-xs leading-4">
            <ContextLine context={context} />
          </span>
        )}
      </span>
    </span>
  );
}
