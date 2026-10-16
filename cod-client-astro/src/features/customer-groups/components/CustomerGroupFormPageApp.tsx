import { useEffect, useState } from "react";
import { canScope, RequireAuth, useIdentity } from "@/features/auth/components/RequireAuth";
import { DashboardChrome } from "@/components/layout/chrome";
import { useT } from "@/i18n/react";
import { notify } from "@/lib/notify";
import { SCOPES } from "../../../../../cod-shared/rbac/scopes";
import { createCustomerGroup, getCustomerGroup, updateCustomerGroup } from "@/features/customer-groups/api";
import { customerGroupErrorMessage } from "@/features/customer-groups/model";
import type { CustomerGroupFormValues } from "@/features/customer-groups/types";
import { Alert, Card, ColorSwatches, Field, FormPage, Input, LABEL_COLORS } from "@/components/ui";


const EMPTY_FORM: CustomerGroupFormValues = { name: "", description: "", color: LABEL_COLORS[1] };

function CustomerGroupForm({ groupId }: { groupId?: string }) {
  const t = useT("customer-groups");
  const auth = useT("auth");
  const identity = useIdentity();
  const editing = Boolean(groupId);
  const [form, setForm] = useState<CustomerGroupFormValues>(EMPTY_FORM);
  const [loading, setLoading] = useState(editing);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  const canLoadExisting = !editing || (canScope(identity, SCOPES.CUSTOMER_GROUPS_READ) && canScope(identity, SCOPES.CUSTOMER_GROUPS_MANAGE));
  const canSave = editing ? canLoadExisting : canScope(identity, SCOPES.CUSTOMER_GROUPS_MANAGE);

  useEffect(() => {
    if (!groupId) return;
    let alive = true;
    getCustomerGroup(groupId)
      .then((group) => { if (alive) setForm({ name: group.name, description: group.description ?? "", color: group.color }); })
      .catch((cause) => { if (alive) setMessage(customerGroupErrorMessage(cause, t)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [groupId, canLoadExisting]);

  function update<K extends keyof CustomerGroupFormValues>(key: K, value: CustomerGroupFormValues[K]) { setForm((current) => ({ ...current, [key]: value })); }
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
    const body = { name: form.name.trim(), description: form.description.trim() || null, color: form.color };
    try {
      const group = groupId
        ? (await updateCustomerGroup(groupId, body)).data
        : (await createCustomerGroup({ ...body, description: body.description || undefined })).data;
      notify.flashSuccess(t(groupId ? "form.success_edit" : "form.success_add"));
      window.location.assign(`/customer-groups/${encodeURIComponent(group.id)}`);
    } catch (cause) {
      const message = customerGroupErrorMessage(cause, t);
      setMessage(message);
      notify.error(message);
      setBusy(false);
    }
  }
  if (!canSave || (editing && message && !form.name)) return <Alert role="alert" tone="critical">{message ?? auth("no_access")}</Alert>;
  if (loading) return <div role="status" aria-busy="true" className="space-y-4"><div className="h-20 shimmer rounded-xl" /><div className="h-72 shimmer rounded-xl" /></div>;

  const backHref = groupId ? `/customer-groups/${encodeURIComponent(groupId)}` : "/customer-groups";
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
          <Field label={t("form.description_label")}>
            <Input value={form.description} onChange={(event) => update("description", event.currentTarget.value)} placeholder={t("form.description_placeholder")} disabled={busy} />
          </Field>
          <Field label={t("form.color_label")} as="div">
            <ColorSwatches value={form.color} onChange={(color) => update("color", color)} label={t("form.color_label")} disabled={busy} />
          </Field>
        </div>
      </Card>
    </FormPage>
  );
}

function Gated({ groupId }: { groupId?: string }) {
  return <DashboardChrome narrow currentPath={groupId ? `/customer-groups/${groupId}/edit` : "/customer-groups/new"}><CustomerGroupForm groupId={groupId} /></DashboardChrome>;
}

export default function CustomerGroupFormPageApp({ groupId }: { groupId?: string }) { return <RequireAuth><Gated groupId={groupId} /></RequireAuth>; }
