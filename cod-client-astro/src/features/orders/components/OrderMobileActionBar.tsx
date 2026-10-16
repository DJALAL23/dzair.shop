import { ArrowLeft, Send } from "lucide-react";
import { useT } from "@/i18n/react";
import { Button } from "@/components/ui";
import type { StatusMove } from "@/features/orders/model";
import type { OrderStatus } from "@/features/orders/types";

/** On a phone: the order's one next step within thumb's reach — and nothing when there is none. */
export function OrderMobileActionBar({
  moves,
  canShip,
  busy,
  onMove,
  onShip,
}: {
  moves: StatusMove[];
  canShip: boolean;
  busy: boolean;
  onMove: (status: OrderStatus) => void;
  onShip: () => void;
}) {
  const t = useT("orders");
  const next = moves.find((move) => move.emphasis === "primary");
  if (!canShip && !next) return null;

  return (
    <div className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-40 flex gap-2 rounded-xl bg-card p-2 shadow-popover lg:hidden">
      <a href="/orders" aria-label={t("detail.back_to_orders")} className="grid size-11 shrink-0 place-items-center rounded-lg text-muted-foreground shadow-card">
        <ArrowLeft size={18} className="rtl:rotate-180" />
      </a>
      {canShip ? (
        <Button type="button" className="h-11 flex-1" disabled={busy} onClick={onShip}>
          <Send size={16} />
          {t("ship.action")}
        </Button>
      ) : (
        next && (
          <Button type="button" className="h-11 flex-1" disabled={busy} onClick={() => onMove(next.status)}>
            {t(`move.${next.status}`)}
          </Button>
        )
      )}
    </div>
  );
}
