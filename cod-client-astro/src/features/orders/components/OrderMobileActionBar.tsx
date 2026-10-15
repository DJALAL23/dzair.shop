import { ArrowLeft, Send } from "lucide-react";
import { useT } from "@/i18n/react";
import type { StatusMove } from "@/features/orders/model";
import type { OrderStage, OrderStatus } from "@/features/orders/types";

/** On a phone: back to the orders, and the order's one next step within thumb's reach. */
export function OrderMobileActionBar({
  moves,
  canShip,
  busy,
  stage,
  onMove,
  onShip,
}: {
  moves: StatusMove[];
  canShip: boolean;
  busy: boolean;
  stage: OrderStage;
  onMove: (status: OrderStatus) => void;
  onShip: () => void;
}) {
  const t = useT("orders");
  const next = moves.find((move) => move.emphasis === "primary");
  const primary = "inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-50";

  return (
    <div className="fixed inset-x-3 bottom-3 z-40 flex gap-2 rounded-xl border border-border bg-card/95 p-2 shadow-2xl backdrop-blur lg:hidden">
      <a href="/orders" aria-label={t("detail.back_to_orders")} className="grid size-11 shrink-0 place-items-center rounded-lg border border-input text-muted-foreground">
        <ArrowLeft size={18} className="rtl:rotate-180" />
      </a>
      {canShip ? (
        <button type="button" disabled={busy} onClick={onShip} className={primary}>
          <Send size={16} />
          {t("ship.action")}
        </button>
      ) : next ? (
        <button type="button" disabled={busy} onClick={() => onMove(next.status)} className={primary}>
          {t(`move.${next.status}`)}
        </button>
      ) : (
        <span className="flex h-11 flex-1 items-center justify-center rounded-lg bg-muted text-sm font-semibold text-muted-foreground">{t(`stage.${stage}`)}</span>
      )}
    </div>
  );
}
