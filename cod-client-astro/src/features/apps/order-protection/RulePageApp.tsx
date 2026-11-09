import { useEffect, useRef, useState } from "react";
import { Ban, CheckCircle2, Flag, Plus, X } from "lucide-react";
import { canScope, RequireAuth, useIdentity } from "@/features/auth/components/RequireAuth";
import { DashboardPage } from "@/components/layout/page";
import { Alert, Card, Dialog, Field, FormPage, IconButton, Input, SearchPickList, Select, Textarea, type PickerOption } from "@/components/ui";
import { useLocale, useT } from "@/i18n/react";
import { listProducts } from "@/features/products/api";
import { createRule, getProtection, updateRule } from "@/features/apps/order-protection/api";
import { blankCondition, CONDITION_GROUPS, formFromCondition, ruleFromForm, ruleIssueKey, valueInputOf, wilayaOptions, withOperator, type ConditionForm, type RuleForm } from "@/features/apps/order-protection/model";
import { CONDITIONS, RULE_ACTIONS, RULE_LIMITS, RULE_MODES, WINDOW_HOURS, type ConditionKey, type Operator, type RuleAction } from "../../../../../cod-shared/order-screening/conditions";
import { SCOPES } from "../../../../../cod-shared/rbac/scopes";

const BACK = "/apps/order-protection";
const ACTION_ICON = { spam: Ban, flag: Flag, accept: CheckCircle2 } satisfies Record<RuleAction, unknown>;

async function searchProducts(query: string): Promise<PickerOption[]> {
  const { data } = await listProducts({ search: query || undefined, limit: 20 });
  return data.map((product) => ({ id: product.id, label: product.name, detail: product.sku ?? undefined }));
}

function ConditionValue({ form, onChange, readOnly }: { form: ConditionForm; onChange: (next: ConditionForm) => void; readOnly: boolean }) {
  const t = useT("apps");
  const locale = useLocale();
  const pickers = { placeholder: t("order_protection.editor.search"), emptyLabel: t("order_protection.editor.no_match"), disabled: readOnly };

  switch (valueInputOf(form.key, form.op)) {
    case "none":
      return null;
    case "number":
      return <div className="w-28"><Input type="number" inputMode="numeric" min={0} dir="ltr" aria-label={t("order_protection.editor.value")} disabled={readOnly} value={form.number} onChange={(event) => onChange({ ...form, number: event.currentTarget.value })} /></div>;
    case "window":
      return (
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-24"><Input type="number" inputMode="numeric" min={1} dir="ltr" aria-label={t("order_protection.editor.count")} disabled={readOnly} value={form.count} onChange={(event) => onChange({ ...form, count: event.currentTarget.value })} /></div>
          <Select aria-label={t("order_protection.editor.window")} disabled={readOnly} value={form.windowHours} onChange={(event) => onChange({ ...form, windowHours: Number(event.currentTarget.value) })}>
            {WINDOW_HOURS.map((hours) => (
              <option key={hours} value={hours}>
                {t(`order_protection.windows.${hours}`)}
              </option>
            ))}
          </Select>
        </div>
      );
    case "text":
      return <Textarea rows={2} aria-label={t("order_protection.editor.value")} placeholder={t(form.key === "network_country" ? "order_protection.editor.country_hint" : "order_protection.editor.list_hint")} disabled={readOnly} value={form.text} onChange={(event) => onChange({ ...form, text: event.currentTarget.value })} />;
    case "wilaya": {
      const options = wilayaOptions(locale);
      return <SearchPickList {...pickers} value={form.picked} onChange={(picked) => onChange({ ...form, picked })} search={async (query) => options.filter((option) => option.label.toLowerCase().includes(query.trim().toLowerCase()))} />;
    }
    case "product":
      return <SearchPickList {...pickers} value={form.picked} onChange={(picked) => onChange({ ...form, picked })} search={searchProducts} />;
    case "options":
      return (
        <div className="flex flex-wrap gap-x-4 gap-y-2 py-1.5">
          {(CONDITIONS[form.key].options ?? []).map((option) => {
            const label = t(`order_protection.options.${form.key}.${option}`);
            return (
              <label key={option} className="flex items-center gap-2 text-sm text-foreground">
                <input type="checkbox" className="size-4 accent-[var(--primary)]" disabled={readOnly} checked={form.picked.some((picked) => picked.id === option)} onChange={(event) => onChange({ ...form, picked: event.currentTarget.checked ? [...form.picked, { id: option, label }] : form.picked.filter((picked) => picked.id !== option) })} />
                {label}
              </label>
            );
          })}
        </div>
      );
  }
}

function ConditionRow({ form, onChange, onRemove, readOnly }: { form: ConditionForm; onChange: (next: ConditionForm) => void; onRemove: () => void; readOnly: boolean }) {
  const t = useT("apps");
  const operators = CONDITIONS[form.key].operators;
  return (
    <div className="space-y-2 rounded-xl border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-foreground">{t(`order_protection.conditions.${form.key}`)}</p>
        {!readOnly && (
          <IconButton aria-label={t("order_protection.editor.remove_condition")} onClick={onRemove}>
            <X size={15} aria-hidden="true" />
          </IconButton>
        )}
      </div>
      <div className="flex flex-wrap items-start gap-2">
        {operators.length > 1 ? (
          <Select aria-label={t("order_protection.editor.operator")} disabled={readOnly} value={form.op} onChange={(event) => onChange(withOperator(form, event.currentTarget.value as Operator))}>
            {operators.map((op) => (
              <option key={op} value={op}>
                {t(`order_protection.operators.${op}`)}
              </option>
            ))}
          </Select>
        ) : (
          <p className="py-1.5 text-sm text-muted-foreground">{t(`order_protection.operators.${form.op}`)}</p>
        )}
        <div className="min-w-48 flex-1">
          <ConditionValue form={form} onChange={onChange} readOnly={readOnly} />
        </div>
      </div>
    </div>
  );
}

function ConditionPicker({ onPick, onClose }: { onPick: (key: ConditionKey) => void; onClose: () => void }) {
  const t = useT("apps");
  return (
    <Dialog title={t("order_protection.editor.picker_title")} onClose={onClose}>
      <div className="space-y-4">
        {CONDITION_GROUPS.map(({ group, keys }) => (
          <section key={group}>
            <h3 className="px-2 text-sm text-muted-foreground">{t(`order_protection.groups.${group}`)}</h3>
            <ul className="mt-1">
              {keys.map((key) => (
                <li key={key}>
                  <button type="button" onClick={() => onPick(key)} className="w-full rounded-lg px-2 py-2.5 text-start text-sm font-medium text-foreground hover:bg-foreground/[0.04]">
                    {t(`order_protection.conditions.${key}`)}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Dialog>
  );
}

function RuleEditor({ ruleId }: { ruleId: string | null }) {
  const t = useT("apps");
  const auth = useT("auth");
  const locale = useLocale();
  const identity = useIdentity();
  const canManage = canScope(identity, SCOPES.ORDER_PROTECTION_MANAGE);
  const nextUid = useRef(0);
  const uid = () => `c${(nextUid.current += 1)}`;
  const [form, setForm] = useState<RuleForm>({ name: "", mode: "trial", action: "", conditions: [] });
  const [loading, setLoading] = useState(Boolean(ruleId));
  const [notFound, setNotFound] = useState(false);
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ruleId) return;
    let alive = true;
    (async () => {
      const { rules } = await getProtection();
      const rule = rules.find((candidate) => candidate.id === ruleId);
      if (!alive) return;
      if (!rule?.conditions) {
        setNotFound(true);
        return;
      }
      const productIds = rule.conditions.some((condition) => condition.key === "product") ? new Map((await listProducts({ limit: 100 })).data.map((product) => [product.id, product.name])) : new Map<string, string>();
      if (!alive) return;
      const wilayas = wilayaOptions(locale);
      const label = (key: ConditionKey, value: string | number) => {
        if (key === "wilaya") return wilayas.find((option) => option.id === String(value))?.label ?? String(value);
        return productIds.get(String(value)) ?? String(value);
      };
      setForm({ name: rule.name, mode: rule.mode, action: rule.action, conditions: rule.conditions.map((condition) => formFromCondition(condition, uid(), label)) });
    })()
      .catch(() => alive && setNotFound(true))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [ruleId]);

  if (!canScope(identity, SCOPES.ORDER_PROTECTION_READ)) return <Alert tone="critical">{auth("no_access")}</Alert>;
  if (notFound) return <Alert tone="critical" role="alert">{t("order_protection.editor.not_found")}</Alert>;
  if (loading) return null;

  const update = (patch: Partial<RuleForm>) => setForm((current) => ({ ...current, ...patch }));
  const setCondition = (next: ConditionForm) => update({ conditions: form.conditions.map((condition) => (condition.uid === next.uid ? next : condition)) });

  async function save() {
    const parsed = ruleFromForm(form);
    if (!parsed.ok) {
      setError(t(`order_protection.${ruleIssueKey(parsed.code)}`));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (ruleId) await updateRule(ruleId, parsed.rule);
      else await createRule(parsed.rule);
      window.location.href = BACK;
    } catch {
      setError(t("order_protection.save_failed"));
      setSaving(false);
    }
  }

  return (
    <FormPage
      title={ruleId ? form.name || t("order_protection.editor.edit_title") : t("order_protection.editor.new_title")}
      backHref={BACK}
      error={error}
      onSave={() => void save()}
      saving={saving}
      canSave={canManage}
      badges={
        <Select variant="pill" aria-label={t("order_protection.rules.mode")} disabled={!canManage} value={form.mode} onChange={(event) => update({ mode: event.currentTarget.value })}>
          {RULE_MODES.map((mode) => (
            <option key={mode} value={mode}>
              {t(`order_protection.modes.${mode}`)}
            </option>
          ))}
        </Select>
      }
    >
      <Card>
        <Field label={t("order_protection.editor.name")}>
          <Input value={form.name} maxLength={RULE_LIMITS.nameLength} disabled={!canManage} onChange={(event) => update({ name: event.currentTarget.value })} />
        </Field>
      </Card>

      <Card title={t("order_protection.editor.if")} subtitle={form.conditions.length > 1 ? t("order_protection.editor.all_must_match") : undefined}>
        <div className="space-y-2">
          {form.conditions.map((condition) => (
            <ConditionRow key={condition.uid} form={condition} readOnly={!canManage} onChange={setCondition} onRemove={() => update({ conditions: form.conditions.filter((other) => other.uid !== condition.uid) })} />
          ))}
          {canManage && form.conditions.length < RULE_LIMITS.conditions && (
            <button type="button" onClick={() => setPicking(true)} className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-input py-5 text-sm font-medium text-foreground transition-colors hover:bg-foreground/[0.03]">
              <Plus size={15} aria-hidden="true" />
              {t("order_protection.editor.add_condition")}
            </button>
          )}
        </div>
      </Card>

      <Card title={t("order_protection.editor.then")} subtitle={t("order_protection.editor.then_hint")}>
        <div role="radiogroup" aria-label={t("order_protection.editor.then")} className="grid gap-2 sm:grid-cols-3">
          {RULE_ACTIONS.map((action) => {
            const Icon = ACTION_ICON[action];
            const selected = form.action === action;
            return (
              <button key={action} type="button" role="radio" aria-checked={selected} disabled={!canManage} onClick={() => update({ action })} className={`flex flex-col items-center gap-2 rounded-xl border p-4 text-sm font-medium text-foreground transition-colors ${selected ? "border-foreground bg-foreground/[0.03]" : "border-border hover:bg-foreground/[0.02]"}`}>
                <Icon size={20} aria-hidden="true" />
                {t(`order_protection.actions.${action}`)}
              </button>
            );
          })}
        </div>
      </Card>

      {picking && (
        <ConditionPicker
          onClose={() => setPicking(false)}
          onPick={(key) => {
            update({ conditions: [...form.conditions, blankCondition(key, uid())] });
            setPicking(false);
          }}
        />
      )}
    </FormPage>
  );
}

export default function RulePageApp() {
  return (
    <RequireAuth>
      <DashboardPage>
        <RuleEditor ruleId={new URLSearchParams(window.location.search).get("id")} />
      </DashboardPage>
    </RequireAuth>
  );
}
