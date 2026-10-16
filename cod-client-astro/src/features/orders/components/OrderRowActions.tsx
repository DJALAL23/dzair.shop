import { useState } from "react";
import { Archive, ArchiveRestore, ArrowRight, Eye, MoreHorizontal, Send, Trash2, XCircle } from "lucide-react";
import { canScope, useIdentity } from "@/features/auth/components/RequireAuth";
import { useT } from "@/i18n/react";
import { notify } from "@/lib/notify";
import { archiveOrder, deleteOrder, getOrderRemoval, unarchiveOrder } from "@/features/orders/api";
import { canHandOff, handoffKinds, orderDeletionConsequences, orderRemovalError, statusMoves } from "@/features/orders/model";
import { isFinishedStage } from "../../../../../cod-shared/orders/stage";
import type { DeliveryCompany, Driver, OrderListItem } from "@/features/orders/types";
import { DropdownItem, DropdownLink, DropdownMenu, useConfirmDialog } from "@/components/ui";
import { HandoffDialog } from "@/features/orders/components/HandoffDialog";
import { useStatusMove } from "@/features/orders/components/useStatusMove";

/** A row's menu: open the order, take its next step, ship it, delete it before handoff, or archive it once finished. */
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
  const showDelete = may("orders:delete") && !facts.hasShipment;
  const showArchive = may("orders:update") && !order.archivedAt && isFinishedStage(order.stage);
  const showRestore = may("orders:update") && Boolean(order.archivedAt);

  async function remove() {
    setBusy(true);
    try {
      const removal = await getOrderRemoval(order.id);
      if (!removal.deletable) {
        onError(t("removal.error_has_shipment"));
        return;
      }
      const accepted = await confirm({
        title: t("removal.delete_title", { order: order.orderNumber }),
        description: t("removal.delete_description"),
        consequences: orderDeletionConsequences(removal, t),
        confirmText: order.orderNumber,
        confirmLabel: t("actions.delete"),
        tone: "danger",
      });
      if (!accepted) return;
      await deleteOrder(order.id);
      notify.success(t("removal.deleted", { order: order.orderNumber }));
      await onChanged();
    } catch (cause) {
      onError(orderRemovalError(cause, t));
      notify.error(common("feedback.action_failed"));
    } finally {
      setBusy(false);
    }
  }

  async function setArchived(archived: boolean) {
    setBusy(true);
    try {
      if (archived) await archiveOrder(order.id);
      else await unarchiveOrder(order.id);
      notify.success(t(archived ? "removal.archived" : "removal.restored"));
      await onChanged();
    } catch (cause) {
      onError(orderRemovalError(cause, t));
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
        {showArchive && (
          <DropdownItem disabled={busy} onClick={() => void setArchived(true)}>
            <Archive size={14} />
            {t("removal.archive")}
          </DropdownItem>
        )}
        {showRestore && (
          <DropdownItem disabled={busy} onClick={() => void setArchived(false)}>
            <ArchiveRestore size={14} />
            {t("removal.restore")}
          </DropdownItem>
        )}
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
