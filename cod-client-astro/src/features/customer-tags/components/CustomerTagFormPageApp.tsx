import { useEffect, useState } from "react";
import { canScope, RequireAuth, useIdentity } from "@/features/auth/components/RequireAuth";
import { DashboardChrome } from "@/components/layout/chrome";
import { useT } from "@/i18n/react";
import { notify } from "@/lib/notify";
import { SCOPES } from "../../../../../cod-shared/rbac/scopes";
import { createCustomerTag, getCustomerTag, updateCustomerTag } from "@/features/customer-tags/api";
import { customerTagErrorMessage } from "@/features/customer-tags/model";
import type { CustomerTagFormValues } from "@/features/customer-tags/types";
import { Alert, Card, ColorSwatches, Field, FormPage, Input, LABEL_COLORS } from "@/components/ui";


const EMPTY_FORM: CustomerTagFormValues = { name: "", color: LABEL_COLORS[0] };

function CustomerTagForm({ tagId }: { tagId?: string }) {
  const t = useT("customer-tags");
  const auth = useT("auth");
  const identity = useIdentity();
  const editing = Boolean(tagId);
  const [form, setForm] = useState<CustomerTagFormValues>(EMPTY_FORM);
  const [loading, setLoading] = useState(editing);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  const canLoadExisting = !editing || (canScope(identity, SCOPES.CUSTOMER_TAGS_READ) && canScope(identity, SCOPES.CUSTOMER_TAGS_MANAGE));
  const canSave = editing ? canLoadExisting : canScope(identity, SCOPES.CUSTOMER_TAGS_MANAGE);

  useEffect(() => {
    if (!tagId) return;
    let alive = true;
    getCustomerTag(tagId)
      .then((tag) => { if (alive) setForm({ name: tag.name, color: tag.color }); })
      .catch((cause) => { if (alive) setMessage(customerTagErrorMessage(cause, t)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [tagId, canLoadExisting]);

  function update<K extends keyof CustomerTagFormValues>(key: K, value: CustomerTagFormValues[K]) { setForm((current) => ({ ...current, [key]: value })); }
  function validate() {
    const next: Record<string, string> = {};
    if (!form.name.trim()) next.name = t("form.error_required");
    setErrors(next);
    return Object.keys(next).length === 0;
  }
  async function save() {
    if (!validate()) return;
    setBusy(true);
    setMessage(null);
    const body = { name: form.name.trim(), color: form.color };
    try {
      const tag = tagId
        ? (await updateCustomerTag(tagId, body)).data
        : (await createCustomerTag(body)).data;
      notify.flashSuccess(t(tagId ? "form.success_edit" : "form.success_add"));
      window.location.assign(`/customer-tags/${encodeURIComponent(tag.id)}`);
    } catch (cause) {
      const message = customerTagErrorMessage(cause, t);
      setMessage(message);
      notify.error(message);
      setBusy(false);
    }
  }
  if (!canSave || (editing && message && !form.name)) return <Alert role="alert" tone="critical">{message ?? auth("no_access")}</Alert>;
  if (loading) return <div role="status" aria-busy="true" className="space-y-4"><div className="h-20 shimmer rounded-xl" /><div className="h-72 shimmer rounded-xl" /></div>;

  const backHref = tagId ? `/customer-tags/${encodeURIComponent(tagId)}` : "/customer-tags";
  return (
    <FormPage
      title={editing ? t("form.title_edit") : t("form.title_add")}
      backHref={backHref}
      error={message}
      onSave={() => void save()}
      saving={busy}
    >
      <Card>
        <div className="space-y-4">
          <Field label={t("form.name_label")} error={errors.name}>
            <Input value={form.name} onChange={(event) => update("name", event.currentTarget.value)} placeholder={t("form.name_placeholder")} disabled={busy} />
          </Field>
          <Field label={t("form.color_label")} as="div">
            <ColorSwatches value={form.color} onChange={(color) => update("color", color)} label={t("form.color_label")} disabled={busy} />
          </Field>
        </div>
      </Card>
    </FormPage>
  );
}

function Gated({ tagId }: { tagId?: string }) {
  return <DashboardChrome narrow currentPath={tagId ? `/customer-tags/${tagId}/edit` : "/customer-tags/new"}><CustomerTagForm tagId={tagId} /></DashboardChrome>;
}

export default function CustomerTagFormPageApp({ tagId }: { tagId?: string }) { return <RequireAuth><Gated tagId={tagId} /></RequireAuth>; }
