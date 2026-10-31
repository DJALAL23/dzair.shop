import { useEffect, useState } from "react";
import { Printer } from "lucide-react";
import { Button, Dialog, LinkButton } from "@/components/ui";
import { useT } from "@/i18n/react";
import { handOffToDriver, listOrders } from "@/features/orders/api";
import { driverHandoffPlan } from "@/features/orders/model";
import { printLabelsHref } from "@/features/shipping-labels/model";
import { driverErrorMessage, driverFullName } from "@/features/delivery/model";
import type { Driver } from "@/features/delivery/types";
import type { BulkHandoff, OrderListItem } from "@/features/orders/types";
import { notify } from "@/lib/notify";

/**
 * Giving ready orders to one driver at once: every order waiting to be
 * shipped, picked with a checkbox, handed over in one request. The driver
 * brings each parcel to the customer's address, so an order with no address
 * cannot be picked, and one whose customer chose a stop desk says it goes to
 * the door instead. Each order ends on its own — the result names any the
 * server refused, and why.
 */
export function AssignOrdersDialog({ driver, onClose, onDone }: { driver: Driver; onClose: () => void; onDone: () => void | Promise<void> }) {
  const t = useT("delivery");
  const [orders, setOrders] = useState<OrderListItem[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BulkHandoff | null>(null);

  useEffect(() => {
    listOrders({ stages: ["ready_to_ship"], limit: 100 })
      .then((page) => setOrders(page.orders))
      .catch((cause) => {
        setOrders([]);
        setError(driverErrorMessage(cause, t));
      });
  }, []);

  async function give() {
    setLoading(true);
    setError(null);
    try {
      const outcome = await handOffToDriver(driver.id, selected);
      setResult(outcome);
      if (outcome.summary.accepted > 0) notify.success(t("assign_dialog.given", { count: outcome.summary.accepted }));
      await onDone();
    } catch (cause) {
      const message = driverErrorMessage(cause, t);
      setError(message);
      notify.error(message);
    } finally {
      setLoading(false);
    }
  }

  const close = () => !loading && onClose();
  const plan = driverHandoffPlan(orders ?? []);
  const pickable = plan.deliverable.map((order) => order.id);
  const allPicked = pickable.length > 0 && pickable.every((id) => selected.includes(id));
  const refused = result?.results.filter((item) => item.outcome === "refused") ?? [];
  const printable = result?.results.flatMap((item) => (item.outcome === "accepted" && item.shipment ? [item.shipment.id] : [])) ?? [];

  return (
    <Dialog
      onClose={close}
      placement="end"
      title={t("assign_dialog.title")}
      description={driverFullName(driver)}
      footer={
        result ? (
          <>
            {printable.length > 0 && (
              <LinkButton href={printLabelsHref({ shipmentIds: printable })} target="_blank" rel="noopener" variant="secondary">
                <Printer size={15} aria-hidden="true" />
                {t("labels.actions.print_labels", { count: printable.length })}
              </LinkButton>
            )}
            <Button type="button" onClick={onClose}>
              {t("assign_dialog.done")}
            </Button>
          </>
        ) : (
          <>
            <Button type="button" variant="secondary" onClick={close} disabled={loading}>
              {t("assign_dialog.cancel")}
            </Button>
            <Button type="button" onClick={() => void give()} disabled={loading || selected.length === 0}>
              {t("assign_dialog.assign", { count: selected.length })}
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="space-y-3 text-sm">
          <p className="font-semibold">{t("assign_dialog.given", { count: result.summary.accepted })}</p>
          {refused.length > 0 && (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {refused.map((item) => (
                <li key={item.orderId} className="flex items-start justify-between gap-3 p-2.5">
                  <span className="shrink-0 font-semibold">{item.orderNumber ?? item.orderId}</span>
                  <span className="text-end text-xs text-muted-foreground">{item.outcome === "refused" ? item.error.message : ""}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">{t("assign_dialog.select_orders")}</p>
          <p className="text-xs font-medium text-muted-foreground">{t("assign_dialog.driver_to_door")}</p>
          {error && <p className="text-sm font-semibold text-destructive">{error}</p>}
          {orders === null ? (
            <p role="status" className="py-8 text-center text-sm text-muted-foreground">
              {t("assign_dialog.loading")}
            </p>
          ) : orders.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">{t("assign_dialog.no_ready_orders")}</p>
          ) : (
            <div className="space-y-1.5">
              {pickable.length > 1 && (
                <label className="flex cursor-pointer items-center gap-3 px-3 text-sm font-semibold">
                  <input
                    type="checkbox"
                    checked={allPicked}
                    onChange={(event) => setSelected(event.currentTarget.checked ? pickable : [])}
                    disabled={loading}
                    className="size-4 accent-primary"
                  />
                  {t("assign_dialog.select_all")}
                </label>
              )}
              <div className="space-y-1.5">
                {orders.map((order) => {
                  const noAddress = !order.address?.trim();
                  return (
                    <label
                      key={order.id}
                      className={`flex items-center gap-3 rounded-lg border border-border p-3 transition-colors ${noAddress ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-muted/30"}`}
                    >
                      <input
                        type="checkbox"
                        checked={selected.includes(order.id)}
                        onChange={(event) => {
                          const checked = event.currentTarget.checked;
                          setSelected((current) => (checked ? [...current, order.id] : current.filter((id) => id !== order.id)));
                        }}
                        disabled={loading || noAddress}
                        className="size-4 accent-primary"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">{order.orderNumber}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {order.customerName} · {order.wilaya || "-"}
                        </span>
                        {(noAddress || order.deliveryType === "stop_desk") && (
                          <span className={`mt-0.5 block text-xs font-medium ${noAddress ? "text-destructive" : "text-muted-foreground"}`}>
                            {t(noAddress ? "assign_dialog.no_address" : "assign_dialog.desk_to_door")}
                          </span>
                        )}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}
