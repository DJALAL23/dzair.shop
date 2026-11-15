import { ArrowLeft, Send } from "lucide-react";
import { useT } from "@/i18n/react";
import { Button } from "@/components/ui";
import { moveLabel, nextStepLayout, type StatusMove } from "@/features/orders/model";
import type { OrderStatus } from "@/features/orders/types";
import { MoveIcon } from "@/features/orders/components/StageBadge";

/**
 * On a phone: the order's next step within thumb's reach — for a waiting
 * order, both results of the call, the confirmation last — and nothing when
 * there is none.
 */
export function OrderMobileActionBar({
  moves,
  status,
  calls,
  canShip,
  busy,
  onMove,
  onShip,
}: {
  moves: StatusMove[];
  status: OrderStatus;
  calls: number;
  canShip: boolean;
  busy: boolean;
  onMove: (status: OrderStatus) => void;
  onShip: () => void;
}) {
  const t = useT("orders");
  const next = moves.find((move) => move.emphasis === "primary");
  if (!canShip && !next) return null;
  const outcomes = canShip ? [] : [...nextStepLayout(status, moves).outcomes].reverse();

  return (
    <div className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-40 flex gap-2 rounded-xl bg-card p-2 shadow-popover lg:hidden">
      {outcomes.length < 2 && (
        <a href="/orders" aria-label={t("detail.back_to_orders")} className="grid size-11 shrink-0 place-items-center rounded-lg text-muted-foreground shadow-card">
          <ArrowLeft size={18} className="rtl:rotate-180" />
        </a>
      )}
      {canShip ? (
        <Button type="button" className="h-11 flex-1" disabled={busy} onClick={onShip}>
          <Send size={16} />
          {t("ship.action")}
        </Button>
      ) : outcomes.length === 2 ? (
        <div role="group" aria-label={t("next.outcomes")} className="flex min-w-0 flex-1 gap-2">
          {outcomes.map((move) => (
            <Button
              key={move.status}
              type="button"
              variant={move.emphasis === "primary" ? "primary" : "secondary"}
              className="h-11 min-w-0 flex-1 px-2"
              disabled={busy}
              onClick={() => onMove(move.status)}
              aria-label={moveLabel(t, move.status, calls)}
            >
              <MoveIcon status={move.status} size={16} />
              {move.status === "unreachable" ? (
                <span aria-hidden="true" className="flex flex-col items-start leading-tight">
                  <span>{t("stage.unreachable")}</span>
                  <span className="text-[11px] font-medium opacity-75">{t("calls.call", { call: calls + 1 })}</span>
                </span>
              ) : (
                <span aria-hidden="true" className="truncate">
                  {move.status === "confirmed" ? t("move.confirmed_short") : moveLabel(t, move.status, calls)}
                </span>
              )}
            </Button>
          ))}
        </div>
      ) : (
        next && (
          <Button type="button" className="h-11 flex-1" disabled={busy} onClick={() => onMove(next.status)}>
            <MoveIcon status={next.status} size={16} />
            {moveLabel(t, next.status, calls)}
          </Button>
        )
      )}
    </div>
  );
}
