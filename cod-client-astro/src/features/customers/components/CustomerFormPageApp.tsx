import { useEffect, useState } from "react";
import { Phone } from "lucide-react";
import { canScope, RequireAuth, useIdentity } from "@/features/auth/components/RequireAuth";
import { DashboardPage } from "@/components/layout/page";
import { useLocale, useT } from "@/i18n/react";
import { notify } from "@/lib/notify";
import { SCOPES } from "../../../../../cod-shared/rbac/scopes";
import { createCustomer, getCustomer, updateCustomer } from "@/features/customers/api";
import { listWilayas, listCommunes } from "@/features/geography/api";
import { customerErrorMessage } from "@/features/customers/model";
import type { Commune, Wilaya } from "@/features/orders/types";
import type { CustomerFormValues } from "@/features/customers/types";
import { Alert, Card, Field, FormPage, Input, Select, Textarea } from "@/components/ui";

const EMPTY_FORM: CustomerFormValues = { name: "", phone: "", phone2: "", wilayaId: "", communeId: "", address: "" };

function CustomerForm({ customerId }: { customerId?: string }) {
  const t = useT("customers");
  const auth = useT("auth");
  const locale = useLocale();
  const identity = useIdentity();
  const editing = Boolean(customerId);
  const [form, setForm] = useState<CustomerFormValues>(EMPTY_FORM);
  const [wilayas, setWilayas] = useState<Wilaya[]>([]);
  const [communes, setCommunes] = useState<Commune[]>([]);
  const [loading, setLoading] = useState(true);
  const [communesLoading, setCommunesLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  const canLoadExisting = !editing || (canScope(identity, SCOPES.CUSTOMERS_READ) && canScope(identity, SCOPES.CUSTOMERS_UPDATE));
  const canSave = editing ? canLoadExisting : canScope(identity, SCOPES.CUSTOMERS_CREATE);

  useEffect(() => {
    let alive = true;
    if (!canLoadExisting) { setLoading(false); return; }
    Promise.all([listWilayas(), customerId ? getCustomer(customerId) : Promise.resolve(null)])
      .then(([nextWilayas, customer]) => {
        if (!alive) return;
        setWilayas(nextWilayas);
        if (customer) setForm({ name: customer.name, phone: customer.phone, phone2: customer.phone2 ?? "", wilayaId: customer.wilayaId ? String(customer.wilayaId) : "", communeId: customer.communeId ?? "", address: customer.address ?? "" });
      })
      .catch((cause) => { if (alive) setMessage(customerErrorMessage(cause, t)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [customerId, canLoadExisting]);

  useEffect(() => {
    if (!form.wilayaId) { setCommunes([]); return; }
    let alive = true;
    setCommunesLoading(true);
    listCommunes(Number(form.wilayaId))
      .then((rows) => { if (alive) setCommunes(rows); })
      .catch(() => { if (alive) setCommunes([]); })
      .finally(() => { if (alive) setCommunesLoading(false); });
    return () => { alive = false; };
  }, [form.wilayaId]);

  function update<K extends keyof CustomerFormValues>(key: K, value: CustomerFormValues[K]) { setForm((current) => ({ ...current, [key]: value })); }
  function validate() {
    const next: Record<string, string> = {};
    if (!form.name.trim()) next.name = t("form.error_name_required");
    if (!/^0[5-7]\d{8}$/.test(form.phone.trim())) next.phone = t("form.error_phone_required");
    if (form.phone2.trim() && !/^0[5-7]\d{8}$/.test(form.phone2.trim())) next.phone2 = t("form.error_phone2_invalid");
    if (!form.wilayaId) next.wilayaId = t("form.error_wilaya_required");
    if (!form.communeId) next.communeId = t("form.error_commune_required");
    setErrors(next);
    return Object.keys(next).length === 0;
  }
  async function save() {
    if (!validate()) return;
    setBusy(true);
    setMessage(null);
    const body = { name: form.name.trim(), phone: form.phone.trim(), phone2: form.phone2.trim() || null, wilayaId: Number(form.wilayaId), communeId: form.communeId, address: form.address.trim() };
    try {
      const customer = customerId
        ? await updateCustomer(customerId, { ...body, address: body.address || null })
        : await createCustomer({ ...body, address: body.address || undefined });
      notify.flashSuccess(t(customerId ? "form.success_edit" : "form.success_add"));
      window.location.assign(`/customers/${encodeURIComponent(customer.id)}`);
    } catch (cause) {
      const message = customerErrorMessage(cause, t);
      setMessage(message);
      notify.error(message);
      setBusy(false);
    }
  }
  if (!canSave || (editing && message && !form.name && !form.phone)) return <Alert role="alert" tone="critical">{message ?? auth("no_access")}</Alert>;
  if (loading) return <div role="status" aria-busy="true" className="space-y-4"><div className="h-20 shimmer rounded-xl" /><div className="h-72 shimmer rounded-xl" /></div>;

  const backHref = customerId ? `/customers/${encodeURIComponent(customerId)}` : "/customers";
  const phoneInput = (key: "phone" | "phone2", placeholder: string) => (
    <div className="relative">
      <Phone size={15} aria-hidden="true" className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
      <Input value={form[key]} onChange={(event) => update(key, event.currentTarget.value)} placeholder={placeholder} inputMode="tel" dir="ltr" className="ps-9" disabled={busy} />
    </div>
  );
  return (
    <FormPage
      title={editing ? t("form.title_edit") : t("form.title_add")}
      backHref={backHref}
      error={message}
      onSave={() => void save()}
      saving={busy}
    >
      <Card title={t("profile.contact_info")}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t("form.name_label")} error={errors.name} className="sm:col-span-2">
            <Input value={form.name} onChange={(event) => update("name", event.currentTarget.value)} placeholder={t("form.name_placeholder")} disabled={busy} />
          </Field>
          <Field label={t("form.phone_label")} error={errors.phone}>
            {phoneInput("phone", t("form.phone_placeholder"))}
          </Field>
          <Field label={t("form.phone2_label")} error={errors.phone2}>
            {phoneInput("phone2", t("form.phone2_placeholder"))}
          </Field>
        </div>
      </Card>
      <Card title={t("form.address_section")}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t("form.wilaya_label")} error={errors.wilayaId}>
            <Select value={form.wilayaId} onChange={(event) => { update("wilayaId", event.currentTarget.value); update("communeId", ""); }} disabled={busy}>
              <option value="">{t("form.wilaya_placeholder")}</option>
              {wilayas.map((wilaya) => <option key={wilaya.id} value={wilaya.id}>{locale === "ar" ? wilaya.nameAr : wilaya.name}</option>)}
            </Select>
          </Field>
          <Field label={t("form.commune_label")} error={errors.communeId}>
            <Select value={form.communeId} onChange={(event) => update("communeId", event.currentTarget.value)} disabled={busy || !form.wilayaId || communesLoading}>
              <option value="">{communesLoading ? t("form.commune_loading") : t("form.commune_placeholder")}</option>
              {communes.map((commune) => <option key={commune.id} value={commune.id}>{locale === "ar" ? commune.nameAr : commune.name}</option>)}
            </Select>
          </Field>
          <Field label={t("form.address_label")} className="sm:col-span-2">
            <Textarea value={form.address} onChange={(event) => update("address", event.currentTarget.value)} placeholder={t("form.address_placeholder")} disabled={busy} rows={3} />
          </Field>
        </div>
      </Card>
    </FormPage>
  );
}

function Gated({ customerId }: { customerId?: string }) {
  return <DashboardPage narrow><CustomerForm customerId={customerId} /></DashboardPage>;
}

export default function CustomerFormPageApp({ customerId }: { customerId?: string }) { return <RequireAuth><Gated customerId={customerId} /></RequireAuth>; }
