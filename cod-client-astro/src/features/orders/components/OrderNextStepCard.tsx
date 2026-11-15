import { MoreHorizontal, Send } from "lucide-react";
import { useT } from "@/i18n/react";
import { Button, Card, DropdownItem, DropdownMenu } from "@/components/ui";
import { moveLabel, nextStepLayout, type StatusMove } from "@/features/orders/model";
import type { OrderStatus } from "@/features/orders/types";
import { MoveIcon } from "@/features/orders/components/StageBadge";

/**
 * What to do with the order next, before its delivery. A waiting order shows
 * the two results of a call side by side — confirmed, or no answer — then
 * preparing and shipping come next; cancelling always stands apart, and a
 * call without an answer on a confirmed order waits behind More. Once it has
 * a shipment, the delivery card takes over.
 */
export function OrderNextStepCard({
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
  /** The order's calls without an answer: "No answer" records the next one. */
  calls: number;
  canShip: boolean;
  busy: boolean;
  onMove: (status: OrderStatus) => void;
  onShip: () => void;
}) {
  const t = useT("orders");
  if (moves.length === 0 && !canShip) return null;
  const layout = nextStepLayout(status, moves);
  const button = (move: StatusMove) => (
    <Button
      key={move.status}
      type="button"
      disabled={busy}
      variant={move.emphasis === "danger" ? "dangerOutline" : move.emphasis === "primary" && !canShip ? "primary" : "secondary"}
      onClick={() => onMove(move.status)}
    >
      <MoveIcon status={move.status} size={16} />
      {moveLabel(t, move.status, calls)}
    </Button>
  );
  const more =
    layout.more.length > 0 ? (
      <DropdownMenu trigger={<MoreHorizontal size={16} />} triggerLabel={t("next.more")} align="end">
        {layout.more.map((move) => (
          <DropdownItem key={move.status} disabled={busy} onClick={() => onMove(move.status)}>
            <MoveIcon status={move.status} size={14} />
            {moveLabel(t, move.status, calls)}
          </DropdownItem>
        ))}
      </DropdownMenu>
    ) : undefined;
  return (
    <Card title={t("next.title")} action={more}>
      <div className="flex flex-col gap-2">
        {canShip && (
          <Button type="button" disabled={busy} onClick={onShip}>
            <Send size={16} />
            {t("ship.action")}
          </Button>
        )}
        {layout.outcomes.length > 0 && (
          <div role="group" aria-label={t("next.outcomes")} className="flex flex-wrap gap-2 [&>button]:flex-auto">
            {layout.outcomes.map(button)}
          </div>
        )}
        {layout.others.map(button)}
        {layout.cancel && button(layout.cancel)}
      </div>
    </Card>
  );
}
