import { Truck } from "lucide-react";
import { Button, Card, Field, Input, Textarea } from "@/components/ui";
import { useLocale, useT } from "@/i18n/react";
import type { DeliveryQuote } from "@/features/orders/api";
import { deliveryFeeHint } from "@/features/orders/model";

interface NewOrderDeliveryCardProps {
  deliveryType: "home" | "stop_desk";
  setDeliveryType: (type: "home" | "stop_desk") => void;
  deliveryFee: number;
  /** The merchant typed a fee: it is the order's, as typed. */
  onFeeTyped: (fee: number) => void;
  /** Back to the store's fee. */
  onUseStoreFee: () => void;
  feeTyped: boolean;
  /** The store's fee for these lines there, as its checkout decides it; null until there is something to quote. */
  quote: DeliveryQuote | null;
  notes: string;
  setNotes: (val: string) => void;
  errors: Record<string, string>;
}

export function NewOrderDeliveryCard({
  deliveryType,
  setDeliveryType,
  deliveryFee,
  onFeeTyped,
  onUseStoreFee,
  feeTyped,
  quote,
  notes,
  setNotes,
  errors,
}: NewOrderDeliveryCardProps) {
  const t = useT("orders");
  const locale = useLocale();
  const hint = deliveryFeeHint(quote, feeTyped, locale);

  return (
    <Card title={t("form.delivery_section")}>
      <div className="space-y-4">
        <div role="radiogroup" aria-label={t("form.delivery_section")} className="grid grid-cols-2 gap-2">
          {(["home", "stop_desk"] as const).map((type) => (
            <label
              key={type}
              className={`flex min-h-10 cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 text-sm transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring ${
                deliveryType === type ? "border-primary bg-subtle font-medium text-foreground" : "border-border text-muted-foreground hover:bg-subtle"
              }`}
            >
              <input type="radio" name="deliveryType" checked={deliveryType === type} onChange={() => setDeliveryType(type)} className="sr-only" />
              <Truck size={16} aria-hidden="true" className="shrink-0" />
              <span>{type === "home" ? t("form.delivery_type_home") : t("form.delivery_type_desk")}</span>
            </label>
          ))}
        </div>
        <Field label={t("form.delivery_fee_label")}>
          <div className="relative">
            <Input
              type="number"
              min="0"
              value={deliveryFee || (feeTyped ? deliveryFee : "")}
              placeholder={quote?.available ? String(quote.fee) : undefined}
              onChange={(event) => onFeeTyped(Math.max(0, Number(event.currentTarget.value) || 0))}
              className="pe-16"
            />
            <span className="absolute end-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-muted-foreground">
              DA
            </span>
          </div>
          {hint && (
            <span className={`mt-1 flex flex-wrap items-center gap-x-2 text-xs font-medium ${quote && !quote.available ? "text-destructive" : "text-muted-foreground"}`}>
              {t(hint.key, hint.values)}
              {feeTyped && quote?.available && (
                <Button type="button" variant="ghost" size="sm" className="h-auto px-1 py-0 text-xs" onClick={onUseStoreFee}>
                  {t("form.use_store_fee")}
                </Button>
              )}
            </span>
          )}
          {errors.deliveryFee && (
            <span className="mt-1 block text-xs font-medium text-destructive">
              {errors.deliveryFee}
            </span>
          )}
        </Field>
        <Field label={t("detail.notes")}>
          <Textarea
            value={notes}
            onChange={(event) => setNotes(event.currentTarget.value)}
            placeholder={t("form.notes_label")}
          />
        </Field>
      </div>
    </Card>
  );
}
