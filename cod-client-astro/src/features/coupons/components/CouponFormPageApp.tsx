import { useEffect, useState, type ReactNode } from "react";
import { Percent, Shuffle, Truck, Wallet } from "lucide-react";
import { canScope, RequireAuth, useIdentity } from "@/features/auth/components/RequireAuth";
import { DashboardPage } from "@/components/layout/page";
import { Alert, Button, Card, Field, FormPage, Input, SearchPickList, Switch } from "@/components/ui";
import { useLocale, useT } from "@/i18n/react";
import { notify } from "@/lib/notify";
import { formatMoney } from "@/features/orders/model";
import { COUPON_KINDS, COUPON_PICK_LIMITS } from "../../../../../cod-shared/coupons/model";
import { SCOPES } from "../../../../../cod-shared/rbac/scopes";
import { createCoupon, getCoupon, updateCoupon } from "@/features/coupons/api";
import { couponBody, couponErrorMessage, couponForm, couponFormProblem, EMPTY_COUPON_FORM, generateCouponCode } from "@/features/coupons/model";
import { couponPickers } from "@/features/coupons/pickers";
import type { Coupon, CouponFormValues } from "@/features/coupons/types";

/** A set of choices shown as tiles, one selected. */
function Choice<V extends string>({ name, value, options, onChange, disabled }: { name: string; value: V; options: Array<{ value: V; label: string; icon?: ReactNode }>; onChange: (value: V) => void; disabled: boolean }) {
  return (
    <div className={`grid grid-cols-1 gap-2 ${options.length === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <label
            key={option.value}
            className={`flex min-h-10 cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 text-sm transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring ${
              selected ? "border-primary bg-subtle font-medium text-foreground" : "border-border text-muted-foreground hover:bg-subtle"
            }`}
          >
            <input type="radio" name={name} checked={selected} onChange={() => onChange(option.value)} disabled={disabled} className="sr-only" />
            {option.icon}
            <span>{option.label}</span>
          </label>
        );
      })}
    </div>
  );
}

function CouponForm({ couponId }: { couponId?: string }) {
  const t = useT("coupons");
  const auth = useT("auth");
  const locale = useLocale();
  const identity = useIdentity();
  const editing = Boolean(couponId);
  const canSave = canScope(identity, SCOPES.COUPONS_MANAGE) && (!editing || canScope(identity, SCOPES.COUPONS_READ));
  const [form, setForm] = useState<CouponFormValues>(EMPTY_COUPON_FORM);
  const [stored, setStored] = useState<Coupon | null>(null);
  const [loading, setLoading] = useState(editing);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!couponId) return;
    let alive = true;
    getCoupon(couponId)
      .then((coupon) => {
        if (!alive) return;
        setStored(coupon);
        setForm(couponForm(coupon));
      })
      .catch((cause) => alive && setMessage(couponErrorMessage(cause, t)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [couponId]);

  function update<K extends keyof CouponFormValues>(key: K, value: CouponFormValues[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setProblem(null);
  }

  async function save() {
    const reason = couponFormProblem(form);
    if (reason) {
      setProblem(t(`error_invalid.${reason}`));
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const body = couponBody(form, editing);
      if (couponId) await updateCoupon(couponId, body);
      else await createCoupon(body);
      notify.flashSuccess(t(couponId ? "form.success_edit" : "form.success_add"));
      window.location.assign("/coupons");
    } catch (cause) {
      const text = couponErrorMessage(cause, t);
      setMessage(text);
      notify.error(text);
      setBusy(false);
    }
  }

  if (!canSave || (editing && message && !stored))
    return (
      <Alert role="alert" tone="critical">
        {message ?? auth("no_access")}
      </Alert>
    );
  if (loading)
    return (
      <div role="status" aria-busy="true" className="space-y-4">
        <div className="h-20 shimmer rounded-xl" />
        <div className="h-72 shimmer rounded-xl" />
      </div>
    );

  const kindIcon = { percentage: <Percent size={16} aria-hidden="true" />, fixed_amount: <Wallet size={16} aria-hidden="true" />, free_shipping: <Truck size={16} aria-hidden="true" /> };
  const number = (key: "value" | "maxDiscount" | "minimumValue" | "usageLimit", props: { min: number; max?: number }) => (
    <Input type="number" {...props} value={form[key]} onChange={(event) => update(key, event.currentTarget.value)} className="max-w-40 tabular-nums" disabled={busy} />
  );

  return (
    <FormPage title={editing ? t("form.title_edit") : t("form.title_add")} backHref="/coupons" error={message ?? problem} onSave={() => void save()} saving={busy}>
      <Card>
        <div className="space-y-4">
          <Field label={t("form.code_label")} hint={t("form.code_hint")}>
            <div className="flex gap-2">
              <Input value={form.code} onChange={(event) => update("code", event.currentTarget.value)} placeholder="RAMADAN10" dir="ltr" className="font-mono uppercase" disabled={busy} />
              <Button variant="secondary" onClick={() => update("code", generateCouponCode())} disabled={busy}>
                <Shuffle size={15} aria-hidden="true" />
                {t("form.code_generate")}
              </Button>
            </div>
          </Field>
          {stored && (
            <p className="text-sm text-muted-foreground">
              {t("form.usage_stats", { count: stored.uses, amount: formatMoney(stored.discountGiven, locale) })}
            </p>
          )}
          <div className="flex items-center justify-between gap-4 border-t border-border pt-4">
            <span id="coupon-active" className="text-sm font-medium text-foreground">
              {t("form.status_active")}
            </span>
            <Switch checked={form.status === "active"} onChange={(on) => update("status", on ? "active" : "inactive")} disabled={busy} aria-labelledby="coupon-active" />
          </div>
        </div>
      </Card>

      <Card title={t("form.kind_label")}>
        <div className="space-y-4">
          <Choice name="kind" value={form.kind} onChange={(kind) => update("kind", kind)} disabled={busy} options={COUPON_KINDS.map((kind) => ({ value: kind, label: t(`kind.${kind}`), icon: kindIcon[kind] }))} />
          {form.kind === "percentage" && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label={t("form.value_percent_label")}>{number("value", { min: 1, max: 100 })}</Field>
              <Field label={t("form.max_discount_label")} hint={t("form.max_discount_hint")}>
                {number("maxDiscount", { min: 1 })}
              </Field>
            </div>
          )}
          {form.kind === "fixed_amount" && (
            <Field label={t("form.value_amount_label")} hint={t("form.value_amount_hint")}>
              {number("value", { min: 1 })}
            </Field>
          )}
          {form.kind === "free_shipping" && <p className="text-sm text-muted-foreground">{t("form.free_shipping_hint")}</p>}
        </div>
      </Card>

      <Card title={t("form.section_scope")} subtitle={t("form.offers_note")}>
        <div className="space-y-4">
          <Choice name="scope" value={form.scope} onChange={(scope) => update("scope", scope)} disabled={busy} options={(["store", "products", "collections"] as const).map((scope) => ({ value: scope, label: t(`form.scope.${scope}`) }))} />
          {form.scope === "products" && (
            <SearchPickList value={form.products} onChange={(next) => update("products", next)} search={couponPickers.products} placeholder={t("form.products_placeholder")} emptyLabel={t("form.picker_empty")} max={COUPON_PICK_LIMITS.productIds} disabled={busy} />
          )}
          {form.scope === "collections" && (
            <SearchPickList value={form.collections} onChange={(next) => update("collections", next)} search={couponPickers.collections} placeholder={t("form.collections_placeholder")} emptyLabel={t("form.picker_empty")} max={COUPON_PICK_LIMITS.collectionIds} disabled={busy} />
          )}
        </div>
      </Card>

      <Card title={t("form.section_minimum")} subtitle={t("form.minimum_hint")}>
        <div className="space-y-4">
          <Choice name="minimum" value={form.minimum} onChange={(minimum) => update("minimum", minimum)} disabled={busy} options={(["none", "subtotal", "quantity"] as const).map((minimum) => ({ value: minimum, label: t(`form.minimum.${minimum}`) }))} />
          {form.minimum !== "none" && (
            <Field label={t(form.minimum === "subtotal" ? "form.minimum_subtotal_label" : "form.minimum_quantity_label")}>{number("minimumValue", { min: 1 })}</Field>
          )}
        </div>
      </Card>

      <Card title={t("form.section_audience")} subtitle={t("form.audience_hint")}>
        <div className="space-y-4">
          <Choice name="audience" value={form.audience} onChange={(audience) => update("audience", audience)} disabled={busy} options={(["everyone", "selected"] as const).map((audience) => ({ value: audience, label: t(`form.audience.${audience}`) }))} />
          {form.audience === "selected" && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field as="div" label={t("form.customers_label")}>
                <SearchPickList value={form.customers} onChange={(next) => update("customers", next)} search={couponPickers.customers} placeholder={t("form.customers_placeholder")} emptyLabel={t("form.picker_empty")} max={COUPON_PICK_LIMITS.customerIds} disabled={busy} />
              </Field>
              <Field as="div" label={t("form.groups_label")}>
                <SearchPickList value={form.groups} onChange={(next) => update("groups", next)} search={couponPickers.groups} placeholder={t("form.groups_placeholder")} emptyLabel={t("form.picker_empty")} max={COUPON_PICK_LIMITS.groupIds} disabled={busy} />
              </Field>
            </div>
          )}
        </div>
      </Card>

      <Card title={t("form.section_limits")}>
        <div className="space-y-4">
          <Field label={t("form.usage_limit_label")} hint={t("form.usage_limit_hint")}>
            {number("usageLimit", { min: 1 })}
          </Field>
          <div className="flex items-center justify-between gap-4">
            <span id="coupon-once" className="text-sm font-medium text-foreground">
              {t("form.once_per_customer")}
            </span>
            <Switch checked={form.oncePerCustomer} onChange={(on) => update("oncePerCustomer", on)} disabled={busy} aria-labelledby="coupon-once" />
          </div>
        </div>
      </Card>

      <Card title={t("form.section_schedule")}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t("form.starts_at_label")}>
            <Input type="datetime-local" value={form.startsAt} onChange={(event) => update("startsAt", event.currentTarget.value)} disabled={busy} />
          </Field>
          <Field label={t("form.ends_at_label")}>
            <Input type="datetime-local" value={form.endsAt} onChange={(event) => update("endsAt", event.currentTarget.value)} disabled={busy} />
          </Field>
        </div>
      </Card>
    </FormPage>
  );
}

export default function CouponFormPageApp({ couponId }: { couponId?: string }) {
  return (
    <RequireAuth>
      <DashboardPage narrow>
        <CouponForm couponId={couponId} />
      </DashboardPage>
    </RequireAuth>
  );
}
