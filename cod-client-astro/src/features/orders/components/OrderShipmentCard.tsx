import { useState } from "react";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  Download,
  MessageSquare,
  Pencil,
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
import { Button, Card, useConfirmDialog } from "@/components/ui";
import type { ButtonVariant } from "@/components/ui/button";
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
import { StageBadge } from "@/features/orders/components/StageBadge";
import { EditParcelDialog, RemarksDialog, ReportDialog, ResolveDialog } from "@/features/orders/components/ShipmentDialogs";

type Open = "report" | "resolve" | "parcel" | "remarks" | null;

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-end font-semibold">{children}</span>
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
    <div role="alert" className="flex gap-2 rounded-lg border border-[var(--status-returned-border)] bg-[var(--status-returned-bg)] p-3 text-sm font-medium text-[var(--status-returned-text)]">
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
              <p className="text-sm font-semibold">{"key" in label ? t(label.key) : label.text}</p>
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

  const button = (action: ShipmentAction, icon: React.ReactNode, label: string, onClick: () => void, variant: ButtonVariant = "secondary") =>
    actions.has(action) && (
      <Button key={action} type="button" variant={variant} size="sm" disabled={busy !== null} onClick={onClick}>
        {icon}
        {busy === action ? t("ship.sending") : label}
      </Button>
    );

  return (
    <Card title={t("delivery.title")}>
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent text-accent-foreground">
              {shipment.kind === "carrier" ? <Building2 size={17} /> : <Truck size={17} />}
            </span>
            <div className="min-w-0">
              <p className="truncate font-semibold">{shipment.kind === "carrier" ? carrier : order.driverName ?? t("delivery.a_driver")}</p>
              <p className="text-xs text-muted-foreground">{t(shipment.kind === "carrier" ? "delivery.by_carrier" : "delivery.by_driver")}</p>
            </div>
          </div>
          <StageBadge stage={order.stage} needsAttention={order.needsAttention} />
        </div>

        <AttentionBanner shipment={shipment} />

        <div className="space-y-2.5 text-sm">
          {shipment.trackingNumber && (
            <Fact label={t("delivery.tracking")}>
              <span dir="ltr" className="font-mono text-xs">
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
        </div>

        <div className="flex flex-wrap gap-2">
          {button("resolve", <Search size={14} />, t("actions.resolve"), () => setOpen("resolve"), "primary")}
          {button("validate", <CheckCircle2 size={14} />, t("actions.validate"), () =>
            void run("validate", () => validateShipment(shipment.id), t("actions.validate_done", { carrier }), {
              title: t("actions.validate"),
              description: t("actions.validate_confirm", { carrier }),
              label: t("actions.validate"),
            }),
          "primary")}
          {button("report", <Send size={14} />, t(`report.${shipment.kind}.title`), () => setOpen("report"), shipment.kind === "driver" ? "primary" : "secondary")}
          {button("label", <Download size={14} />, t("actions.label"), () => void run("label", () => downloadLabel(shipment), t("actions.label_done")))}
          {button("sync", <RefreshCw size={14} />, t("actions.sync"), () => void run("sync", () => syncShipment(shipment.id), t("actions.sync_done")))}
          {button("update", <Pencil size={14} />, t("actions.update"), () => setOpen("parcel"))}
          {(actions.has("addRemark") || actions.has("listRemarks")) && (
            <Button type="button" variant="secondary" size="sm" disabled={busy !== null} onClick={() => setOpen("remarks")}>
              <MessageSquare size={14} />
              {t("actions.remarks")}
            </Button>
          )}
          {button("requestNewAttempt", <RotateCcw size={14} />, t("actions.new_attempt"), () =>
            void run("requestNewAttempt", () => requestNewAttempt(shipment.id), t("actions.new_attempt_done", { carrier }), {
              title: t("actions.new_attempt"),
              description: t("actions.new_attempt_confirm", { carrier }),
              label: t("actions.new_attempt"),
            }),
          )}
          {button("askReturn", <Undo2 size={14} />, t("actions.ask_return"), () =>
            void run("askReturn", () => askReturn(shipment.id), t("actions.ask_return_done", { carrier }), {
              title: t("actions.ask_return"),
              description: t("actions.ask_return_confirm", { carrier }),
              label: t("actions.ask_return"),
              danger: true,
            }),
          )}
          {button("confirmReturn", <CheckCircle2 size={14} />, t("actions.confirm_return"), () =>
            void run("confirmReturn", () => confirmReturn(shipment.id), t("actions.confirm_return_done"), {
              title: t("actions.confirm_return"),
              description: t("actions.confirm_return_confirm", { carrier }),
              label: t("actions.confirm_return"),
            }),
          )}
          {button("void", <XCircle size={14} />, t(shipment.kind === "carrier" ? "actions.void_carrier" : "actions.void_driver"), () =>
            void run("void", () => voidShipment(shipment.id), t("actions.void_done", { order: order.orderNumber }), {
              title: t(shipment.kind === "carrier" ? "actions.void_carrier" : "actions.void_driver"),
              description: t(shipment.kind === "carrier" ? "actions.void_carrier_confirm" : "actions.void_driver_confirm", { carrier }),
              label: t(shipment.kind === "carrier" ? "actions.void_carrier" : "actions.void_driver"),
              danger: true,
            }),
          "dangerOutline")}
        </div>

        <div className="border-t border-border pt-4">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("history.title")}</p>
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
