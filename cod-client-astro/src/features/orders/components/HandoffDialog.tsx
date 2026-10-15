import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Building2, Check, Search, Send, Truck } from "lucide-react";
import { useLocale, useT } from "@/i18n/react";
import { notify } from "@/lib/notify";
import { handOffOrder, listStopDesks, type CarrierHandoff, type DriverHandoff } from "@/features/orders/api";
import { carriersFor, driversFor, formatMoney, orderTotal } from "@/features/orders/model";
import type { DeliveryCompany, DeliveryType, Driver, HandoffItem, OrderBase, StopDesk } from "@/features/orders/types";
import { Button, Dialog, Field, Input, LinkButton, Select, Textarea } from "@/components/ui";

type HandoffOrder = Pick<OrderBase, "id" | "orderNumber" | "wilaya" | "wilayaId" | "commune" | "address" | "deliveryType" | "price" | "deliveryFee">;

function Choice({ selected, onSelect, children }: { selected: boolean; onSelect: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={`flex min-h-11 w-full items-center gap-2 rounded-lg border px-3 text-start text-sm font-semibold transition-colors ${
        selected ? "border-primary bg-primary/10 text-foreground" : "border-border hover:bg-muted"
      }`}
    >
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {selected && <Check size={15} className="shrink-0 text-primary" />}
    </button>
  );
}

function DeskPicker({ company, order, value, onChange }: { company: DeliveryCompany; order: HandoffOrder; value: string; onChange: (code: string) => void }) {
  const t = useT("orders");
  const [desks, setDesks] = useState<StopDesk[] | null>(null);
  const [query, setQuery] = useState("");
  const listed = company.capabilities?.stopDeskList ?? false;

  useEffect(() => {
    if (!listed || !order.wilayaId) {
      setDesks([]);
      return;
    }
    let alive = true;
    setDesks(null);
    listStopDesks(company.id, order.wilayaId)
      .then((rows) => {
        if (!alive) return;
        setDesks(rows);
        const near = rows.find((desk) => desk.commune && desk.commune.toLocaleLowerCase() === order.commune?.toLocaleLowerCase());
        if (near && !value) onChange(near.code);
      })
      .catch(() => alive && setDesks([]));
    return () => {
      alive = false;
    };
  }, [company.id, listed, order.wilayaId]);

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return needle ? (desks ?? []).filter((desk) => `${desk.code} ${desk.name} ${desk.commune ?? ""}`.toLocaleLowerCase().includes(needle)) : desks ?? [];
  }, [desks, query]);

  if (desks === null) return <p role="status" className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">{t("ship.loading_desks")}</p>;
  if (listed && desks.length === 0) {
    return (
      <p role="alert" className="rounded-lg border border-border bg-muted/50 p-3 text-sm font-medium">
        {t("ship.no_desks", { carrier: company.name, wilaya: order.wilaya ?? "-" })}
      </p>
    );
  }
  return (
    <div className="space-y-2">
      {desks.length > 0 && (
        <>
          <label className="relative block">
            <Search size={15} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder={t("ship.search_desks")} className="ps-9" />
          </label>
          <div role="radiogroup" className="max-h-44 space-y-1 overflow-y-auto rounded-lg border border-border p-1.5">
            {visible.map((desk) => (
              <Choice key={desk.code} selected={value === desk.code} onSelect={() => onChange(desk.code)}>
                <span className="font-mono text-xs text-primary">{desk.code}</span> {desk.name}
                {desk.commune ? ` · ${desk.commune}` : ""}
              </Choice>
            ))}
          </div>
        </>
      )}
      <Input value={value} onChange={(event) => onChange(event.currentTarget.value)} placeholder={t("ship.desk_code")} aria-label={t("ship.desk_code")} className="font-mono" />
    </div>
  );
}

/**
 * Shipping one ready order: to a delivery company, or to one of the store's
 * drivers. Only the carriers that can take this parcel now are offered, with
 * the fields each one takes. When a carrier does not confirm, the merchant
 * is told plainly not to ship again — the order page resolves it.
 */
export function HandoffDialog({
  order,
  kinds,
  companies,
  drivers,
  onClose,
  onDone,
}: {
  order: HandoffOrder;
  kinds: Array<"carrier" | "driver">;
  companies: DeliveryCompany[];
  drivers: Driver[];
  onClose: () => void;
  onDone: () => void | Promise<void>;
}) {
  const t = useT("orders");
  const locale = useLocale();
  const [kind, setKind] = useState<"carrier" | "driver">(kinds[0] ?? "carrier");
  const [deliveryType, setDeliveryType] = useState<DeliveryType>(order.deliveryType);
  const [companyId, setCompanyId] = useState("");
  const [driverId, setDriverId] = useState("");
  const [stationCode, setStationCode] = useState("");
  const [weight, setWeight] = useState("");
  const [fragile, setFragile] = useState(false);
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unknown, setUnknown] = useState<Extract<HandoffItem, { outcome: "unknown" }> | null>(null);

  const carriers = carriersFor(companies, deliveryType);
  const available = driversFor(drivers);
  const company = carriers.find((item) => item.id === companyId) ?? null;
  const fields = company?.capabilities?.parcelFields ?? { weight: false, fragile: false, remarks: false };
  const stopDesk = deliveryType === "stop_desk";
  const missingAddress = !stopDesk && !order.address?.trim();
  const ready =
    !missingAddress &&
    (kind === "carrier" ? Boolean(company) && (!stopDesk || stationCode.trim() !== "") : available.some((driver) => driver.id === driverId));

  useEffect(() => {
    if (companyId && !carriers.some((item) => item.id === companyId)) setCompanyId("");
    setStationCode("");
  }, [deliveryType]);

  async function submit() {
    setBusy(true);
    setError(null);
    const typeOverride = deliveryType !== order.deliveryType ? { deliveryType } : {};
    const desk = stopDesk && stationCode.trim() ? { stationCode: stationCode.trim() } : {};
    const parsedWeight = Number(weight);
    const handoff: CarrierHandoff | DriverHandoff =
      kind === "carrier"
        ? {
            kind,
            companyId,
            ...typeOverride,
            ...desk,
            ...(fields.weight && parsedWeight > 0 ? { weight: parsedWeight } : {}),
            ...(fields.fragile && fragile ? { fragile: true } : {}),
            ...(fields.remarks && remarks.trim() ? { remarks: remarks.trim() } : {}),
          }
        : { kind, driverId, ...typeOverride, ...desk };
    try {
      const result = await handOffOrder(order.id, handoff);
      await onDone();
      if (result.outcome === "unknown") {
        setUnknown(result);
        return;
      }
      if (result.outcome === "accepted") {
        if (result.shipment.kind === "driver") {
          const driver = available.find((item) => item.id === driverId);
          notify.success(t("ship.given_to_driver", { order: order.orderNumber, driver: driver ? `${driver.firstName} ${driver.lastName}` : "" }));
        } else {
          notify.success(
            result.shipment.trackingNumber
              ? t("ship.handed_to_carrier", { order: order.orderNumber, carrier: result.shipment.carrierName ?? "", tracking: result.shipment.trackingNumber })
              : t("ship.handed_to_carrier_no_tracking", { order: order.orderNumber, carrier: result.shipment.carrierName ?? "" }),
          );
          if (result.validationError) notify.error(t("ship.validation_failed", { reason: result.validationError }));
        }
      }
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  if (unknown) {
    return (
      <Dialog title={t("ship.unknown_title")} onClose={onClose} icon={<AlertTriangle size={18} className="text-warning" />}>
        <div className="space-y-4 text-sm">
          <p className="font-semibold text-foreground">{t("ship.unknown_lead", { carrier: unknown.shipment.carrierName ?? t("delivery.a_carrier"), order: order.orderNumber })}</p>
          <p className="text-muted-foreground">{t("ship.unknown_body")}</p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              {t("ship.close")}
            </Button>
            <LinkButton href={`/orders/${order.id}`}>{t("ship.open_to_resolve")}</LinkButton>
          </div>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog title={t("ship.title", { order: order.orderNumber })} onClose={onClose}>
      <p className="mb-4 text-xs font-medium text-muted-foreground">
        {order.wilaya ?? "-"}
        {order.commune ? ` · ${order.commune}` : ""} · {t("ship.to_collect", { amount: formatMoney(orderTotal(order), locale) })}
      </p>
      <div className="space-y-4">
        {kinds.length > 1 && (
          <div role="radiogroup" aria-label={t("ship.who")} className="grid grid-cols-2 gap-2">
            <Choice selected={kind === "carrier"} onSelect={() => setKind("carrier")}>
              <span className="inline-flex items-center gap-2">
                <Building2 size={15} />
                {t("ship.to_carrier")}
              </span>
            </Choice>
            <Choice selected={kind === "driver"} onSelect={() => setKind("driver")}>
              <span className="inline-flex items-center gap-2">
                <Truck size={15} />
                {t("ship.to_driver")}
              </span>
            </Choice>
          </div>
        )}

        <Field label={t("ship.delivery_type")}>
          <Select value={deliveryType} onChange={(event) => setDeliveryType(event.currentTarget.value === "stop_desk" ? "stop_desk" : "home")}>
            <option value="home">{t("delivery_type.home")}</option>
            <option value="stop_desk">{t("delivery_type.stop_desk")}</option>
          </Select>
          {deliveryType !== order.deliveryType && <p className="mt-1.5 text-xs font-medium text-muted-foreground">{t("ship.type_changed")}</p>}
        </Field>

        {kind === "carrier" ? (
          <>
            <Field label={t("ship.choose_carrier")}>
              {carriers.length === 0 ? (
                <div role="alert" className="rounded-lg border border-border bg-muted/50 p-3 text-sm">
                  <p className="font-semibold">{t(stopDesk ? "ship.no_carrier_desk" : "ship.no_carrier")}</p>
                  <a href="/delivery/companies" className="mt-1 inline-block text-xs font-semibold text-link underline-offset-4 hover:underline">
                    {t("ship.manage_carriers")}
                  </a>
                </div>
              ) : (
                <div role="radiogroup" className="space-y-1.5">
                  {carriers.map((item) => (
                    <Choice key={item.id} selected={companyId === item.id} onSelect={() => setCompanyId(item.id)}>
                      {item.name}
                    </Choice>
                  ))}
                </div>
              )}
            </Field>
            {company && stopDesk && (
              <Field label={t("ship.desk")}>
                <DeskPicker company={company} order={order} value={stationCode} onChange={setStationCode} />
              </Field>
            )}
            {company && fields.remarks && (
              <Field label={t("ship.remarks")}>
                <Textarea value={remarks} onChange={(event) => setRemarks(event.currentTarget.value)} maxLength={500} placeholder={t("ship.remarks_placeholder")} />
              </Field>
            )}
            {company && (fields.weight || fields.fragile) && (
              <div className="flex items-end gap-4">
                {fields.weight && (
                  <Field label={t("ship.weight")}>
                    <Input type="number" min="0" step="0.1" value={weight} onChange={(event) => setWeight(event.currentTarget.value)} />
                  </Field>
                )}
                {fields.fragile && (
                  <label className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
                    <input type="checkbox" checked={fragile} onChange={(event) => setFragile(event.currentTarget.checked)} />
                    {t("ship.fragile")}
                  </label>
                )}
              </div>
            )}
          </>
        ) : (
          <>
            <Field label={t("ship.choose_driver")}>
              {available.length === 0 ? (
                <div role="alert" className="rounded-lg border border-border bg-muted/50 p-3 text-sm">
                  <p className="font-semibold">{t("ship.no_driver")}</p>
                  <a href="/delivery/drivers" className="mt-1 inline-block text-xs font-semibold text-link underline-offset-4 hover:underline">
                    {t("ship.manage_drivers")}
                  </a>
                </div>
              ) : (
                <div role="radiogroup" className="max-h-56 space-y-1.5 overflow-y-auto">
                  {available.map((driver) => (
                    <Choice key={driver.id} selected={driverId === driver.id} onSelect={() => setDriverId(driver.id)}>
                      {driver.firstName} {driver.lastName}
                      {driver.status === "busy" && <span className="ms-2 text-xs font-medium text-muted-foreground">{t("ship.driver_busy")}</span>}
                    </Choice>
                  ))}
                </div>
              )}
            </Field>
            {stopDesk && (
              <Field label={t("ship.desk")}>
                <Input value={stationCode} onChange={(event) => setStationCode(event.currentTarget.value)} placeholder={t("ship.desk_code")} className="font-mono" />
              </Field>
            )}
          </>
        )}

        {missingAddress && (
          <div role="alert" className="rounded-lg border border-border bg-muted/50 p-3 text-sm">
            <p className="font-semibold text-foreground">{t("ship.missing_address_title")}</p>
            <p className="mt-0.5 text-xs font-medium text-muted-foreground">{t("ship.missing_address_hint")}</p>
          </div>
        )}
        {error && (
          <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm font-medium text-destructive">
            {error}
          </p>
        )}
        <Button type="button" className="w-full" disabled={!ready || busy} onClick={() => void submit()}>
          <Send size={16} />
          {busy ? t("ship.sending") : kind === "carrier" ? t("ship.submit_carrier") : t("ship.submit_driver")}
        </Button>
      </div>
    </Dialog>
  );
}
