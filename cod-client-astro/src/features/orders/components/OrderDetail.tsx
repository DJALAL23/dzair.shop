import { useEffect, useState } from "react";
import { Archive, ArchiveRestore, Pencil, StickyNote, Trash2 } from "lucide-react";
import { canScope, useIdentity } from "@/features/auth/components/RequireAuth";
import { useLocale, useT } from "@/i18n/react";
import { notify } from "@/lib/notify";
import { Alert, Button, Card, PageHeader, useConfirmDialog } from "@/components/ui";
import { archiveOrder, deleteOrder, getOrder, getOrderRemoval, listDeliveryCompanies, listDrivers, unarchiveOrder } from "@/features/orders/api";
import { canEditOrder, canHandOff, canRecordRefusedUnits, handoffKinds, orderDeletionConsequences, orderRemovalError, statusMoves } from "@/features/orders/model";
import type { DeliveryCompany, Driver, OrderDetail as OrderDetailType, OrderRemoval, OrderStatus } from "@/features/orders/types";
import { StageBadge } from "@/features/orders/components/StageBadge";
import { OrderCustomerCard } from "@/features/orders/components/OrderCustomerCard";
import { OrderCustomAnswersCard } from "@/features/orders/components/OrderCustomAnswersCard";
import { OrderProductsCard } from "@/features/orders/components/OrderProductsCard";
import { OrderShipmentCard } from "@/features/orders/components/OrderShipmentCard";
import { OrderNextStepCard } from "@/features/orders/components/OrderNextStepCard";
import { OrderProgressCard } from "@/features/orders/components/OrderProgressCard";
import { OrderEventsCard } from "@/features/events/components/OrderEventsCard";
import { OrderMobileActionBar } from "@/features/orders/components/OrderMobileActionBar";
import { EditOrderDialog } from "@/features/orders/components/EditOrderDialog";
import { HandoffDialog } from "@/features/orders/components/HandoffDialog";
import { useStatusMove } from "@/features/orders/components/useStatusMove";

/**
 * One order, as the merchant follows it: the customer and what they ordered,
 * the next step while it is being processed, and once it is shipped its
 * delivery — who carries it, where it stands, and what can be done now.
 */
export function OrderDetail({ orderId }: { orderId: string }) {
  const t = useT("orders");
  const common = useT("common");
  const auth = useT("auth");
  const locale = useLocale();
  const identity = useIdentity();
  const may = (scope: string) => canScope(identity, scope);
  const confirm = useConfirmDialog();
  const [order, setOrder] = useState<OrderDetailType | null>(null);
  const [removal, setRemoval] = useState<OrderRemoval | null>(null);
  const [companies, setCompanies] = useState<DeliveryCompany[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [shipping, setShipping] = useState(false);
  const kinds = may("delivery:read") ? handoffKinds(may) : [];

  async function load() {
    try {
      const [detail, options] = await Promise.all([getOrder(orderId), getOrderRemoval(orderId)]);
      setOrder(detail);
      setRemoval(options);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  const move = useStatusMove(load, setError);

  useEffect(() => {
    void load();
    if (!may("delivery:read")) return;
    listDeliveryCompanies(true).then(setCompanies).catch(() => setCompanies([]));
    if (kinds.includes("driver")) listDrivers().then(setDrivers).catch(() => setDrivers([]));
  }, [orderId, identity?.role, identity?.scopes.join(",")]);

  async function changeStatus(status: OrderStatus) {
    if (!order) return;
    setBusy(true);
    try {
      await move(order, status);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!order || !removal) return;
    const accepted = await confirm({
      title: t("removal.delete_title", { order: order.orderNumber }),
      description: t("removal.delete_description"),
      consequences: orderDeletionConsequences(removal, t),
      confirmText: order.orderNumber,
      confirmLabel: t("actions.delete"),
      tone: "danger",
    });
    if (!accepted) return;
    setBusy(true);
    try {
      await deleteOrder(order.id);
      notify.flashSuccess(t("removal.deleted", { order: order.orderNumber }));
      window.location.assign("/orders");
    } catch (cause) {
      setError(orderRemovalError(cause, t));
      notify.error(common("feedback.action_failed"));
      setBusy(false);
      void load();
    }
  }

  async function setArchived(archived: boolean) {
    if (!order) return;
    setBusy(true);
    try {
      if (archived) await archiveOrder(order.id);
      else await unarchiveOrder(order.id);
      notify.success(t(archived ? "removal.archived" : "removal.restored"));
      await load();
    } catch (cause) {
      setError(orderRemovalError(cause, t));
      notify.error(common("feedback.action_failed"));
    } finally {
      setBusy(false);
    }
  }


  if (!may("orders:read")) {
    return (
      <Alert role="alert" tone="critical">
        {auth("no_access")}
      </Alert>
    );
  }

  if (error && !order) {
    return (
      <Alert role="alert" tone="critical">
        <span className="flex-1">{error}</span>
        <Button type="button" variant="ghost" onClick={() => void load()}>
          {common("retry")}
        </Button>
      </Alert>
    );
  }

  if (!order) {
    return (
      <div role="status" aria-busy="true" className="space-y-3">
        <div className="h-28 shimmer rounded-xl" />
        <div className="h-80 shimmer rounded-xl" />
      </div>
    );
  }

  const facts = { status: order.status, hasShipment: order.shipment !== null };
  const moves = may("orders:update") ? statusMoves(facts) : [];
  const canShip = canHandOff(facts) && kinds.length > 0;

  return (
    <div className="space-y-5 pb-24 lg:pb-0">
      <PageHeader
        title={order.orderNumber}
        subtitle={order.orderType === "online" ? t("type.online") : t("type.offline")}
        backHref="/orders"
        backLabel={t("detail.back_to_orders")}
        actions={
          <div className="flex items-center gap-2">
            <StageBadge stage={order.stage} needsAttention={order.needsAttention} />
            {may("orders:update") && canEditOrder(facts) && (
              <Button type="button" variant="secondary" className="size-9 min-h-9 px-0" onClick={() => setEditing(true)} disabled={busy} aria-label={t("actions.edit")}>
                <Pencil size={16} />
              </Button>
            )}
            {may("orders:update") && removal?.archivable && (
              <Button type="button" variant="secondary" className="max-sm:size-9 max-sm:min-h-9 max-sm:px-0" onClick={() => void setArchived(true)} disabled={busy} title={t("removal.archive")}>
                <Archive size={16} aria-hidden="true" />
                <span className="max-sm:sr-only">{t("removal.archive")}</span>
              </Button>
            )}
            {may("orders:delete") && removal?.deletable && (
              <Button type="button" variant="secondary" className="size-9 min-h-9 px-0 text-destructive" onClick={() => void remove()} disabled={busy} aria-label={t("actions.delete")} title={t("actions.delete")}>
                <Trash2 size={16} />
              </Button>
            )}
          </div>
        }
      />
      {error && (
        <Alert role="alert" tone="critical">
          <span>{error}</span>
        </Alert>
      )}
      {order.archivedAt && (
        <Alert role="status" tone="info">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>{t("removal.archived_banner")}</span>
            {may("orders:update") && (
              <Button type="button" variant="secondary" size="sm" onClick={() => void setArchived(false)} disabled={busy}>
                <ArchiveRestore size={14} aria-hidden="true" />
                {t("removal.restore")}
              </Button>
            )}
          </div>
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_400px]">
        <div className="space-y-5">
          <OrderCustomerCard order={order} />
          <OrderCustomAnswersCard customFieldsJson={order.customFieldsJson} />
          <OrderProductsCard order={order} locale={locale} canRecordRefused={may("orders:update") && canRecordRefusedUnits(order.stage)} onChanged={load} />
          {order.notes && (
            <Card title={t("detail.notes")}>
              <p className="flex gap-2 text-sm">
                <StickyNote size={15} className="mt-0.5 shrink-0 text-muted-foreground" />
                {order.notes}
              </p>
            </Card>
          )}
        </div>

        <div className="space-y-5 lg:sticky lg:top-5 lg:self-start">
          {order.shipment ? (
            <OrderShipmentCard order={order} shipment={order.shipment} companies={companies} onChanged={load} />
          ) : (
            <OrderNextStepCard moves={moves} canShip={canShip} busy={busy} onMove={(status) => void changeStatus(status)} onShip={() => setShipping(true)} />
          )}
          <OrderProgressCard history={order.statusHistory} />
          <OrderEventsCard orderId={order.id} canSeeDeliveries={may("settings:integrations")} />
        </div>
      </div>

      <OrderMobileActionBar moves={moves} canShip={canShip} busy={busy} onMove={(status) => void changeStatus(status)} onShip={() => setShipping(true)} />

      {editing && <EditOrderDialog order={order} onClose={() => setEditing(false)} onChanged={load} onError={setError} />}
      {shipping && <HandoffDialog order={order} kinds={kinds} companies={companies} drivers={drivers} onClose={() => setShipping(false)} onDone={load} />}
    </div>
  );
}
