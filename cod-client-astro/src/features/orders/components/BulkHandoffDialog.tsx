import { useState } from "react";
import { AlertTriangle, Building2, Check, Send, Truck, XCircle } from "lucide-react";
import { useT } from "@/i18n/react";
import { notify } from "@/lib/notify";
import { handOffToCarrier, handOffToDriver } from "@/features/orders/api";
import { carriersForAll, driversFor } from "@/features/orders/model";
import type { BulkHandoff, DeliveryCompany, Driver, OrderListItem } from "@/features/orders/types";
import { Button, Dialog, Field } from "@/components/ui";

function Choice({ selected, onSelect, children }: { selected: boolean; onSelect: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={`flex min-h-11 w-full items-center gap-2 rounded-lg border px-3 text-start text-sm font-semibold ${
        selected ? "border-primary bg-primary/10" : "border-border hover:bg-muted"
      }`}
    >
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {selected && <Check size={15} className="text-primary" />}
    </button>
  );
}

/**
 * Shipping the selected ready orders together, each as the customer asked
 * (home or desk): to one carrier, or to one driver. Each order ends on its
 * own — the result says which were handed off, which the carrier did not
 * confirm (never ship those again), and why any were refused.
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
  const [kind, setKind] = useState<"carrier" | "driver">(kinds[0] ?? "carrier");
  const [targetId, setTargetId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BulkHandoff | null>(null);
  const carriers = carriersForAll(companies, orders.map((order) => order.deliveryType));
  const available = driversFor(drivers);
  const options = kind === "carrier" ? carriers.map((c) => ({ id: c.id, label: c.name })) : available.map((d) => ({ id: d.id, label: `${d.firstName} ${d.lastName}` }));

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const ids = orders.map((order) => order.id);
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
          <div className="flex justify-end">
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
              <span className="inline-flex items-center gap-2">
                <Building2 size={15} />
                {t("ship.to_carrier")}
              </span>
            </Choice>
            <Choice selected={kind === "driver"} onSelect={() => (setKind("driver"), setTargetId(""))}>
              <span className="inline-flex items-center gap-2">
                <Truck size={15} />
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
        <p className="text-xs font-medium text-muted-foreground">{t("bulk.as_asked")}</p>
        {error && (
          <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm font-medium text-destructive">
            {error}
          </p>
        )}
        <Button type="button" className="w-full" disabled={!targetId || busy} onClick={() => void submit()}>
          <Send size={16} />
          {busy ? t("ship.sending") : t("bulk.submit", { count: orders.length })}
        </Button>
      </div>
    </Dialog>
  );
}
