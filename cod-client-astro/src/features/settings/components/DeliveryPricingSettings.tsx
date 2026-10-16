import { useState } from "react";
import { Truck } from "lucide-react";
import { useT } from "@/i18n/react";
import type { StoreConfig } from "@/features/settings/types";
import { FieldRow, SettingsSection } from "@/features/settings/components/SettingsSection";
import { InfoTip, Input } from "@/components/ui";

type ShippingMode = "highest" | "default_profile";

/**
 * Delivery pricing controls.
 *
 * Both settings default to today's behaviour, so a merchant who never opens
 * this panel sees no change. The threshold is deliberately a nullable number
 * rather than a toggle plus a value: "off" and "free for everyone" must not be
 * expressible as the same state, and an empty field says off unambiguously.
 */
export function DeliveryPricingSettings({
  storeConfig,
  onSave,
}: {
  storeConfig: StoreConfig;
  onSave: (payload: {
    freeShippingThreshold?: number | null;
    cartShippingMode?: ShippingMode;
  }) => Promise<void>;
}) {
  const t = useT("settings");

  // Held as a string so the field can be genuinely empty (= no threshold)
  // rather than collapsing to 0, which would mean "everything ships free".
  const [threshold, setThreshold] = useState(
    storeConfig.freeShippingThreshold == null
      ? ""
      : String(storeConfig.freeShippingThreshold),
  );
  const [mode, setMode] = useState<ShippingMode>(
    storeConfig.cartShippingMode ?? "highest",
  );

  const trimmed = threshold.trim();
  const parsed = trimmed === "" ? null : Number(trimmed);
  const invalid =
    parsed !== null && (!Number.isInteger(parsed) || parsed < 1);

  return (
    <SettingsSection
      icon={Truck}
      title={t("store.delivery_pricing_title")}
      subtitle={t("store.delivery_pricing_subtitle")}
      onSave={async () => {
        if (invalid) return;
        await onSave({ freeShippingThreshold: parsed, cartShippingMode: mode });
      }}
    >
      <FieldRow label={t("store.free_shipping_threshold_label")} help={t("store.free_shipping_threshold_hint")}>
        <Input
          id="free-shipping-threshold"
          type="number"
          inputMode="numeric"
          min={1}
          step={1}
          value={threshold}
          onChange={(event) => setThreshold(event.currentTarget.value)}
          placeholder={t("store.free_shipping_threshold_placeholder")}
          aria-label={t("store.free_shipping_threshold_label")}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? "free-shipping-threshold-error" : undefined}
          className="max-w-xs tabular-nums"
        />
        {invalid && (
          <p id="free-shipping-threshold-error" role="alert" className="text-xs font-medium text-destructive">
            {t("store.free_shipping_threshold_invalid")}
          </p>
        )}
      </FieldRow>

      <fieldset className="space-y-2">
        <legend className="flex items-center gap-1.5 text-sm font-medium text-foreground">
          <span>{t("store.cart_shipping_mode_label")}</span>
          <InfoTip>{t("store.cart_shipping_mode_hint")}</InfoTip>
        </legend>
        <div className="grid gap-2 pt-1 sm:grid-cols-2">
          {(["highest", "default_profile"] as const).map((value) => (
            <label
              key={value}
              className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors ${
                mode === value ? "border-primary bg-subtle" : "border-border hover:bg-subtle"
              }`}
            >
              <input
                type="radio"
                name="cartShippingMode"
                value={value}
                checked={mode === value}
                onChange={() => setMode(value)}
                className="accent-[var(--primary)]"
              />
              <span className="min-w-0 flex-1 font-medium text-foreground">{t(`store.cart_shipping_mode_${value}_label`)}</span>
              <InfoTip>{t(`store.cart_shipping_mode_${value}_hint`)}</InfoTip>
            </label>
          ))}
        </div>
      </fieldset>
    </SettingsSection>
  );
}
