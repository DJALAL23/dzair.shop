import { useEffect, useState } from "react";
import { Button, Dialog } from "@/components/ui";
import { useT } from "@/i18n/react";
import { handOffToDriver, listOrders } from "@/features/orders/api";
import { driverErrorMessage, driverFullName } from "@/features/delivery/model";
import type { Driver } from "@/features/delivery/types";
import type { BulkHandoff, OrderListItem } from "@/features/orders/types";
import { notify } from "@/lib/notify";

/**
 * Giving ready orders to one driver at once: every order waiting to be
 * shipped, picked with a checkbox, handed over in one request. Each order
 * ends on its own — the result names any the server refused, and why.
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
  const refused = result?.results.filter((item) => item.outcome === "refused") ?? [];

  return (
    <Dialog onClose={close} title={<span>{t("assign_dialog.title")} — {driverFullName(driver)}</span>} className="max-w-lg">
      {result ? (
        <div className="space-y-3 text-sm">
          <p className="font-semibold">{t("assign_dialog.given", { count: result.summary.accepted })}</p>
          {refused.length > 0 && (
            <ul className="max-h-56 divide-y divide-border overflow-y-auto rounded-lg border border-border">
              {refused.map((item) => (
                <li key={item.orderId} className="flex items-start justify-between gap-3 p-2.5">
                  <span className="shrink-0 font-semibold">{item.orderNumber ?? item.orderId}</span>
                  <span className="text-end text-xs text-muted-foreground">{item.outcome === "refused" ? item.error.message : ""}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="flex justify-end">
            <Button type="button" onClick={onClose}>
              {t("assign_dialog.done")}
            </Button>
          </div>
        </div>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">{t("assign_dialog.select_orders")}</p>
          {error && <p className="text-sm font-semibold text-destructive">{error}</p>}
          {orders === null ? (
            <p role="status" className="py-8 text-center text-sm text-muted-foreground">
              {t("assign_dialog.loading")}
            </p>
          ) : orders.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">{t("assign_dialog.no_ready_orders")}</p>
          ) : (
            <div className="max-h-72 space-y-1.5 overflow-y-auto">
              {orders.map((order) => (
                <label key={order.id} className="flex cursor-pointer items-center gap-3 rounded-lg border border-border p-3 transition-colors hover:bg-muted/30">
                  <input
                    type="checkbox"
                    checked={selected.includes(order.id)}
                    onChange={(event) => {
                      const checked = event.currentTarget.checked;
                      setSelected((current) => (checked ? [...current, order.id] : current.filter((id) => id !== order.id)));
                    }}
                    disabled={loading}
                    className="size-4 accent-primary"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{order.orderNumber}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {order.customerName} · {order.wilaya || "-"}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          )}
          <div className="flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={close} disabled={loading}>
              {t("assign_dialog.cancel")}
            </Button>
            <Button type="button" onClick={() => void give()} disabled={loading || selected.length === 0}>
              {t("assign_dialog.assign", { count: selected.length })}
            </Button>
          </div>
        </>
      )}
    </Dialog>
  );
}
