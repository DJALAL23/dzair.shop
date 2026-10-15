import { useEffect, useState } from "react";
import { MessageSquare, Search, Send } from "lucide-react";
import { useT } from "@/i18n/react";
import { notify } from "@/lib/notify";
import { addRemark, listRemarks, reportShipmentEvent, resolveHandoff, updateParcel } from "@/features/orders/api";
import { reportsFor } from "@/features/orders/model";
import type { OrderDetail, Shipment, ShipmentRemark } from "@/features/orders/types";
import { Button, Dialog, Field, Input, Textarea } from "@/components/ui";
import type { MerchantReport } from "../../../../../cod-shared/shipments/merchant-reports";

const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

function ErrorNote({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm font-medium text-destructive">
      {text}
    </p>
  );
}

/** What the merchant saw happen: a driver's progress, or that a carrier's goods came back. */
export function ReportDialog({ shipment, onClose, onDone }: { shipment: Shipment; onClose: () => void; onDone: () => void | Promise<void> }) {
  const t = useT("orders");
  const options = reportsFor(shipment);
  const [status, setStatus] = useState<MerchantReport>(options[0]);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await reportShipmentEvent(shipment.id, { status, ...(reason.trim() ? { reason: reason.trim() } : {}) });
      notify.success(t("report.done", { status: t(`report.${shipment.kind}.${status}`) }));
      await onDone();
      onClose();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title={t(`report.${shipment.kind}.title`)} onClose={onClose}>
      <div className="space-y-4">
        <div role="radiogroup" className="space-y-1.5">
          {options.map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={status === option}
              onClick={() => setStatus(option)}
              className={`flex min-h-11 w-full flex-col items-start justify-center rounded-lg border px-3 py-2 text-start ${
                status === option ? "border-primary bg-primary/10" : "border-border hover:bg-muted"
              }`}
            >
              <span className="text-sm font-semibold">{t(`report.${shipment.kind}.${option}`)}</span>
              <span className="text-xs text-muted-foreground">{t(`report.${shipment.kind}.${option}_hint`)}</span>
            </button>
          ))}
        </div>
        {(status === "failed_attempt" || status === "returned") && (
          <Field label={t("report.reason")}>
            <Input value={reason} onChange={(event) => setReason(event.currentTarget.value)} maxLength={500} placeholder={t("report.reason_placeholder")} />
          </Field>
        )}
        <ErrorNote text={error} />
        <Button type="button" className="w-full" disabled={busy} onClick={() => void submit()}>
          {busy ? t("ship.sending") : t("report.submit")}
        </Button>
      </div>
    </Dialog>
  );
}

/**
 * A handoff whose outcome the carrier never confirmed: find the parcel by the
 * order number, give its tracking number, or say none was made and ship again.
 * Shipping it again without resolving could make two parcels.
 */
export function ResolveDialog({ shipment, canLookup, onClose, onDone }: { shipment: Shipment; canLookup: boolean; onClose: () => void; onDone: () => void | Promise<void> }) {
  const t = useT("orders");
  const carrier = shipment.carrierName ?? t("delivery.a_carrier");
  const [tracking, setTracking] = useState("");
  const [busy, setBusy] = useState<"lookup" | "attach" | "release" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  async function run(action: "lookup" | "attach" | "release") {
    setBusy(action);
    setError(null);
    setNotFound(false);
    try {
      const resolution = action === "attach" ? { action, trackingNumber: tracking.trim() } : { action };
      const result = await resolveHandoff(shipment.id, resolution);
      if (result.outcome === "not_found") {
        setNotFound(true);
        return;
      }
      notify.success(t(`resolve.done_${action}`, { carrier }));
      await onDone();
      onClose();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog title={t("resolve.title")} onClose={onClose}>
      <div className="space-y-4 text-sm">
        <p className="text-muted-foreground">{t("resolve.lead", { carrier })}</p>
        {canLookup && (
          <div className="space-y-1.5">
            <Button type="button" variant="secondary" className="w-full" disabled={busy !== null} onClick={() => void run("lookup")}>
              <Search size={15} />
              {busy === "lookup" ? t("resolve.looking") : t("resolve.lookup", { carrier })}
            </Button>
            {notFound && <p className="text-xs font-medium text-muted-foreground">{t("resolve.not_found", { carrier })}</p>}
          </div>
        )}
        <Field label={t("resolve.attach_label", { carrier })}>
          <div className="flex gap-2">
            <Input dir="ltr" value={tracking} onChange={(event) => setTracking(event.currentTarget.value)} className="font-mono" />
            <Button type="button" variant="secondary" disabled={busy !== null || !tracking.trim()} onClick={() => void run("attach")}>
              {t("resolve.attach")}
            </Button>
          </div>
        </Field>
        <div className="rounded-lg border border-border bg-muted/40 p-3">
          <p className="font-semibold">{t("resolve.release_title")}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{t("resolve.release_hint", { carrier })}</p>
          <Button type="button" variant="secondary" className="mt-2" disabled={busy !== null} onClick={() => void run("release")}>
            {t("resolve.release")}
          </Button>
        </div>
        <ErrorNote text={error} />
      </div>
    </Dialog>
  );
}

/** Changing the parcel at the carrier: the customer's contact, address, the cash to collect, and what the carrier takes. */
export function EditParcelDialog({
  shipment,
  order,
  fields,
  onClose,
  onDone,
}: {
  shipment: Shipment;
  order: Pick<OrderDetail, "customerName" | "phone" | "address">;
  fields: { weight: boolean; fragile: boolean; remarks: boolean };
  onClose: () => void;
  onDone: () => void | Promise<void>;
}) {
  const t = useT("orders");
  const [customerName, setCustomerName] = useState(order.customerName);
  const [phone, setPhone] = useState(order.phone);
  const [address, setAddress] = useState(order.address ?? "");
  const [amount, setAmount] = useState(String(shipment.codAmount));
  const [weight, setWeight] = useState(shipment.weight != null ? String(shipment.weight) : "");
  const [fragile, setFragile] = useState(Boolean(shipment.isFragile));
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const changes: Record<string, unknown> = {
    ...(customerName.trim() !== order.customerName ? { customerName: customerName.trim() } : {}),
    ...(phone.trim() !== order.phone ? { phone: phone.trim() } : {}),
    ...(address.trim() !== (order.address ?? "") ? { address: address.trim() } : {}),
    ...(Number(amount) !== shipment.codAmount && amount.trim() !== "" ? { amount: Number(amount) } : {}),
    ...(fields.weight && weight.trim() !== "" && Number(weight) !== shipment.weight ? { weight: Number(weight) } : {}),
    ...(fields.fragile && fragile !== Boolean(shipment.isFragile) ? { fragile } : {}),
    ...(fields.remarks && remarks.trim() ? { remarks: remarks.trim() } : {}),
  };

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await updateParcel(shipment.id, changes);
      notify.success(t("parcel.updated"));
      await onDone();
      onClose();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title={t("parcel.title")} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-xs font-medium text-muted-foreground">{t("parcel.lead", { carrier: shipment.carrierName ?? t("delivery.a_carrier") })}</p>
        <Field label={t("parcel.customer_name")}>
          <Input value={customerName} onChange={(event) => setCustomerName(event.currentTarget.value)} />
        </Field>
        <Field label={t("parcel.phone")}>
          <Input dir="ltr" value={phone} onChange={(event) => setPhone(event.currentTarget.value)} />
        </Field>
        <Field label={t("parcel.address")}>
          <Input value={address} onChange={(event) => setAddress(event.currentTarget.value)} />
        </Field>
        <Field label={t("parcel.amount")}>
          <Input type="number" min="0" value={amount} onChange={(event) => setAmount(event.currentTarget.value)} />
        </Field>
        {(fields.weight || fields.fragile) && (
          <div className="flex items-end gap-4">
            {fields.weight && (
              <Field label={t("ship.weight")}>
                <Input type="number" min="0" step="0.1" value={weight} onChange={(event) => setWeight(event.currentTarget.value)} />
              </Field>
            )}
            {fields.fragile && (
              <label className="mb-2 flex items-center gap-2 text-sm font-semibold">
                <input type="checkbox" checked={fragile} onChange={(event) => setFragile(event.currentTarget.checked)} />
                {t("ship.fragile")}
              </label>
            )}
          </div>
        )}
        {fields.remarks && (
          <Field label={t("ship.remarks")}>
            <Textarea value={remarks} onChange={(event) => setRemarks(event.currentTarget.value)} maxLength={500} />
          </Field>
        )}
        <ErrorNote text={error} />
        <Button type="button" className="w-full" disabled={busy || Object.keys(changes).length === 0} onClick={() => void submit()}>
          {busy ? t("ship.sending") : t("parcel.save")}
        </Button>
      </div>
    </Dialog>
  );
}

/** The notes between the merchant and the carrier's courier about this parcel. */
export function RemarksDialog({ shipment, canAdd, canList, onClose, onDone }: { shipment: Shipment; canAdd: boolean; canList: boolean; onClose: () => void; onDone: () => void | Promise<void> }) {
  const t = useT("orders");
  const [remarks, setRemarks] = useState<ShipmentRemark[] | null>(canList ? null : []);
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canList) return;
    listRemarks(shipment.id)
      .then(setRemarks)
      .catch((cause) => {
        setRemarks([]);
        setError(message(cause));
      });
  }, [shipment.id, canList]);

  async function send() {
    setBusy(true);
    setError(null);
    try {
      await addRemark(shipment.id, content.trim());
      notify.success(t("remarks.sent"));
      setContent("");
      if (canList) setRemarks(await listRemarks(shipment.id));
      await onDone();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title={t("remarks.title")} onClose={onClose}>
      <div className="space-y-4">
        {canList && (
          <div className="max-h-60 space-y-2 overflow-y-auto">
            {remarks === null ? (
              <p role="status" className="text-sm text-muted-foreground">{t("remarks.loading")}</p>
            ) : remarks.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("remarks.none")}</p>
            ) : (
              remarks.map((remark, index) => (
                <div key={index} className="flex gap-2 rounded-lg bg-muted/50 p-2.5 text-sm">
                  <MessageSquare size={14} className="mt-0.5 shrink-0 text-muted-foreground" />
                  <div>
                    <p>{remark.content}</p>
                    {remark.createdAt && <p className="mt-0.5 text-xs text-muted-foreground">{new Date(remark.createdAt).toLocaleString()}</p>}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
        {canAdd && (
          <div className="space-y-2">
            <Textarea value={content} onChange={(event) => setContent(event.currentTarget.value)} maxLength={500} placeholder={t("remarks.placeholder")} />
            <Button type="button" className="w-full" disabled={busy || !content.trim()} onClick={() => void send()}>
              <Send size={15} />
              {busy ? t("ship.sending") : t("remarks.send")}
            </Button>
          </div>
        )}
        <ErrorNote text={error} />
      </div>
    </Dialog>
  );
}
