import { Card, Field, Input, Select, SwitchField } from "@/components/ui";
import { useT } from "@/i18n/react";
import type { ProductStatus } from "@/features/products/types";

const STATUS_VALUES: ProductStatus[] = ["ACTIVE", "DRAFT", "ARCHIVED"];

interface ProductSettingsCardProps {
  status: ProductStatus;
  setStatus: (status: ProductStatus) => void;
  inventory: string;
  setInventory: (val: string) => void;
  lowStockThreshold: string;
  setLowStockThreshold: (val: string) => void;
  trackInventory: boolean;
  setTrackInventory: (val: boolean) => void;
  showInStore: boolean;
  setShowInStore: (val: boolean) => void;
  hasVariantsSwitch: boolean;
  editing: boolean;
  busy: boolean;
}

export function ProductSettingsCard({
  status,
  setStatus,
  inventory,
  setInventory,
  lowStockThreshold,
  setLowStockThreshold,
  trackInventory,
  setTrackInventory,
  showInStore,
  setShowInStore,
  hasVariantsSwitch,
  editing,
  busy,
}: ProductSettingsCardProps) {
  const t = useT("products");

  return (
    <Card title={t("form.section_settings")}>
      <div className="space-y-4">
        <Field label={t("form.status_label")}>
          <Select
            value={status}
            onChange={(event) =>
              setStatus(event.currentTarget.value as ProductStatus)
            }
            disabled={busy}
          >
            {STATUS_VALUES.map((option) => (
              <option key={option} value={option}>
                {t(`status_options.${option.toLocaleLowerCase()}`)}
              </option>
            ))}
          </Select>
        </Field>
        {!hasVariantsSwitch && !editing && (
          <Field label={t("form.initial_stock_label")}>
            <Input
              type="number"
              value={inventory}
              onChange={(event) => setInventory(event.currentTarget.value)}
              min={0}
              disabled={busy}
            />
          </Field>
        )}
        {!hasVariantsSwitch && (
          <Field label={t("form.threshold_label")}>
            <Input
              type="number"
              value={lowStockThreshold}
              onChange={(event) =>
                setLowStockThreshold(event.currentTarget.value)
              }
              min={0}
              disabled={busy}
            />
          </Field>
        )}
      </div>
      <div className="mt-4 space-y-3 border-t border-border pt-4">
        <SwitchField label={t("form.track_stock_label")} help={t("form.track_stock_hint")} checked={trackInventory} onChange={setTrackInventory} disabled={busy} />
        <SwitchField label={t("form.show_in_store_label")} help={t("form.show_in_store_hint")} checked={showInStore} onChange={setShowInStore} disabled={busy} />
      </div>
    </Card>
  );
}
