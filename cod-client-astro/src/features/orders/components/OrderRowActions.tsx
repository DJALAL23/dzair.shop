import { useState } from "react";
import { ArrowRight, Eye, MoreHorizontal, Send, Trash2, XCircle } from "lucide-react";
import { canScope, useIdentity } from "@/features/auth/components/RequireAuth";
import { useT } from "@/i18n/react";
import { notify } from "@/lib/notify";
import { deleteOrder } from "@/features/orders/api";
import { canDeleteOrder, canHandOff, handoffKinds, statusMoves } from "@/features/orders/model";
import type { DeliveryCompany, Driver, OrderListItem } from "@/features/orders/types";
import { DropdownItem, DropdownLink, DropdownMenu, useConfirmDialog } from "@/components/ui";
import { HandoffDialog } from "@/features/orders/components/HandoffDialog";
import { useStatusMove } from "@/features/orders/components/useStatusMove";

/** A row's menu: open the order, take its next step, ship it, or delete it while nothing rests on it. */
export function OrderRowActions({
  order,
  companies,
  drivers,
  onChanged,
  onError,
}: {
  order: OrderListItem;
  companies: DeliveryCompany[];
  drivers: Driver[];
  onChanged: () => void | Promise<void>;
  onError: (message: string) => void;
}) {
  const t = useT("orders");
  const common = useT("common");
  const identity = useIdentity();
  const may = (scope: string) => canScope(identity, scope);
  const confirm = useConfirmDialog();
  const move = useStatusMove(onChanged, onError);
  const [shipping, setShipping] = useState(false);
  const [busy, setBusy] = useState(false);
  const facts = { status: order.status, hasShipment: order.shipmentId !== null };
  const moves = may("orders:update") ? statusMoves(facts) : [];
  const kinds = may("delivery:read") ? handoffKinds(may) : [];
  const showShip = canHandOff(facts) && kinds.length > 0;
  const showDelete = may("orders:delete") && canDeleteOrder(facts);

  async function remove() {
    const accepted = await confirm({
      title: common("confirm_delete_title", { name: order.orderNumber }),
      description: common("delete_description"),
      confirmLabel: t("actions.delete"),
      tone: "danger",
    });
    if (!accepted) return;
    setBusy(true);
    try {
      await deleteOrder(order.id);
      notify.success(common("feedback.deleted"));
      await onChanged();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
      notify.error(common("feedback.action_failed"));
    } finally {
      setBusy(false);
    }
  }

  async function run(status: (typeof moves)[number]["status"]) {
    setBusy(true);
    try {
      await move(order, status);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative" onClick={(event) => event.stopPropagation()}>
      <DropdownMenu trigger={<MoreHorizontal size={16} />} triggerLabel={`${common("table.actions")}: ${order.orderNumber}`}>
        <DropdownLink href={`/orders/${order.id}`}>
          <Eye size={14} />
          {t("actions.view")}
        </DropdownLink>
        {showShip && (
          <DropdownItem disabled={busy} onClick={() => setShipping(true)}>
            <Send size={14} />
            {t("ship.action")}
          </DropdownItem>
        )}
        {moves.map((next) => (
          <DropdownItem key={next.status} disabled={busy} danger={next.emphasis === "danger"} onClick={() => void run(next.status)}>
            {next.emphasis === "danger" ? <XCircle size={14} /> : <ArrowRight size={14} className="rtl:rotate-180" />}
            {t(`move.${next.status}`)}
          </DropdownItem>
        ))}
        {showDelete && (
          <DropdownItem disabled={busy} onClick={() => void remove()} danger>
            <Trash2 size={14} />
            {t("actions.delete")}
          </DropdownItem>
        )}
      </DropdownMenu>
      {shipping && (
        <HandoffDialog
          order={order}
          kinds={kinds}
          companies={companies}
          drivers={drivers}
          onClose={() => setShipping(false)}
          onDone={onChanged}
        />
      )}
    </div>
  );
}
