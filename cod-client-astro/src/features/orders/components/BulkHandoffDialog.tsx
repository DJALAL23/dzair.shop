import { useState } from "react";
import { AlertTriangle, Building2, Check, MapPin, Printer, Send, Truck, XCircle } from "lucide-react";
import { useT } from "@/i18n/react";
import { notify } from "@/lib/notify";
import { handOffToCarrier, handOffToDriver } from "@/features/orders/api";
import { carriersForAll, driverHandoffPlan, driversFor } from "@/features/orders/model";
import type { BulkHandoff, DeliveryCompany, Driver, OrderListItem } from "@/features/orders/types";
import { Button, Dialog, Field, LinkButton } from "@/components/ui";
import { printLabelsHref } from "@/features/shipping-labels/model";
import { Choice } from "@/features/orders/components/HandoffDialog";

/**
 * Shipping the selected ready orders together: to one carrier, each as the
 * customer asked (home or desk), or to one of the store's drivers, who
 * brings every parcel to the customer's address — an order with no address
 * is left out and named, and a customer who chose a desk is told apart.
 * Each order ends on its own — the result says which were handed off, which
 * the carrier did not confirm (never ship those again), and why any were
 * refused.
 */
export function BulkHandoffDialog({
  orders,
  kinds,
  companies,
  drivers,
  onClose,
  onDone,
}: {
  orders: OrderListItem[];
  kinds: Array<"carrier" | "driver">;
  companies: DeliveryCompany[];
  drivers: Driver[];
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useT("orders");
  const delivery = useT("delivery");
  const [kind, setKind] = useState<"carrier" | "driver">(kinds[0] ?? "carrier");
  const [targetId, setTargetId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BulkHandoff | null>(null);
  const carriers = carriersForAll(companies, orders.map((order) => order.deliveryType));
  const available = driversFor(drivers);
  const options = kind === "carrier" ? carriers.map((c) => ({ id: c.id, label: c.name })) : available.map((d) => ({ id: d.id, label: `${d.firstName} ${d.lastName}` }));
  const plan = driverHandoffPlan(orders);
  const sending = kind === "driver" ? plan.deliverable : orders;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const ids = sending.map((order) => order.id);
      const outcome = kind === "carrier" ? await handOffToCarrier(targetId, ids) : await handOffToDriver(targetId, ids);
      setResult(outcome);
      if (outcome.summary.accepted > 0) notify.success(t("bulk.accepted_count", { count: outcome.summary.accepted }));
      onDone();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    const { accepted, unknown, refused } = result.summary;
    const printable = result.results.flatMap((item) => (item.outcome === "accepted" && item.shipment ? [item.shipment.id] : []));
    return (
      <Dialog title={t("bulk.result_title")} onClose={onClose}>
        <div className="space-y-4 text-sm">
          <ul className="space-y-1.5 font-semibold">
            {accepted > 0 && (
              <li className="flex items-center gap-2 text-success">
                <Check size={15} />
                {t("bulk.accepted_count", { count: accepted })}
              </li>
            )}
            {unknown > 0 && (
              <li className="flex items-center gap-2 text-warning">
                <AlertTriangle size={15} />
                {t("bulk.unknown_count", { count: unknown })}
              </li>
            )}
            {refused > 0 && (
              <li className="flex items-center gap-2 text-destructive">
                <XCircle size={15} />
                {t("bulk.refused_count", { count: refused })}
              </li>
            )}
          </ul>
          {unknown > 0 && <p className="text-muted-foreground">{t("bulk.unknown_hint")}</p>}
          {kind === "driver" && plan.missingAddress.length > 0 && <LeftOut orders={plan.missingAddress} />}
          {result.results.some((item) => item.outcome !== "accepted") && (
            <ul className="max-h-56 divide-y divide-border overflow-y-auto rounded-lg border border-border">
              {result.results
                .filter((item) => item.outcome !== "accepted")
                .map((item) => (
                  <li key={item.orderId} className="flex items-start justify-between gap-3 p-2.5">
                    <a href={`/orders/${item.orderId}`} className="shrink-0 font-semibold text-link hover:underline">
                      {item.orderNumber ?? item.orderId}
                    </a>
                    <span className="text-end text-xs text-muted-foreground">{item.outcome === "refused" ? item.error.message : t("bulk.unconfirmed")}</span>
                  </li>
                ))}
            </ul>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            {kind === "driver" && printable.length > 0 && (
              <LinkButton href={printLabelsHref({ shipmentIds: printable })} target="_blank" rel="noopener" variant="secondary">
                <Printer size={15} aria-hidden="true" />
                {delivery("labels.actions.print_labels", { count: printable.length })}
              </LinkButton>
            )}
            <Button type="button" onClick={onClose}>
              {t("ship.close")}
            </Button>
          </div>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog title={t("bulk.title", { count: orders.length })} onClose={onClose}>
      <div className="space-y-4">
        {kinds.length > 1 && (
          <div role="radiogroup" aria-label={t("ship.who")} className="grid grid-cols-2 gap-2">
            <Choice selected={kind === "carrier"} onSelect={() => (setKind("carrier"), setTargetId(""))}>
              <span className="flex items-center gap-2">
                <Building2 size={15} className="shrink-0" />
                {t("ship.to_carrier")}
              </span>
            </Choice>
            <Choice selected={kind === "driver"} onSelect={() => (setKind("driver"), setTargetId(""))}>
              <span className="flex items-center gap-2">
                <Truck size={15} className="shrink-0" />
                {t("ship.to_driver")}
              </span>
            </Choice>
          </div>
        )}
        <Field label={kind === "carrier" ? t("ship.choose_carrier") : t("ship.choose_driver")}>
          {options.length === 0 ? (
            <p role="alert" className="rounded-lg border border-border bg-muted/50 p-3 text-sm font-semibold">
              {kind === "carrier" ? t("bulk.no_carrier") : t("ship.no_driver")}
            </p>
          ) : (
            <div role="radiogroup" className="max-h-56 space-y-1.5 overflow-y-auto">
              {options.map((option) => (
                <Choice key={option.id} selected={targetId === option.id} onSelect={() => setTargetId(option.id)}>
                  {option.label}
                </Choice>
              ))}
            </div>
          )}
        </Field>
        {kind === "carrier" ? (
          <p className="text-xs font-medium text-muted-foreground">{t("bulk.as_asked")}</p>
        ) : (
          <div className="space-y-2">
            {plan.missingAddress.length > 0 && <LeftOut orders={plan.missingAddress} />}
            {plan.deskToDoor.length > 0 && (
              <p className="flex items-start gap-2 rounded-lg bg-muted/50 p-3 text-xs font-medium text-muted-foreground">
                <MapPin size={14} className="mt-px shrink-0" aria-hidden="true" />
                {t("bulk.driver_desk_to_door", { count: plan.deskToDoor.length })}
              </p>
            )}
          </div>
        )}
        {error && (
          <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm font-medium text-destructive">
            {error}
          </p>
        )}
        <Button type="button" className="w-full" disabled={!targetId || busy || sending.length === 0} onClick={() => void submit()}>
          <Send size={16} />
          {busy ? t("ship.sending") : t("bulk.submit", { count: sending.length })}
        </Button>
      </div>
    </Dialog>
  );
}

/** The orders a driver cannot take: no street address to bring them to. */
function LeftOut({ orders }: { orders: OrderListItem[] }) {
  const t = useT("orders");
  return (
    <div role="alert" className="rounded-lg border border-border bg-muted/50 p-3 text-xs font-medium">
      <p className="text-foreground">{t("bulk.driver_missing_address", { count: orders.length })}</p>
      <p className="mt-1 flex flex-wrap gap-x-2 gap-y-1">
        {orders.map((order) => (
          <a key={order.id} href={`/orders/${encodeURIComponent(order.id)}`} className="font-semibold text-link hover:underline">
            {order.orderNumber}
          </a>
        ))}
      </p>
    </div>
  );
}
