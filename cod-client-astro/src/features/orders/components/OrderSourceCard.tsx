import { useState } from "react";
import { Megaphone } from "lucide-react";
import { Button, Card, Field, Select } from "@/components/ui";
import { useT } from "@/i18n/react";
import type { Locale } from "@/i18n/config";
import { notify } from "@/lib/notify";
import { updateOrder } from "@/features/orders/api";
import { attributionFacts, canNameSource } from "@/features/orders/model";
import type { OrderDetail } from "@/features/orders/types";
import { ORDER_SOURCES, type OrderSource } from "../../../../../cod-shared/attribution/source";

/** The source picker of an order taken outside the storefront: a message, a call. */
export function OrderSourceSelect({ value, onChange, disabled }: { value: OrderSource | ""; onChange: (value: OrderSource | "") => void; disabled?: boolean }) {
  const t = useT("orders");
  return (
    <Field label={t("source.label")} hint={t("source.hint")}>
      <Select value={value} disabled={disabled} onChange={(event) => onChange((ORDER_SOURCES as readonly string[]).includes(event.currentTarget.value) ? (event.currentTarget.value as OrderSource) : "")}>
        <option value="">{t("source.none")}</option>
        {ORDER_SOURCES.map((source) => (
          <option key={source} value={source}>
            {t(`source.name.${source}`)}
          </option>
        ))}
      </Select>
    </Field>
  );
}

/**
 * Where the order came from. A source captured from the shopper's visit is
 * shown as it was recorded and never changed; the merchant names the source
 * of any other order.
 */
export function OrderSourceCard({ order, locale, canEdit, onChanged }: { order: OrderDetail; locale: Locale; canEdit: boolean; onChanged: () => void }) {
  const t = useT("orders");
  const common = useT("common");
  const attribution = order.attribution ?? null;
  const named = attribution?.method === "merchant" ? (attribution.source as OrderSource) : "";
  const [choice, setChoice] = useState<OrderSource | "">(named);
  const [busy, setBusy] = useState(false);
  const editable = canEdit && canNameSource(attribution);

  async function save() {
    setBusy(true);
    try {
      await updateOrder(order.id, { source: choice ? { source: choice } : null });
      notify.success(t("source.saved"));
      onChanged();
    } catch {
      notify.error(common("feedback.action_failed"));
    } finally {
      setBusy(false);
    }
  }

  if (!attribution && !editable) return null;

  return (
    <Card title={t("source.title")}>
      {attribution && (
        <div className="flex items-start gap-3">
          <Megaphone size={16} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div className="min-w-0 space-y-3">
            <p className="text-sm font-semibold">{t(`source.name.${attribution.source}`)}</p>
            <dl className="space-y-2">
              {attributionFacts(attribution, locale).map((fact) => (
                <div key={fact.key}>
                  <dt className="text-xs font-semibold text-muted-foreground">{t(`source.fact.${fact.key}`)}</dt>
                  <dd className="text-sm break-words" dir="auto">{fact.value}</dd>
                </div>
              ))}
            </dl>
            <p className="text-xs text-muted-foreground">{t(attribution.method === "captured" ? "source.captured_note" : "source.merchant_note")}</p>
          </div>
        </div>
      )}
      {editable && (
        <div className={attribution ? "mt-4 space-y-3 border-t border-border pt-4" : "space-y-3"}>
          <OrderSourceSelect value={choice} onChange={setChoice} disabled={busy} />
          <Button type="button" variant="secondary" size="sm" onClick={() => void save()} disabled={busy || choice === named}>
            {t("source.save")}
          </Button>
        </div>
      )}
    </Card>
  );
}
