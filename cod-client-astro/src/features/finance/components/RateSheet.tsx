import { useState } from "react";
import { Check, Coins, Trash2 } from "lucide-react";
import { Alert, Button, Dialog, Field, IconButton, Input, useConfirmDialog } from "@/components/ui";
import { useLocale, useT } from "@/i18n/react";
import { notify } from "@/lib/notify";
import { formatMoney } from "@/features/orders/model";
import { formatStoreDay, storeDay } from "@/lib/store-time";
import { MAX_RATE } from "../../../../../cod-shared/finance/model";
import { removeRate, setRate } from "@/features/finance/api";
import { financeError, parseAmount } from "@/features/finance/model";
import type { ExchangeRate, ForeignCurrency } from "@/features/finance/types";

/**
 * What a dollar or a euro costs the merchant, from a day on: what they
 * really pay, not the bank's rate. Opened from a cost left out for want of a
 * rate, it starts on the first day missing. Earlier days keep the rate they
 * had; a rate entered by mistake is removed.
 */
export function RateSheet({ currency, from, rates, onClose, onChanged }: { currency: ForeignCurrency; from?: string; rates: ExchangeRate[]; onClose: () => void; onChanged: () => void }) {
  const t = useT("finance");
  const common = useT("common");
  const locale = useLocale();
  const confirm = useConfirmDialog();
  const [amountText, setAmountText] = useState("");
  const [validFrom, setValidFrom] = useState(from ?? storeDay());
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const amount = parseAmount(amountText, MAX_RATE);
  const history = rates.filter((rate) => rate.currency === currency).sort((a, b) => b.validFrom.localeCompare(a.validFrom));

  async function save() {
    setShowErrors(true);
    if (amount === null) return;
    setBusy(true);
    setError(null);
    try {
      await setRate({ currency, dzdPerUnit: amount, validFrom });
      notify.success(t("feedback.rate_saved"));
      onChanged();
      onClose();
    } catch (cause) {
      setError(financeError(cause, t));
    } finally {
      setBusy(false);
    }
  }

  async function remove(rate: ExchangeRate) {
    const ok = await confirm({ title: t("rate_sheet.remove_title"), description: t("rate_sheet.remove_body"), confirmLabel: t("rate_sheet.remove"), tone: "danger" });
    if (!ok) return;
    try {
      await removeRate(rate.id);
      notify.success(t("feedback.rate_removed"));
      onChanged();
      onClose();
    } catch (cause) {
      setError(financeError(cause, t));
    }
  }

  return (
    <Dialog
      open
      onClose={() => !busy && onClose()}
      placement="end"
      title={t(`rate_sheet.title_${currency}`)}
      icon={<Coins size={17} aria-hidden="true" />}
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>
            {common("cancel")}
          </Button>
          <Button type="button" disabled={busy} onClick={() => void save()}>
            <Check size={15} aria-hidden="true" />
            {busy ? common("saving") : t("rate_sheet.save")}
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        {error && (
          <Alert tone="critical" role="alert">
            {error}
          </Alert>
        )}
        <Field label={t("rate_sheet.amount")} hint={t("rate_sheet.amount_hint")} error={showErrors && amount === null ? t("errors.rate") : undefined}>
          <div className="flex items-center gap-2">
            <Input value={amountText} onChange={(event) => setAmountText(event.currentTarget.value)} inputMode="decimal" dir="ltr" placeholder="0" autoFocus />
            <span className="shrink-0 text-sm font-medium text-muted-foreground">{t("currency.DZD")}</span>
          </div>
        </Field>
        <Field label={t("rate_sheet.from")} hint={t("rate_sheet.from_hint")}>
          <Input type="date" value={validFrom} max={storeDay()} onChange={(event) => setValidFrom(event.currentTarget.value)} />
        </Field>

        <section aria-labelledby="rate-history">
          <h3 id="rate-history" className="text-xs font-semibold text-muted-foreground">
            {t("rate_sheet.history")}
          </h3>
          {history.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">{t("rate_sheet.history_empty")}</p>
          ) : (
            <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
              {history.map((rate) => (
                <li key={rate.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span className="text-foreground">{t("rate_sheet.line", { amount: formatMoney(rate.dzdPerUnit, locale), date: formatStoreDay(rate.validFrom, locale) })}</span>
                  <IconButton type="button" onClick={() => void remove(rate)} aria-label={t("rate_sheet.remove")} title={t("rate_sheet.remove")}>
                    <Trash2 size={15} aria-hidden="true" />
                  </IconButton>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Dialog>
  );
}
