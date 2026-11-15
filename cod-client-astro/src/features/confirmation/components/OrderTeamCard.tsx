import { useState } from "react";
import { AlarmClock, CheckCircle2, PhoneCall, PhoneMissed, UserRound, UserX } from "lucide-react";
import { useTeamError } from "@/features/confirmation/errors";
import { useLocale, useT } from "@/i18n/react";
import { notify } from "@/lib/notify";
import { relativeTime } from "@/lib/relative-time";
import { Button, Card, Input } from "@/components/ui";
import { setOrderCallback } from "@/features/confirmation/api";
import { callbackChoices, callbackState, fromStoreInput, toStoreInput } from "@/features/confirmation/model";
import { useCallbackLabel } from "@/features/confirmation/callback-label";
import { GiveOrdersDialog } from "@/features/confirmation/components/GiveOrdersDialog";
import { ConfirmationHistoryButton } from "@/features/confirmation/components/ConfirmationHistory";
import { assignedLine } from "@/features/confirmation/history";
import type { OrderDetail } from "@/features/orders/types";

/**
 * Who works the order: the team member it is with, since when and how it
 * came to them, how many calls had no answer, who confirmed it, and — while
 * the customer has not been confirmed — when to call them back, picked in
 * one tap. While it waits to be confirmed, a manager gives it to someone
 * else here. Its history opens in a side sheet, out of the way.
 */
export function OrderTeamCard({ order, canUpdate, canManage, onChanged }: { order: OrderDetail; canUpdate: boolean; canManage: boolean; onChanged: () => void }) {
  const t = useT("confirmation");
  const orders = useT("orders");
  const explain = useTeamError();
  const locale = useLocale();
  const callbackLabel = useCallbackLabel();
  const [giving, setGiving] = useState(false);
  const [picking, setPicking] = useState(false);
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);
  const waiting = order.status === "new" || order.status === "unreachable";

  async function saveCallback(at: string | null) {
    setBusy(true);
    try {
      await setOrderCallback(order.id, at);
      notify.success(at ? t("order.callback_saved", { time: callbackLabel(at) }) : t("order.callback_cleared"));
      setPicking(false);
      setCustom("");
      onChanged();
    } catch (cause) {
      notify.error(explain(cause, "order.error"));
    } finally {
      setBusy(false);
    }
  }

  if (!order.assigneeId && !waiting && !order.confirmedByName) return null;

  return (
    <Card title={t("order.title")} action={<ConfirmationHistoryButton order={order} />}>
      <div className="space-y-3 text-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2.5">
            <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
              {order.assigneeId ? <UserRound size={16} aria-hidden="true" /> : <UserX size={16} aria-hidden="true" />}
            </span>
            <div className="min-w-0">
              <p className="truncate font-semibold text-foreground">{order.assigneeId ? t("order.with", { name: order.assigneeName ?? "" }) : t("order.nobody")}</p>
              {order.assigneeId && order.assignedAt && (
                <p className="text-xs text-muted-foreground">
                  {assignedLine(t, relativeTime(order.assignedAt, locale), order.assignmentHistory?.[0], order.assigneeId)}
                </p>
              )}
            </div>
          </div>
          {canManage && waiting && (
            <Button type="button" variant="secondary" size="sm" onClick={() => setGiving(true)}>
              {t("order.give")}
            </Button>
          )}
        </div>

        {(order.takeBacks ?? 0) > 0 && waiting && order.status === "new" && (
          <p className="rounded-lg bg-[var(--tone-warning-bg)] px-3 py-2 text-xs font-medium text-[var(--tone-warning-text)]">{t("order.needs_manager", { count: order.takeBacks ?? 0 })}</p>
        )}

        {order.unansweredCalls > 0 && (
          <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <PhoneMissed size={14} className="shrink-0 text-[var(--tone-warning-text)]" aria-hidden="true" />
            {orders("calls.count", { count: order.unansweredCalls })}
          </p>
        )}

        {order.confirmedByName && (
          <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <CheckCircle2 size={14} className="shrink-0 text-[var(--tone-success-text)]" aria-hidden="true" />
            {t("order.confirmed_by", { name: order.confirmedByName })}
          </p>
        )}

        {waiting && (canUpdate || order.callbackAt) && (
          <div className="border-t border-border pt-3">
            {order.callbackAt ? (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className={`flex items-center gap-2 font-semibold ${callbackState(order.callbackAt) === "due" ? "text-[var(--tone-critical-text)]" : "text-foreground"}`}>
                  <AlarmClock size={15} aria-hidden="true" />
                  {callbackState(order.callbackAt) === "due" ? t("order.callback_due") : t("order.callback_at", { time: callbackLabel(order.callbackAt) })}
                </p>
                {canUpdate && (
                  <div className="flex gap-1.5">
                    <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setPicking((open) => !open)}>
                      {t("order.callback_pick")}
                    </Button>
                    <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void saveCallback(null)}>
                      {t("order.callback_clear")}
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              <p className="flex items-center gap-2 font-semibold text-foreground">
                <PhoneCall size={15} aria-hidden="true" />
                {t("order.callback")}
              </p>
            )}
            {canUpdate && (!order.callbackAt || picking) && (
              <div className="mt-2 space-y-2">
                <div className="flex flex-wrap gap-1.5">
                  {callbackChoices().map((choice) => (
                    <Button key={choice.key} type="button" variant="secondary" size="sm" disabled={busy} onClick={() => void saveCallback(choice.at)}>
                      {t(`order.choices.${choice.key}`)}
                    </Button>
                  ))}
                </div>
                <div className="flex gap-1.5">
                  <Input
                    type="datetime-local"
                    aria-label={t("order.callback_pick")}
                    value={custom || (order.callbackAt ? toStoreInput(order.callbackAt) : "")}
                    onChange={(event) => setCustom(event.currentTarget.value)}
                    className="min-w-0 flex-1"
                  />
                  <Button type="button" size="sm" disabled={busy || !fromStoreInput(custom)} onClick={() => void saveCallback(fromStoreInput(custom))}>
                    {t("order.callback_set")}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

      </div>

      {giving && <GiveOrdersDialog orderIds={[order.id]} currentAssigneeId={order.assigneeId ?? null} onClose={() => setGiving(false)} onDone={onChanged} />}
    </Card>
  );
}
