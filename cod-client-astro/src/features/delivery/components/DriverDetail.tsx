import { useEffect, useState } from "react";
import { FileText, Package, Pencil, Printer, Truck, X } from "lucide-react";
import {
  canScope,
  useIdentity,
} from "@/features/auth/components/RequireAuth";
import {
  Alert,
  Button,
  LinkButton,
  PageHeader,
  StatCard, StatGroup,
} from "@/components/ui";
import { useLocale, useT } from "@/i18n/react";
import { SCOPES } from "../../../../../cod-shared/rbac/scopes";
import {
  getDriver,
  listPendingSettlements,
} from "@/features/delivery/api";
import {
  driverErrorMessage,
  driverFullName,
  driverInitials,
  formatDeliveryMoney,
} from "@/features/delivery/model";
import type {
  Driver,
  PendingSettlement,
} from "@/features/delivery/types";
import { DriverStatusBadge } from "@/features/delivery/components/DriverStatusBadge";
import { DriverShipmentsCard } from "@/features/delivery/components/DriverShipmentsCard";
import { AssignOrdersDialog } from "@/features/delivery/components/AssignOrdersDialog";
import { deliverySheetHref, printLabelsHref } from "@/features/shipping-labels/model";
import { DriverSettlementCard } from "@/features/delivery/components/DriverSettlementCard";

function Loading() {
  return (
    <div role="status" aria-busy="true" className="space-y-4">
      <div className="h-20 shimmer rounded-xl" />
      <div className="h-64 shimmer rounded-xl" />
    </div>
  );
}

export function DriverDetail({ driverId }: { driverId: string }) {
  const t = useT("delivery");
  const common = useT("common");
  const auth = useT("auth");
  const locale = useLocale();
  const identity = useIdentity();
  const [driver, setDriver] = useState<Driver | null>(null);
  const [pending, setPending] = useState<PendingSettlement[]>([]);
  const [giving, setGiving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canManage = canScope(identity, SCOPES.DELIVERY_MANAGE);
  const canAssign = canScope(identity, SCOPES.ORDERS_ASSIGN);
  const canReadOrders = canScope(identity, SCOPES.ORDERS_READ);

  async function load() {
    setError(null);
    try {
      const [nextDriver, nextPending] = await Promise.all([
        getDriver(driverId),
        listPendingSettlements(driverId),
      ]);
      setDriver(nextDriver);
      setPending(nextPending);
    } catch (cause) {
      setError(driverErrorMessage(cause, t));
    }
  }
  useEffect(() => {
    if (canScope(identity, SCOPES.DELIVERY_READ)) void load();
  }, [driverId, identity?.role, identity?.scopes.join(",")]);

  if (!canScope(identity, SCOPES.DELIVERY_READ))
    return (
      <Alert role="alert" tone="critical">
        {auth("no_access")}
      </Alert>
    );
  if (error && !driver)
    return (
      <Alert role="alert" tone="critical">
        <span className="flex-1">{error}</span>
        <Button type="button" variant="ghost" onClick={() => void load()}>
          {common("retry")}
        </Button>
      </Alert>
    );
  if (!driver) return <Loading />;


  return (
    <div className="space-y-5 pb-24 lg:pb-0">
      <PageHeader
        title={driverFullName(driver)}
        subtitle={
          <span className="flex flex-wrap gap-x-3">
            <span dir="ltr">{driver.phone}</span>
            {driver.phone2 && <span dir="ltr">{driver.phone2}</span>}
            {driver.vehicleType && <span>{t(`vehicle_type.${driver.vehicleType}`)}</span>}
          </span>
        }
        media={
          <span className="grid size-12 place-items-center rounded-full bg-muted text-sm font-semibold text-muted-foreground">
            {driverInitials(driver)}
          </span>
        }
        badges={<DriverStatusBadge status={driver.status} />}
        backHref="/delivery/drivers"
        backLabel={t("tabs.drivers")}
        actions={
          canManage ? (
            <div className="flex gap-2">
              <LinkButton
                href={`/delivery/drivers/${encodeURIComponent(driver.id)}/edit`}
                variant="secondary"
              >
                <Pencil size={16} />
                {t("actions.edit")}
              </LinkButton>
            </div>
          ) : undefined
        }
      />
      {error && (
        <Alert role="alert" tone="critical">
          <span className="flex-1">{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            aria-label={common("cancel")}
          >
            <X size={16} />
          </button>
        </Alert>
      )}
      {driver.notes && <p className="text-sm text-muted-foreground">{driver.notes}</p>}
      {driver.cashReconciliation && driver.cashReconciliation.drift !== 0 && (
        <Alert role="alert" tone="warning">
          <span className="flex-1">
            {t("driver_card.cash_drift_warning", {
              pending: formatDeliveryMoney(driver.cashReconciliation.pendingCash, locale),
              orders: formatDeliveryMoney(driver.cashReconciliation.pendingOrdersTotal, locale),
              drift: formatDeliveryMoney(Math.abs(driver.cashReconciliation.drift), locale),
            })}
          </span>
        </Alert>
      )}
      <StatGroup columns={4}>
        <StatCard
          label={t("driver_card.active_orders")}
          value={driver.openShipmentCount ?? 0}
        />
        <StatCard
          label={t("driver_card.total_delivered")}
          value={driver.totalDelivered}
        />
        <StatCard
          label={t("driver_card.pending_cash")}
          value={formatDeliveryMoney(driver.pendingCash, locale)}
          tone={driver.pendingCash > 0 ? "warning" : "neutral"}
        />
        <StatCard
          label={t("driver_card.earnings")}
          value={formatDeliveryMoney(driver.totalEarnings, locale)}
        />
      </StatGroup>
      <div className="flex flex-wrap gap-2">
        {canAssign && driver.status !== "inactive" && (
          <Button type="button" onClick={() => setGiving(true)}>
            <Package size={15} />
            {t("actions.assign_orders")}
          </Button>
        )}
        <LinkButton
          href={`/delivery/drivers/${encodeURIComponent(driver.id)}/compensations`}
          variant="secondary"
        >
          <Truck size={15} />
          {t("compensations.title")}
          {driver.compensationWilayaCount
            ? ` (${driver.compensationWilayaCount})`
            : ""}
        </LinkButton>
        {canReadOrders && (driver.openShipmentCount ?? 0) > 0 && (
          <>
            <LinkButton href={printLabelsHref({ driverId: driver.id })} target="_blank" rel="noopener" variant="secondary">
              <Printer size={15} aria-hidden="true" />
              {t("labels.actions.print_open_labels")}
            </LinkButton>
            <LinkButton href={deliverySheetHref(driver.id)} target="_blank" rel="noopener" variant="secondary">
              <FileText size={15} aria-hidden="true" />
              {t("labels.actions.delivery_sheet")}
            </LinkButton>
          </>
        )}
      </div>
      <DriverShipmentsCard shipments={driver.recentShipments ?? []} />
      <DriverSettlementCard driverId={driver.id} pending={pending} onSettled={load} />
      {giving && <AssignOrdersDialog driver={driver} onClose={() => setGiving(false)} onDone={load} />}
    </div>
  );
}
