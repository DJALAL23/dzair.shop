import { useState } from "react";
import { AlertCircle, History, X } from "lucide-react";
import {
  canScope,
  useIdentity,
} from "@/features/auth/components/RequireAuth";
import {
  Button,
  Alert,
  StatCard,
  Card,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  useConfirmDialog,
} from "@/components/ui";
import { useLocale, useT } from "@/i18n/react";
import { SCOPES } from "../../../../../cod-shared/rbac/scopes";
import {
  createDriverPayment,
  listDriverPayments,
} from "@/features/delivery/api";
import {
  driverErrorMessage,
  formatDeliveryDate,
  formatDeliveryMoney,
  isSettled,
  pendingTotals,
  settlementOf,
} from "@/features/delivery/model";
import { notify } from "@/lib/notify";
import type {
  DriverPayment,
  DriverPaymentType,
  PendingSettlement,
} from "@/features/delivery/types";

const ACTION: Record<DriverPaymentType, "cod" | "fee" | "net"> = {
  cod_remittance: "cod",
  fee_payment: "fee",
  net_settlement: "net",
};

/**
 * Settling with the driver: the delivered orders whose cash they still hold
 * or whose fee the store still owes. Pick them, then record the cash handed
 * over, the fees paid, or both at once — each part is settled once.
 */
export function DriverSettlementCard({
  driverId,
  pending,
  onSettled,
}: {
  driverId: string;
  pending: PendingSettlement[];
  onSettled: () => void | Promise<void>;
}) {
  const t = useT("delivery");
  const common = useT("common");
  const locale = useLocale();
  const identity = useIdentity();
  const confirm = useConfirmDialog();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<DriverPayment[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canManage = canScope(identity, SCOPES.DELIVERY_MANAGE);
  const open = pending.filter((row) => !isSettled(row));
  const selected = pending.filter((row) => selectedIds.has(row.shipmentId));
  const totals = pendingTotals(open);
  const offers = (["fee_payment", "cod_remittance", "net_settlement"] as const).map((type) => ({ type, ...settlementOf(type, selected) }));
  const allSettled = open.length === 0;
  const isAllSelected = selectedIds.size > 0 && open.every((row) => selectedIds.has(row.shipmentId));

  function toggle(shipmentId: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(shipmentId)) next.delete(shipmentId);
      else next.add(shipmentId);
      return next;
    });
  }
  function toggleAll() {
    setSelectedIds(isAllSelected ? new Set() : new Set(open.map((row) => row.shipmentId)));
  }
  async function loadHistory() {
    if (historyLoading || history !== null) return;
    setHistoryLoading(true);
    try {
      setHistory(await listDriverPayments(driverId));
    } catch (cause) {
      setError(driverErrorMessage(cause, t));
    } finally {
      setHistoryLoading(false);
    }
  }
  async function settle(type: DriverPaymentType) {
    const { shipmentIds, amount } = settlementOf(type, selected);
    if (shipmentIds.length === 0) return;
    const accepted = await confirm({
      title: t("payments.confirm_title"),
      description: t("payments.confirm_body", { amount: formatDeliveryMoney(amount, locale), count: shipmentIds.length }),
      confirmLabel: t(`payments.action_${ACTION[type]}`),
    });
    if (!accepted) return;
    setBusy(true);
    setError(null);
    try {
      await createDriverPayment({ driverId, type, shipmentIds });
      setSelectedIds(new Set());
      setHistory(null);
      notify.success(t(`payments.success_${ACTION[type]}`));
      await onSettled();
    } catch (cause) {
      const message = driverErrorMessage(cause, t);
      setError(message);
      notify.error(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title={t("table.recent_deliveries")}
      action={
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            setShowHistory((current) => !current);
            if (!showHistory) void loadHistory();
          }}
        >
          <History size={15} />
          {t("payments.tab_history")}
        </Button>
      }
    >
      {error && (
        <Alert role="alert" tone="critical">
          <AlertCircle size={18} className="shrink-0" />
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
      {!allSettled && (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard
            label={t("payments.cash_to_collect", { count: totals.cashCount })}
            value={formatDeliveryMoney(totals.cash, locale)}
          />
          <StatCard
            label={t("payments.fees_to_pay", { count: totals.feeCount })}
            value={formatDeliveryMoney(totals.fees, locale)}
          />
        </div>
      )}
      {allSettled ? (
        <p className="py-4 text-center text-sm text-muted-foreground">
          {t("payments.all_settled")}
        </p>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={toggleAll}
              className="min-h-8 px-3 text-xs"
            >
              {isAllSelected
                ? t("payments.deselect_all")
                : t("payments.select_all")}
            </Button>
            {selectedIds.size > 0 && canManage && (
              <div className="flex flex-wrap gap-2">
                {offers
                  .filter((offer) => offer.shipmentIds.length > 0 && offer.amount > 0)
                  .map((offer) => (
                    <Button key={offer.type} type="button" onClick={() => void settle(offer.type)} disabled={busy} className="min-h-8 px-3 text-xs">
                      {t(`payments.action_${ACTION[offer.type]}`)} · {formatDeliveryMoney(offer.amount, locale)}
                    </Button>
                  ))}
              </div>
            )}
          </div>
          <div className="divide-y divide-border rounded-lg border border-border md:hidden">
            {pending.map((order) => {
              const codSettled = !!order.codPaymentId;
              const feeSettled = !!order.feePaymentId;
              const selectable = !(codSettled && feeSettled);
              return (
                <label
                  key={order.shipmentId}
                  className={`flex min-h-16 items-center gap-3 p-3 ${selectable ? "cursor-pointer" : "opacity-60"}`}
                >
                  {selectable && (
                    <input
                      type="checkbox"
                      checked={selectedIds.has(order.shipmentId)}
                      onChange={() => toggle(order.shipmentId)}
                      aria-label={`${t("payments.selected")}: ${order.orderNumber}`}
                      className="size-5 shrink-0 accent-primary"
                    />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">
                      {order.orderNumber}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {order.customerName}
                    </span>
                  </span>
                  <span className="shrink-0 text-end">
                    <span className="block text-sm font-semibold tabular-nums">
                      {formatDeliveryMoney(order.codAmount, locale)}
                    </span>
                    <span className="block text-xs text-muted-foreground tabular-nums">
                      {t("payments.fee_badge")}: {formatDeliveryMoney(order.driverFee, locale)}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
          <div className="hidden overflow-x-auto rounded-lg border border-border md:block">
            <Table className="min-w-[640px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="text-start">
                    {t("table.order")}
                  </TableHead>
                  <TableHead className="text-end">
                    {t("payments.amount_label")} (COD)
                  </TableHead>
                  <TableHead className="text-end">
                    {t("payments.fee_badge")}
                  </TableHead>
                  <TableHead className="text-end">{t("table.date")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pending.map((order) => {
                  const codSettled = !!order.codPaymentId;
                  const feeSettled = !!order.feePaymentId;
                  const selectable = !(codSettled && feeSettled);
                  return (
                    <TableRow
                      key={order.shipmentId}
                      className={selectable ? "" : "opacity-60"}
                    >
                      <TableCell>
                        <div className="flex items-center gap-3">
                          {selectable && (
                            <input
                              type="checkbox"
                              checked={selectedIds.has(order.shipmentId)}
                              onChange={() => toggle(order.shipmentId)}
                              aria-label={`${t("payments.selected")}: ${order.orderNumber}`}
                              className="size-4 accent-primary"
                            />
                          )}
                          <div>
                            <p className="font-semibold">{order.orderNumber}</p>
                            <p className="text-xs text-muted-foreground">
                              {order.customerName}
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-end">
                        <span
                          className={
                            codSettled
                              ? "text-muted-foreground/50 line-through"
                              : "font-semibold text-amber-600"
                          }
                        >
                          {formatDeliveryMoney(order.codAmount, locale)}
                        </span>
                        {codSettled && (
                          <span className="ms-1 text-[10px] font-bold text-violet-600">
                            ✓
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-end">
                        {order.driverFee > 0 ? (
                          <span
                            className={
                              feeSettled
                                ? "text-muted-foreground/50 line-through"
                                : "font-semibold"
                            }
                          >
                            {formatDeliveryMoney(order.driverFee, locale)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground/30">—</span>
                        )}
                        {feeSettled && order.driverFee > 0 && (
                          <span className="ms-1 text-[10px] font-bold text-violet-600">
                            ✓
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-end text-muted-foreground">
                        {formatDeliveryDate(order.deliveredAt, locale)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </>
      )}
      {showHistory && (
        <div className="mt-4 border-t border-border pt-4">
          <h3 className="mb-3 text-sm font-semibold text-foreground">
            {t("payments.tab_history")}
          </h3>
          {historyLoading ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {t("payments.loading")}
            </p>
          ) : history === null || history.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {t("payments.no_history")}
            </p>
          ) : (
            <div className="space-y-2">
              {history.map((payment) => (
                <div
                  key={payment.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/30 p-3"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold">
                      {t(`payments.type_${payment.type}`)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      #{payment.orderCount}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-bold tabular-nums">
                      {formatDeliveryMoney(payment.amount, locale)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {payment.createdByName}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatDeliveryDate(payment.createdAt, locale)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
