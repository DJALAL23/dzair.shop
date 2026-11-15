import { useState, type ReactNode } from "react";
import { Check, CircleStop, Receipt, Trash2 } from "lucide-react";
import { Alert, Button, Dialog, Field, Input, SearchPicker, Select, useConfirmDialog, type PickerOption } from "@/components/ui";
import { useLocale, useT } from "@/i18n/react";
import { notify } from "@/lib/notify";
import { formatStoreDay, storeDay } from "@/lib/store-time";
import { listProducts } from "@/features/products/api";
import { COST_CATEGORIES, CURRENCIES, PER_ORDER_CHARGES, REPEATING_CHARGES, isPerOrder, type PerOrderCharge, type RepeatingCharge } from "../../../../../cod-shared/finance/model";
import { createCost, deleteCost, updateCost } from "@/features/finance/api";
import { changedMeanwhile, chargeKind, costStatus, financeError, formatAmount, formatDinars, parseAmount, perMonth, PRESETS, rateOn, targetKey, type ChargeKind, type CostPreset } from "@/features/finance/model";
import type { Cost, CostCategory, CostInput, CostProduct, Currency, ExchangeRate } from "@/features/finance/types";

const KINDS: ChargeKind[] = ["once", "repeats", "per_order"];

function Segmented<T extends string>({ value, options, onChange, label, disabled }: { value: T; options: { value: T; label: string; disabled?: boolean }[]; onChange: (value: T) => void; label: string; disabled?: boolean }) {
  return (
    <div role="radiogroup" aria-label={label} className={`grid gap-1 rounded-lg bg-muted p-1 ${options.length === 2 ? "grid-cols-2" : "grid-cols-3"}`}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          disabled={disabled || option.disabled}
          onClick={() => onChange(option.value)}
          className={`min-h-9 rounded-md px-2 text-sm font-medium transition-colors disabled:opacity-50 ${value === option.value ? "bg-card text-foreground shadow-card" : "text-muted-foreground hover:text-foreground"}`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/**
 * One cost, added or changed: what it is, what it costs, when it is charged
 * and what it is for. A new cost can start from what stores usually pay
 * for, and says what does not belong here. A change of what a cost that
 * already ran costs, or is for, asks from which day, today at the latest,
 * so the days before keep theirs. Stopping keeps it in the months it ran;
 * deleting is for a mistake. A cost someone changed meanwhile is not
 * overwritten: the list reloads. Without the right to change costs, it only
 * shows.
 */
export function CostSheet({ cost, preset, rates, canManage, onClose, onChanged }: { cost: Cost | null; preset: CostPreset | null; rates: ExchangeRate[]; canManage: boolean; onClose: () => void; onChanged: () => void }) {
  const t = useT("finance");
  const common = useT("common");
  const locale = useLocale();
  const confirm = useConfirmDialog();
  const today = storeDay();
  const start = cost?.charge ?? preset?.charge ?? "monthly";
  const [name, setName] = useState(cost?.name ?? (preset ? t(`presets.${preset.key}`) : ""));
  const [category, setCategory] = useState<CostCategory>(cost?.category ?? preset?.category ?? "other");
  const [amountText, setAmountText] = useState(cost ? String(cost.amount) : "");
  const [currency, setCurrency] = useState<Currency>(cost?.currency ?? preset?.currency ?? "DZD");
  const [kind, setKind] = useState<ChargeKind>(chargeKind(start));
  const [every, setEvery] = useState<RepeatingCharge>(chargeKind(start) === "repeats" ? (start as RepeatingCharge) : "monthly");
  const [perOrder, setPerOrder] = useState<PerOrderCharge>(isPerOrder(start) ? start : "per_delivered");
  const [startsOn, setStartsOn] = useState(cost?.startsOn ?? today);
  const [running, setRunning] = useState(cost ? cost.stopsOn === null : true);
  const [stopsOn, setStopsOn] = useState(cost?.stopsOn ?? today);
  const [forProduct, setForProduct] = useState(cost?.product != null);
  const [product, setProduct] = useState<PickerOption | null>(cost?.product ? { id: cost.product.id ?? "", label: cost.product.id === null ? t("list.product_gone", { name: cost.product.name }) : cost.product.name } : null);
  const [changeFrom, setChangeFrom] = useState(cost && cost.stopsOn !== null && cost.stopsOn < today ? cost.since : today);
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function pick(next: CostPreset) {
    setName(t(`presets.${next.key}`));
    setCategory(next.category);
    setCurrency(next.currency);
    setKind(chargeKind(next.charge));
    if (chargeKind(next.charge) === "repeats") setEvery(next.charge as RepeatingCharge);
    if (isPerOrder(next.charge)) setPerOrder(next.charge);
  }

  const charge = kind === "once" ? "once" : kind === "repeats" ? every : perOrder;
  const amount = parseAmount(amountText);
  const moneyChanged = cost !== null && (amount !== cost.amount || currency !== cost.currency || charge !== cost.charge);
  const productChanged = cost !== null && (forProduct ? product !== null && (product.id || null) !== (cost.product?.id ?? null) : cost.product !== null);
  const askFrom = cost !== null && (moneyChanged || productChanged) && kind !== "once" && cost.charge !== "once" && cost.since < today;
  const lastFrom = kind !== "once" && !running && stopsOn < today ? stopsOn : today;
  const problems = {
    name: !name.trim(),
    amount: amount === null,
    dates: kind !== "once" && !running && stopsOn < startsOn,
    product: forProduct && !product,
    from: askFrom && (changeFrom < startsOn || changeFrom > lastFrom),
  };
  const shows = (key: keyof typeof problems) => showErrors && problems[key];
  const status = cost ? costStatus(cost, today) : null;

  async function save() {
    setShowErrors(true);
    if (Object.values(problems).some(Boolean) || amount === null) return;
    const input: CostInput = {
      name: name.trim(),
      category,
      charge,
      amount,
      currency,
      startsOn,
      stopsOn: kind === "once" || running ? null : stopsOn,
      ...(cost === null || productChanged ? { productId: forProduct ? product!.id : null } : {}),
      ...(askFrom ? { changeFrom } : {}),
    };
    setBusy(true);
    setError(null);
    try {
      if (cost) await updateCost(cost.id, input, cost.revision);
      else await createCost(input);
      notify.success(t(cost ? "feedback.saved" : "feedback.added"));
      onChanged();
      onClose();
    } catch (cause) {
      refused(cause);
    } finally {
      setBusy(false);
    }
  }

  function refused(cause: unknown) {
    if (!changedMeanwhile(cause)) return setError(financeError(cause, t));
    notify.error(t("errors.changed"));
    onChanged();
    onClose();
  }

  async function stop() {
    if (!cost) return;
    const ok = await confirm({ title: t("sheet.stop_title", { name: cost.name }), description: t("sheet.stop_body"), confirmLabel: t("sheet.stop") });
    if (!ok) return;
    setBusy(true);
    try {
      await updateCost(cost.id, { name: cost.name, category: cost.category, charge: cost.charge, amount: cost.amount, currency: cost.currency, startsOn: cost.startsOn, stopsOn: today }, cost.revision);
      notify.success(t("feedback.stopped"));
      onChanged();
      onClose();
    } catch (cause) {
      refused(cause);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!cost) return;
    const ok = await confirm({ title: t("sheet.delete_title", { name: cost.name }), description: t("sheet.delete_body"), confirmLabel: t("sheet.delete"), tone: "danger" });
    if (!ok) return;
    setBusy(true);
    try {
      await deleteCost(cost.id);
      notify.success(t("feedback.deleted"));
      onChanged();
      onClose();
    } catch (cause) {
      refused(cause);
    } finally {
      setBusy(false);
    }
  }

  const searchProducts = async (query: string): Promise<PickerOption[]> =>
    (await listProducts({ search: query || undefined, limit: 20 })).data.map((found) => ({ id: found.id, label: found.name, ...(found.sku ? { detail: found.sku } : {}) }));

  let preview: ReactNode = null;
  if (kind === "repeats" && amount !== null) {
    const monthly = perMonth(amount, every);
    const rate = currency === "DZD" ? null : rateOn(rates, currency, today);
    if (currency !== "DZD" && !rate) preview = <span className="text-tone-warning-text">{t("sheet.no_rate")}</span>;
    else if (rate) preview = t("sheet.preview_dzd", { amount: formatDinars(monthly * rate.dzdPerUnit, locale) });
    else if (every !== "monthly") preview = t("sheet.preview_month", { amount: formatAmount(Math.round(monthly), "DZD", locale) });
  } else if (currency !== "DZD" && !rateOn(rates, currency, today)) preview = <span className="text-tone-warning-text">{t("sheet.no_rate")}</span>;

  const title = cost ? (canManage ? t("sheet.edit_title") : t("sheet.view_title")) : t("sheet.add_title");
  const productLabel = (value: CostProduct) => (value === null ? t("sheet.history_store") : t("sheet.history_for", { name: value.id === null ? t("list.product_gone", { name: value.name }) : value.name }));

  return (
    <Dialog
      open
      onClose={() => !busy && onClose()}
      placement="end"
      title={title}
      icon={<Receipt size={17} aria-hidden="true" />}
      footer={
        canManage ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex gap-2">
              {cost && status === "running" && (
                <Button type="button" variant="secondary" disabled={busy} onClick={() => void stop()}>
                  <CircleStop size={14} aria-hidden="true" />
                  {t("sheet.stop")}
                </Button>
              )}
              {cost && (
                <Button type="button" variant="dangerOutline" disabled={busy} onClick={() => void remove()} aria-label={t("sheet.delete")} title={t("sheet.delete")}>
                  <Trash2 size={14} aria-hidden="true" />
                  <span className="max-sm:sr-only">{t("sheet.delete")}</span>
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>
                {common("cancel")}
              </Button>
              <Button type="button" disabled={busy} onClick={() => void save()}>
                <Check size={15} aria-hidden="true" />
                {busy ? common("saving") : common("save")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex justify-end">
            <Button type="button" variant="secondary" onClick={onClose}>
              {common("close")}
            </Button>
          </div>
        )
      }
    >
      <fieldset disabled={!canManage || busy} className="min-w-0 space-y-5">
        {error && (
          <Alert tone="critical" role="alert">
            {error}
          </Alert>
        )}

        {!cost && (
          <div>
            <p className="mb-2 text-xs font-semibold text-muted-foreground">{t("sheet.start_from")}</p>
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map((option) => (
                <button key={option.key} type="button" onClick={() => pick(option)} className="rounded-full border border-border px-3 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted">
                  {t(`presets.${option.key}`)}
                </button>
              ))}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">{t("sheet.not_here")}</p>
          </div>
        )}

        <Field label={t("sheet.name")} error={shows("name") ? t("errors.name") : undefined}>
          <Input value={name} onChange={(event) => setName(event.currentTarget.value)} maxLength={80} placeholder={t("sheet.name_placeholder")} />
        </Field>

        <Field label={t("sheet.category")} as="div" hint={category === "salaries" ? t("category_help.salaries") : undefined}>
          <Select value={category} onChange={(event) => setCategory(event.currentTarget.value as CostCategory)} aria-label={t("sheet.category")}>
            {COST_CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {t(`category.${value}`)}
              </option>
            ))}
          </Select>
        </Field>

        <Field label={t("sheet.charged")} as="div">
          <Segmented
            label={t("sheet.charged")}
            value={kind}
            onChange={setKind}
            options={KINDS.map((value) => ({ value, label: t(`kinds.${value}`), disabled: cost !== null && cost.history.length > 0 && (value === "once") !== (cost.charge === "once") }))}
          />
        </Field>

        {kind === "repeats" && (
          <Field label={t("sheet.every")} as="div">
            <Select value={every} onChange={(event) => setEvery(event.currentTarget.value as RepeatingCharge)} aria-label={t("sheet.every")}>
              {REPEATING_CHARGES.map((value) => (
                <option key={value} value={value}>
                  {t(`charge.${value}`)}
                </option>
              ))}
            </Select>
          </Field>
        )}

        {kind === "per_order" && (
          <Field label={t("sheet.on_each")} as="div" hint={t(`charge_help.${perOrder}`)}>
            <Select value={perOrder} onChange={(event) => setPerOrder(event.currentTarget.value as PerOrderCharge)} aria-label={t("sheet.on_each")}>
              {PER_ORDER_CHARGES.map((value) => (
                <option key={value} value={value}>
                  {t(`charge.${value}`)}
                </option>
              ))}
            </Select>
          </Field>
        )}

        <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-3">
          <Field
            label={t("sheet.amount")}
            hint={cost && cost.since !== cost.startsOn && !moneyChanged ? t("sheet.amount_since", { date: formatStoreDay(cost.since, locale) }) : t(`sheet.amount_hint_${kind}`)}
            error={shows("amount") ? t("errors.amount") : undefined}
          >
            <Input value={amountText} onChange={(event) => setAmountText(event.currentTarget.value)} inputMode="decimal" dir="ltr" placeholder="0" />
          </Field>
          <Field label={t("sheet.currency")} as="div">
            <Select value={currency} onChange={(event) => setCurrency(event.currentTarget.value as Currency)} aria-label={t("sheet.currency")}>
              {CURRENCIES.map((value) => (
                <option key={value} value={value}>
                  {t(`currency.${value}`)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {preview && <p className="-mt-3 text-xs text-muted-foreground">{preview}</p>}

        {askFrom && (
          <Field
            label={t("sheet.change_from")}
            hint={t("sheet.change_from_hint")}
            error={shows("from") ? t("errors.change_from", { from: formatStoreDay(startsOn, locale), to: formatStoreDay(lastFrom, locale) }) : undefined}
          >
            <Input type="date" value={changeFrom} min={startsOn} max={lastFrom} onChange={(event) => setChangeFrom(event.currentTarget.value)} />
          </Field>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={kind === "once" ? t("sheet.paid_on") : t("sheet.starts_on")}>
            <Input type="date" value={startsOn} onChange={(event) => setStartsOn(event.currentTarget.value)} />
          </Field>
          {kind !== "once" && (
            <Field label={t("sheet.stops_on")} as="div" error={shows("dates") ? t("errors.stops_before") : undefined}>
              <label className="flex min-h-10 items-center gap-2 text-sm text-foreground">
                <input type="checkbox" checked={running} onChange={(event) => setRunning(event.currentTarget.checked)} className="size-4 accent-primary" />
                {t("sheet.still_running")}
              </label>
              {!running && <Input type="date" value={stopsOn} min={startsOn} onChange={(event) => setStopsOn(event.currentTarget.value)} aria-label={t("sheet.stops_on")} />}
            </Field>
          )}
        </div>

        <Field label={t("sheet.applies_to")} as="div" error={shows("product") ? t("errors.product") : undefined}>
          <Segmented
            label={t("sheet.applies_to")}
            value={forProduct ? "product" : "store"}
            onChange={(value) => {
              setForProduct(value === "product");
              if (product?.id === "") setProduct(null);
            }}
            options={[
              { value: "store", label: t("sheet.whole_store") },
              { value: "product", label: t("sheet.one_product") },
            ]}
          />
          {forProduct && (
            <div className="mt-2">
              <SearchPicker
                value={product}
                onChange={setProduct}
                search={searchProducts}
                placeholder={t("sheet.product_placeholder")}
                emptyLabel={t("sheet.product_empty")}
                aria-label={t("sheet.one_product")}
              />
            </div>
          )}
        </Field>

        {cost && cost.history.length > 0 && (
          <section aria-labelledby="cost-history" className="rounded-lg bg-muted/60 p-3">
            <h3 id="cost-history" className="text-xs font-semibold text-foreground">
              {t("sheet.history")}
            </h3>
            <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
              {cost.history.map((entry) => {
                const values = { amount: formatAmount(entry.amount, entry.currency, locale), charge: t(`charge.${entry.charge}`), from: formatStoreDay(entry.validFrom, locale), to: formatStoreDay(entry.validTo, locale) };
                return (
                  <li key={entry.validFrom}>
                    {targetKey(entry.product) === targetKey(cost.product) ? t("sheet.history_line", values) : t("sheet.history_line_for", { ...values, target: productLabel(entry.product) })}
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </fieldset>
    </Dialog>
  );
}
