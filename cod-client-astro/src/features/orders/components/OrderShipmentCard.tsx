import { useState } from "react";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  Download,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Printer,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  Truck,
  Undo2,
  XCircle,
} from "lucide-react";
import { canScope, useIdentity } from "@/features/auth/components/RequireAuth";
import { useLocale, useT } from "@/i18n/react";
import { notify } from "@/lib/notify";
import { relativeTime } from "@/lib/relative-time";
import { Button, Card, DropdownItem, DropdownMenu, DropdownSeparator, useConfirmDialog } from "@/components/ui";
import { buttonVariants } from "@/components/ui/button";
import {
  askReturn,
  confirmReturn,
  downloadLabel,
  requestNewAttempt,
  syncShipment,
  validateShipment,
  voidShipment,
} from "@/features/orders/api";
import { attentionReason, deliveryTimeline, eventLabel, formatMoney, latestStatusLabel, offeredActions } from "@/features/orders/model";
import type { DeliveryCompany, OrderDetail, Shipment, ShipmentAction } from "@/features/orders/types";
import { EditParcelDialog, RemarksDialog, ReportDialog, ResolveDialog } from "@/features/orders/components/ShipmentDialogs";
import { printLabelsHref } from "@/features/shipping-labels/model";

type Open = "report" | "resolve" | "parcel" | "remarks" | null;

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-end text-foreground">{children}</dd>
    </div>
  );
}

/** Why the delivery needs the merchant, and what to do about it. */
function AttentionBanner({ shipment }: { shipment: Shipment }) {
  const t = useT("orders");
  const reason = attentionReason(shipment);
  if (!reason) return null;
  const carrier = shipment.carrierName ?? t("delivery.a_carrier");
  const text =
    reason.kind === "unknown_handoff"
      ? t("attention.unknown_handoff", { carrier })
      : reason.kind === "cancelled_by_carrier"
        ? t("attention.cancelled_by_carrier", { carrier })
        : reason.detail
          ? t("attention.flagged_with", { carrier, detail: reason.detail })
          : t("attention.flagged", { carrier });
  return (
    <div role="alert" className="flex gap-2 rounded-lg border border-[var(--tone-critical-border)] bg-[var(--tone-critical-bg)] p-3 text-sm font-medium text-[var(--tone-critical-text)]">
      <AlertTriangle size={16} className="mt-0.5 shrink-0" />
      <p>{text}</p>
    </div>
  );
}

/** The delivery's history: what the carrier reported, what the merchant did, what CodFlow concluded. */
function DeliveryHistory({ shipment }: { shipment: Shipment }) {
  const t = useT("orders");
  const locale = useLocale();
  const events = deliveryTimeline(shipment);
  if (events.length === 0) return <p className="text-sm text-muted-foreground">{t("history.none")}</p>;
  return (
    <ol className="space-y-3">
      {events.map((event) => {
        const label = eventLabel(event);
        return (
          <li key={event.id} className="flex gap-3">
            <span className={`mt-1.5 size-2 shrink-0 rounded-full ${event.attention ? "bg-destructive" : event.milestone ? "bg-primary" : "bg-border"}`} />
            <div className="min-w-0">
              <p className="text-sm font-medium">{"key" in label ? t(label.key) : label.text}</p>
              {event.reason && <p className="text-xs text-foreground/80">{event.reason}</p>}
              <p className="text-xs text-muted-foreground">
                {new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(event.occurredAt))} · {t(`history.source.${event.source}`)}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The order's delivery: who carries it, its tracking number, the cash to
 * collect, the latest status and its history — and only the actions the
 * carrier allows now that this person may take.
 */
export function OrderShipmentCard({
  order,
  shipment,
  companies,
  onChanged,
}: {
  order: OrderDetail;
  shipment: Shipment;
  companies: DeliveryCompany[];
  onChanged: () => void | Promise<void>;
}) {
  const t = useT("orders");
  const delivery = useT("delivery");
  const locale = useLocale();
  const identity = useIdentity();
  const confirm = useConfirmDialog();
  const [open, setOpen] = useState<Open>(null);
  const [busy, setBusy] = useState<ShipmentAction | null>(null);
  const actions = new Set(offeredActions(shipment, (scope) => canScope(identity, scope)));
  const carrier = shipment.carrierName ?? t("delivery.a_carrier");
  const latest = latestStatusLabel(shipment);
  const fields = companies.find((company) => company.id === shipment.companyId)?.capabilities?.parcelFields ?? { weight: false, fragile: false, remarks: false };

  async function run(action: ShipmentAction, call: () => Promise<unknown>, done: string, ask?: { title: string; description: string; label: string; danger?: boolean }) {
    if (ask && !(await confirm({ title: ask.title, description: ask.description, confirmLabel: ask.label, tone: ask.danger ? "danger" : "default" }))) return;
    setBusy(action);
    try {
      await call();
      notify.success(done);
      await onChanged();
    } catch (cause) {
      notify.error(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }

  const voidKey = shipment.kind === "carrier" ? "void_carrier" : "void_driver";
  const steps: { action: ShipmentAction; icon: React.ReactNode; label: string; onSelect: () => void }[] = [
    { action: "resolve", icon: <Search size={14} />, label: t("actions.resolve"), onSelect: () => setOpen("resolve") },
    {
      action: "validate",
      icon: <CheckCircle2 size={14} />,
      label: t("actions.validate"),
      onSelect: () =>
        void run("validate", () => validateShipment(shipment.id), t("actions.validate_done", { carrier }), {
          title: t("actions.validate"),
          description: t("actions.validate_confirm", { carrier }),
          label: t("actions.validate"),
        }),
    },
    {
      action: "confirmReturn",
      icon: <CheckCircle2 size={14} />,
      label: t("actions.confirm_return"),
      onSelect: () =>
        void run("confirmReturn", () => confirmReturn(shipment.id), t("actions.confirm_return_done"), {
          title: t("actions.confirm_return"),
          description: t("actions.confirm_return_confirm", { carrier }),
          label: t("actions.confirm_return"),
        }),
    },
    { action: "report", icon: <Send size={14} />, label: t(`report.${shipment.kind}.title`), onSelect: () => setOpen("report") },
    shipment.kind === "driver"
      ? { action: "label", icon: <Printer size={14} />, label: delivery("labels.actions.print_label"), onSelect: () => window.open(printLabelsHref({ shipmentIds: [shipment.id] }), "_blank") }
      : { action: "label", icon: <Download size={14} />, label: t("actions.label"), onSelect: () => void run("label", () => downloadLabel(shipment), t("actions.label_done")) },
    { action: "sync", icon: <RefreshCw size={14} />, label: t("actions.sync"), onSelect: () => void run("sync", () => syncShipment(shipment.id), t("actions.sync_done")) },
    { action: "update", icon: <Pencil size={14} />, label: t("actions.update"), onSelect: () => setOpen("parcel") },
    {
      action: "requestNewAttempt",
      icon: <RotateCcw size={14} />,
      label: t("actions.new_attempt"),
      onSelect: () =>
        void run("requestNewAttempt", () => requestNewAttempt(shipment.id), t("actions.new_attempt_done", { carrier }), {
          title: t("actions.new_attempt"),
          description: t("actions.new_attempt_confirm", { carrier }),
          label: t("actions.new_attempt"),
        }),
    },
    {
      action: "askReturn",
      icon: <Undo2 size={14} />,
      label: t("actions.ask_return"),
      onSelect: () =>
        void run("askReturn", () => askReturn(shipment.id), t("actions.ask_return_done", { carrier }), {
          title: t("actions.ask_return"),
          description: t("actions.ask_return_confirm", { carrier }),
          label: t("actions.ask_return"),
          danger: true,
        }),
    },
  ];
  const offered = steps.filter((step) => actions.has(step.action));
  const remarks = actions.has("addRemark") || actions.has("listRemarks");
  // The one step the merchant most likely came here for; a driver's progress is reported, a carrier's arrives on its own.
  const primary = offered.find(
    (step) => step.action === "resolve" || step.action === "validate" || step.action === "confirmReturn" || (step.action === "report" && shipment.kind === "driver"),
  );
  const label = offered.find((step) => step.action === "label" && step !== primary);
  const rest = offered.filter((step) => step !== primary && step !== label);
  const canVoid = actions.has("void");

  return (
    <Card title={t("delivery.title")}>
      <div className="space-y-4">
        <div className="flex min-w-0 items-center gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
              {shipment.kind === "carrier" ? <Building2 size={17} /> : <Truck size={17} />}
            </span>
            <div className="min-w-0">
              <p className="truncate font-medium">{shipment.kind === "carrier" ? carrier : order.driverName ?? t("delivery.a_driver")}</p>
              <p className="text-xs text-muted-foreground">{t(shipment.kind === "carrier" ? "delivery.by_carrier" : "delivery.by_driver")}</p>
            </div>
        </div>

        <AttentionBanner shipment={shipment} />

        <dl className="space-y-2.5 text-sm">
          {shipment.trackingNumber && (
            <Fact label={t("delivery.tracking")}>
              <span dir="ltr" className="font-mono text-[0.8125rem] tracking-tight">
                {shipment.trackingNumber}
              </span>
            </Fact>
          )}
          <Fact label={t("delivery.to_collect")}>{formatMoney(shipment.codAmount, locale)}</Fact>
          {shipment.kind === "driver" && <Fact label={t("delivery.driver_fee")}>{formatMoney(shipment.driverFee, locale)}</Fact>}
          <Fact label={t("delivery.type")}>
            {t(`delivery_type.${shipment.deliveryType}`)}
            {shipment.stationCode ? ` · ${shipment.stationCode}` : ""}
          </Fact>
          {shipment.deliveryAttempts > 0 && <Fact label={t("delivery.attempts")}>{shipment.deliveryAttempts}</Fact>}
          {latest && (
            <Fact label={t("delivery.latest")}>
              {"key" in latest ? t(latest.key) : latest.text}
              {shipment.providerStatusAt && <span className="block text-xs font-normal text-muted-foreground">{relativeTime(shipment.providerStatusAt, locale)}</span>}
            </Fact>
          )}
          {shipment.lastSyncedAt && <Fact label={t("delivery.checked")}>{relativeTime(shipment.lastSyncedAt, locale)}</Fact>}
        </dl>

        {(primary || label || rest.length > 0 || remarks || canVoid) && (
          <div className="flex items-center gap-2">
            {primary && (
              <Button type="button" className="flex-1" disabled={busy !== null} onClick={primary.onSelect}>
                {primary.icon}
                {busy === primary.action ? t("ship.sending") : primary.label}
              </Button>
            )}
            {label && (
              <Button type="button" variant="secondary" className={primary ? "" : "flex-1"} disabled={busy !== null} onClick={label.onSelect}>
                {label.icon}
                {busy === label.action ? t("ship.sending") : label.label}
              </Button>
            )}
            {(rest.length > 0 || remarks || canVoid) && (
              <DropdownMenu
                trigger={<MoreHorizontal size={16} aria-hidden="true" />}
                triggerLabel={t("actions.more")}
                triggerClassName={buttonVariants({ variant: "secondary", className: "w-9 shrink-0 px-0" })}
              >
                {rest.map((step) => (
                  <DropdownItem key={step.action} disabled={busy !== null} onClick={step.onSelect}>
                    {step.icon}
                    {step.label}
                  </DropdownItem>
                ))}
                {remarks && (
                  <DropdownItem disabled={busy !== null} onClick={() => setOpen("remarks")}>
                    <MessageSquare size={14} />
                    {t("actions.remarks")}
                  </DropdownItem>
                )}
                {canVoid && (rest.length > 0 || remarks) && <DropdownSeparator />}
                {canVoid && (
                  <DropdownItem
                    danger
                    disabled={busy !== null}
                    onClick={() =>
                      void run("void", () => voidShipment(shipment.id), t("actions.void_done", { order: order.orderNumber }), {
                        title: t(`actions.${voidKey}`),
                        description: t(`actions.${voidKey}_confirm`, { carrier }),
                        label: t(`actions.${voidKey}`),
                        danger: true,
                      })
                    }
                  >
                    <XCircle size={14} />
                    {t(`actions.${voidKey}`)}
                  </DropdownItem>
                )}
              </DropdownMenu>
            )}
          </div>
        )}

        <div className="border-t border-border pt-4">
          <p className="mb-3 text-xs font-medium text-muted-foreground">{t("history.title")}</p>
          <DeliveryHistory shipment={shipment} />
        </div>
      </div>

      {open === "report" && <ReportDialog shipment={shipment} onClose={() => setOpen(null)} onDone={onChanged} />}
      {open === "resolve" && <ResolveDialog shipment={shipment} canLookup={actions.has("lookup")} onClose={() => setOpen(null)} onDone={onChanged} />}
      {open === "parcel" && <EditParcelDialog shipment={shipment} order={order} fields={fields} onClose={() => setOpen(null)} onDone={onChanged} />}
      {open === "remarks" && (
        <RemarksDialog shipment={shipment} canAdd={actions.has("addRemark")} canList={actions.has("listRemarks")} onClose={() => setOpen(null)} onDone={onChanged} />
      )}
    </Card>
  );
}
