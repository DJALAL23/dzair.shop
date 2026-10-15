import { ArrowRight, Send, XCircle } from "lucide-react";
import { useT } from "@/i18n/react";
import { Button, Card } from "@/components/ui";
import type { StatusMove } from "@/features/orders/model";
import type { OrderStatus } from "@/features/orders/types";

/**
 * What to do with the order next, before its delivery: confirm it, prepare
 * it, ship it, or cancel it. The usual next step stands out; once it has a
 * shipment, the delivery card takes over.
 */
export function OrderNextStepCard({
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
  if (moves.length === 0 && !canShip) return null;
  return (
    <Card title={t("next.title")}>
      <div className="flex flex-col gap-2">
        {canShip && (
          <Button type="button" disabled={busy} onClick={onShip}>
            <Send size={16} />
            {t("ship.action")}
          </Button>
        )}
        {moves.map((move) => (
          <Button
            key={move.status}
            type="button"
            disabled={busy}
            variant={move.emphasis === "primary" && !canShip ? "primary" : move.emphasis === "danger" ? "dangerOutline" : "secondary"}
            onClick={() => onMove(move.status)}
          >
            {move.emphasis === "danger" ? <XCircle size={16} /> : <ArrowRight size={16} className="rtl:rotate-180" />}
            {t(`move.${move.status}`)}
          </Button>
        ))}
      </div>
    </Card>
  );
}
