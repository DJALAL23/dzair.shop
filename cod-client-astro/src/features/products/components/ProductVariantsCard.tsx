import { useState, type Dispatch, type SetStateAction } from "react";
import { AlertCircle } from "lucide-react";
import {
  Button,
  Card,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  SwitchField,
} from "@/components/ui";
import { useT } from "@/i18n/react";
import { ProductOptionsManager } from "@/features/products/components/ProductOptionsManager";
import { VariantImagePicker } from "@/features/products/components/VariantImagePicker";
import type {
  ProductImage,
  VariantOptionFormState,
} from "@/features/products/types";

export interface VariantRow {
  key: string;
  variations: Record<string, string>;
  price: string;
  sku: string;
  inventory: string;
  lowStockThreshold: string;
  active: boolean;
  existingId?: string;
  imageId?: string | null;
}

interface ProductVariantsCardProps {
  hasVariantsSwitch: boolean;
  onToggleVariants: (checked: boolean) => void | Promise<void>;
  variantOptions: VariantOptionFormState[];
  setVariantOptions: Dispatch<SetStateAction<VariantOptionFormState[]>>;
  variantRows: VariantRow[];
  setVariantRows: Dispatch<SetStateAction<VariantRow[]>>;
  existingImages: ProductImage[];
  errors: Record<string, string>;
  setErrors: Dispatch<SetStateAction<Record<string, string>>>;
  busy: boolean;
  showImageCol: boolean;
}

export function ProductVariantsCard({
  hasVariantsSwitch,
  onToggleVariants,
  variantOptions,
  setVariantOptions,
  variantRows,
  setVariantRows,
  existingImages,
  errors,
  setErrors,
  busy,
  showImageCol,
}: ProductVariantsCardProps) {
  const t = useT("products");
  const common = useT("common");

  const [bulkPrice, setBulkPrice] = useState("");
  const [bulkSkuPrefix, setBulkSkuPrefix] = useState("");
  const [bulkStock, setBulkStock] = useState("");

  function updateVariantRow(
    index: number,
    field: "price" | "sku" | "inventory" | "lowStockThreshold" | "active",
    value: string | boolean,
  ) {
    setVariantRows((prev) =>
      prev.map((row, i) => (i === index ? { ...row, [field]: value } : row)),
    );
  }

  function updateVariantImageId(index: number, imageId: string | null) {
    setVariantRows((prev) =>
      prev.map((row, i) => (i === index ? { ...row, imageId } : row)),
    );
  }

  const hasVariants = variantRows.length > 0;

  return (
    <>
      <Card title={t("form.section_options")}>
        <SwitchField
          label={t("form.has_variants_label")}
          help={
            <>
              <span className="block">{t("form.has_variants_hint")}</span>
              <span className="mt-1.5 block">{t("form.options_hint")}</span>
            </>
          }
          checked={hasVariantsSwitch}
          onChange={(on) => void onToggleVariants(on)}
          disabled={busy}
        />
        {hasVariantsSwitch && (
          <div className="mt-4 space-y-4 border-t border-border pt-4">
            <ProductOptionsManager
              options={variantOptions}
              onChange={setVariantOptions}
              disabled={busy}
            />
          </div>
        )}
      </Card>

      {hasVariantsSwitch && hasVariants && (
        <Card title={t("form.variants_count", { count: variantRows.length })} help={t("form.variants_hint")}>
          <div className="space-y-5">
            {errors.variantRowsSku && (
              <p className="flex items-center gap-1 text-xs font-semibold text-destructive">
                <AlertCircle size={12} />
                {errors.variantRowsSku}
              </p>
            )}
            <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-muted/30 px-4 py-3">
              <span className="me-1 self-center text-xs font-medium text-muted-foreground">
                {t("form.bulk_fill")}:
              </span>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  value={bulkPrice}
                  onChange={(event) =>
                    setBulkPrice(event.currentTarget.value)
                  }
                  placeholder={t("form.bulk_price_placeholder")}
                  className="h-8 w-24 rounded-lg border border-border bg-card px-2 text-xs font-semibold"
                  disabled={busy}
                />
                <Button
                  type="button"
                  variant="secondary"
                  className="h-8 px-3 text-xs"
                  disabled={busy}
                  onClick={() => {
                    const value = Number(bulkPrice);
                    if (value > 0)
                      setVariantRows((prev) =>
                        prev.map((row) => ({ ...row, price: String(value) })),
                      );
                  }}
                >
                  {t("form.bulk_price_apply")}
                </Button>
              </div>
              <div className="flex items-center gap-1.5">
                <input
                  value={bulkSkuPrefix}
                  onChange={(event) =>
                    setBulkSkuPrefix(event.currentTarget.value)
                  }
                  placeholder={t("form.bulk_sku_placeholder")}
                  className="h-8 w-28 rounded-lg border border-border bg-card px-2 text-[11px] font-semibold"
                  disabled={busy}
                  dir="ltr"
                />
                <Button
                  type="button"
                  variant="secondary"
                  className="h-8 px-3 text-xs"
                  disabled={busy}
                  onClick={() => {
                    const prefix = bulkSkuPrefix.trim();
                    if (prefix) {
                      setVariantRows((prev) =>
                        prev.map((row, i) => ({
                          ...row,
                          sku: `${prefix}-${String(i + 1).padStart(3, "0")}`,
                        })),
                      );
                      setErrors((prev) => ({ ...prev, variantRowsSku: "" }));
                    }
                  }}
                >
                  {t("form.bulk_sku_auto")}
                </Button>
              </div>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  value={bulkStock}
                  onChange={(event) =>
                    setBulkStock(event.currentTarget.value)
                  }
                  placeholder={t("form.bulk_stock_placeholder")}
                  className="h-8 w-20 rounded-lg border border-border bg-card px-2 text-xs font-semibold"
                  disabled={busy}
                />
                <Button
                  type="button"
                  variant="secondary"
                  className="h-8 px-3 text-xs"
                  disabled={busy}
                  onClick={() => {
                    if (bulkStock !== "" && !Number.isNaN(Number(bulkStock)))
                      setVariantRows((prev) =>
                        prev.map((row) => ({
                          ...row,
                          inventory: String(Number(bulkStock)),
                        })),
                      );
                  }}
                >
                  {t("form.bulk_stock_apply")}
                </Button>
              </div>
            </div>
            <ul className="space-y-3 sm:hidden">
              {variantRows.map((row, i) => (
                <li key={row.key} className="space-y-3 rounded-xl border border-border p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground">{row.key}</p>
                      {row.existingId && (
                        <span className="text-[11px] font-semibold text-tone-success-text">{t("form.variant_saved_badge")}</span>
                      )}
                    </div>
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      {t("form.variant_active")}
                      <input
                        type="checkbox"
                        checked={row.active}
                        onChange={(event) => updateVariantRow(i, "active", event.currentTarget.checked)}
                        disabled={busy}
                        className="size-5 accent-primary"
                      />
                    </label>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="space-y-1 text-xs text-muted-foreground">
                      {t("form.variant_price")} ({common("currency.symbol")})
                      <input type="number" inputMode="decimal" value={row.price} onChange={(event) => updateVariantRow(i, "price", event.currentTarget.value)} className="h-10 w-full rounded-lg border bg-card px-2 text-sm font-medium tabular-nums border-border" disabled={busy} />
                    </label>
                    <label className="space-y-1 text-xs text-muted-foreground">
                      {t("form.variant_sku")}
                      <input value={row.sku} onChange={(event) => { updateVariantRow(i, "sku", event.currentTarget.value); setErrors((prev) => ({ ...prev, variantRowsSku: "" })); }} placeholder={t("form.sku_placeholder")} className="h-10 w-full rounded-lg border bg-card px-2 text-sm font-medium tabular-nums border-border" disabled={busy} dir="ltr" />
                    </label>
                    <label className="space-y-1 text-xs text-muted-foreground">
                      {t("form.variant_stock")}
                      <input type="number" inputMode="numeric" value={row.inventory} onChange={(event) => updateVariantRow(i, "inventory", event.currentTarget.value)} className="h-10 w-full rounded-lg border bg-card px-2 text-sm font-medium tabular-nums border-border" disabled={busy} />
                    </label>
                    <label className="space-y-1 text-xs text-muted-foreground">
                      {t("form.variant_threshold")}
                      <input type="number" inputMode="numeric" value={row.lowStockThreshold} onChange={(event) => updateVariantRow(i, "lowStockThreshold", event.currentTarget.value)} className="h-10 w-full rounded-lg border bg-card px-2 text-sm font-medium tabular-nums border-tone-warning-border bg-tone-warning-bg" disabled={busy} />
                    </label>
                  </div>
                  {showImageCol && (
                    <VariantImagePicker images={existingImages} value={row.imageId ?? null} onChange={(imageId) => updateVariantImageId(i, imageId)} disabled={busy} />
                  )}
                </li>
              ))}
            </ul>
            <div className="hidden overflow-x-auto rounded-xl border border-border sm:block">
              <div
                className={showImageCol ? "min-w-[800px]" : "min-w-[680px]"}
              >
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-start">
                        {t("form.variant_label")}
                      </TableHead>
                      <TableHead className="text-start">
                        {t("form.variant_price")} ({common("currency.symbol")}
                        )
                      </TableHead>
                      <TableHead className="text-start">
                        {t("form.variant_sku")}
                      </TableHead>
                      <TableHead className="text-start">
                        {t("form.variant_stock")}
                      </TableHead>
                      <TableHead className="text-start">
                        {t("form.variant_threshold")}
                      </TableHead>
                      <TableHead className="text-center">
                        {t("form.variant_active")}
                      </TableHead>
                      {showImageCol && (
                        <TableHead className="text-center">
                          {t("form.variant_image")}
                        </TableHead>
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {variantRows.map((row, i) => (
                      <TableRow key={row.key} className="hover:bg-muted/20">
                        <TableCell>
                          <p className="text-sm font-semibold text-foreground">
                            {row.key}
                          </p>
                          {row.existingId && (
                            <span className="text-[11px] font-semibold tracking-tighter text-tone-success-text">
                              {t("form.variant_saved_badge")}
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          <input
                            type="number"
                            value={row.price}
                            onChange={(event) =>
                              updateVariantRow(
                                i,
                                "price",
                                event.currentTarget.value,
                              )
                            }
                            className="h-9 w-28 rounded-lg border border-border bg-card px-2 text-xs font-medium tabular-nums"
                            disabled={busy}
                          />
                        </TableCell>
                        <TableCell>
                          <input
                            value={row.sku}
                            onChange={(event) => {
                              updateVariantRow(
                                i,
                                "sku",
                                event.currentTarget.value,
                              );
                              setErrors((prev) => ({
                                ...prev,
                                variantRowsSku: "",
                              }));
                            }}
                            placeholder={t("form.sku_placeholder")}
                            className="h-9 w-28 rounded-lg border border-border bg-card px-2 text-[11px] font-semibold"
                            disabled={busy}
                            dir="ltr"
                          />
                        </TableCell>
                        <TableCell>
                          <input
                            type="number"
                            value={row.inventory}
                            onChange={(event) =>
                              updateVariantRow(
                                i,
                                "inventory",
                                event.currentTarget.value,
                              )
                            }
                            className="h-9 w-20 rounded-lg border border-border bg-card px-2 text-xs font-medium tabular-nums"
                            disabled={busy}
                          />
                        </TableCell>
                        <TableCell>
                          <input
                            type="number"
                            value={row.lowStockThreshold}
                            onChange={(event) =>
                              updateVariantRow(
                                i,
                                "lowStockThreshold",
                                event.currentTarget.value,
                              )
                            }
                            className="h-9 w-20 rounded-lg border border-tone-warning-border bg-tone-warning-bg px-2 text-xs font-medium tabular-nums"
                            disabled={busy}
                          />
                        </TableCell>
                        <TableCell className="text-center">
                          <input
                            type="checkbox"
                            checked={row.active}
                            onChange={(event) =>
                              updateVariantRow(
                                i,
                                "active",
                                event.currentTarget.checked,
                              )
                            }
                            disabled={busy}
                            className="size-5 accent-primary"
                          />
                        </TableCell>
                        {showImageCol && (
                          <TableCell className="text-center">
                            <VariantImagePicker
                              images={existingImages}
                              value={row.imageId ?? null}
                              onChange={(imageId) =>
                                updateVariantImageId(i, imageId)
                              }
                              disabled={busy}
                            />
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          </div>
        </Card>
      )}
    </>
  );
}
