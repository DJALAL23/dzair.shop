import { useEffect, useState } from "react";
import { canScope, RequireAuth, useIdentity } from "@/features/auth/components/RequireAuth";
import { DashboardChrome } from "@/components/layout/chrome";
import { useT } from "@/i18n/react";
import { notify } from "@/lib/notify";
import { SCOPES } from "../../../../../cod-shared/rbac/scopes";
import { TranslationsCard } from "@/features/translations/components/TranslationsCard";
import { createProductGroup, getProductGroup, listProductGroups, updateProductGroup } from "@/features/product-groups/api";
import { productGroupErrorMessage, toSlug } from "@/features/product-groups/model";
import type { ProductCategory, ProductCategoryFormValues } from "@/features/product-groups/types";
import { Alert, Card, Field, FormPage, Input, Select, Textarea } from "@/components/ui";
import { CategoryImageUploader } from "@/features/product-groups/components/CategoryImageUploader";

const EMPTY_FORM: ProductCategoryFormValues = { name: "", slug: "", description: "", parentId: "", imageUrl: "", metaTitle: "", metaDescription: "", metaKeywords: "" };

function ProductGroupForm({ groupId }: { groupId?: string }) {
  const t = useT("product-groups");
  const auth = useT("auth");
  const identity = useIdentity();
  const editing = Boolean(groupId);
  const [form, setForm] = useState<ProductCategoryFormValues>(EMPTY_FORM);
  const [allGroups, setAllGroups] = useState<ProductCategory[]>([]);
  const [loading, setLoading] = useState(editing);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  const canManage = canScope(identity, SCOPES.PRODUCT_GROUPS_MANAGE);
  const canSave = editing ? canScope(identity, SCOPES.PRODUCT_GROUPS_READ) && canManage : canManage;

  useEffect(() => { if (!editing && form.name) setForm((current) => ({ ...current, slug: toSlug(form.name) })); }, [form.name, editing]);

  useEffect(() => {
    let alive = true;
    Promise.all([listProductGroups().catch(() => []), groupId ? getProductGroup(groupId) : Promise.resolve(null)])
      .then(([groups, group]) => {
        if (!alive) return;
        setAllGroups(groups);
        if (group) setForm({ name: group.name, slug: group.slug, description: group.description ?? "", parentId: group.parentId ?? "", imageUrl: group.imageUrl ?? "", metaTitle: group.metaTitle ?? "", metaDescription: group.metaDescription ?? "", metaKeywords: group.metaKeywords ?? "" });
      })
      .catch((cause) => { if (alive) setMessage(productGroupErrorMessage(cause, t)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [groupId, canSave]);

  function update<K extends keyof ProductCategoryFormValues>(key: K, value: ProductCategoryFormValues[K]) { setForm((current) => ({ ...current, [key]: value })); }
  function validate() {
    const next: Record<string, string> = {};
    if (!form.name.trim()) next.name = t("form.error_name_required");
    setErrors(next);
    return Object.keys(next).length === 0;
  }
  async function save() {
    if (!validate()) return;
    setBusy(true);
    setMessage(null);
    const body = {
      name: form.name.trim(),
      slug: form.slug.trim() || toSlug(form.name),
      description: form.description.trim() || undefined,
      parentId: form.parentId || undefined,
      imageUrl: form.imageUrl || undefined,
      metaTitle: form.metaTitle.trim() || undefined,
      metaDescription: form.metaDescription.trim() || undefined,
      metaKeywords: form.metaKeywords.trim() || undefined,
    };
    try {
      if (groupId) await updateProductGroup(groupId, body);
      else await createProductGroup(body);
      notify.flashSuccess(t(groupId ? "form.success_edit" : "form.success_add"));
      window.location.assign("/product-groups");
    } catch (cause) {
      const message = productGroupErrorMessage(cause, t);
      setMessage(message);
      notify.error(message);
      setBusy(false);
    }
  }
  if (!canSave || (editing && message && !form.name)) return <Alert role="alert" tone="critical">{message ?? auth("no_access")}</Alert>;
  if (loading) return <div role="status" aria-busy="true" className="space-y-4"><div className="h-20 shimmer rounded-xl" /><div className="h-72 shimmer rounded-xl" /></div>;

  const parentOptions = allGroups.filter((group) => group.id !== groupId);
  const counter = (length: number, max: number, warnAt: number) => (
    <span className={`block text-end text-xs tabular-nums ${length > warnAt ? "text-[var(--tone-warning-text)]" : "text-muted-foreground"}`}>
      {length}/{max}
    </span>
  );
  return (
    <FormPage
      title={editing ? t("form.title_edit") : t("form.title_add")}
      backHref="/product-groups"
      error={message}
      onSave={() => void save()}
      saving={busy}
    >
      <Card title={t("form.section_details")}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t("form.name_label")} error={errors.name}>
            <Input value={form.name} onChange={(event) => update("name", event.currentTarget.value)} placeholder={t("form.name_placeholder")} disabled={busy} />
          </Field>
          <Field label={t("form.slug_label")}>
            <Input value={form.slug} onChange={(event) => update("slug", event.currentTarget.value)} disabled={busy} dir="ltr" />
          </Field>
          <Field label={t("form.parent_label")} className="sm:col-span-2">
            <Select value={form.parentId} onChange={(event) => update("parentId", event.currentTarget.value)} disabled={busy}>
              <option value="">{t("form.parent_placeholder")}</option>
              {parentOptions.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
            </Select>
          </Field>
          <Field label={t("form.description_label")} className="sm:col-span-2">
            <Textarea value={form.description} onChange={(event) => update("description", event.currentTarget.value)} rows={3} disabled={busy} />
          </Field>
        </div>
      </Card>
      <Card title={t("form.section_image")} help={t("form.image_help")}>
        <CategoryImageUploader value={form.imageUrl || null} onChange={(url) => update("imageUrl", url ?? "")} disabled={busy} />
      </Card>
      <Card title={t("form.section_seo")}>
        <div className="grid gap-4">
          <Field label={t("form.meta_title_label")} help={t("form.meta_title_help")} hint={counter(form.metaTitle.length, 60, 55)}>
            <Input value={form.metaTitle} onChange={(event) => update("metaTitle", event.currentTarget.value)} placeholder={t("form.meta_title_placeholder")} maxLength={60} disabled={busy} />
          </Field>
          <Field label={t("form.meta_description_label")} help={t("form.meta_description_help")} hint={counter(form.metaDescription.length, 160, 150)}>
            <Textarea value={form.metaDescription} onChange={(event) => update("metaDescription", event.currentTarget.value)} placeholder={t("form.meta_description_placeholder")} maxLength={160} rows={3} disabled={busy} />
          </Field>
          <Field label={t("form.meta_keywords_label")} help={t("form.meta_keywords_help")}>
            <Input value={form.metaKeywords} onChange={(event) => update("metaKeywords", event.currentTarget.value)} placeholder={t("form.meta_keywords_placeholder")} disabled={busy} />
          </Field>
        </div>
      </Card>
      {groupId && <TranslationsCard resource="category" id={groupId} canEdit={canManage} />}
    </FormPage>
  );
}

function Gated({ groupId }: { groupId?: string }) {
  return <DashboardChrome narrow currentPath={groupId ? `/product-groups/${groupId}/edit` : "/product-groups/new"}><ProductGroupForm groupId={groupId} /></DashboardChrome>;
}

export default function ProductGroupFormPageApp({ groupId }: { groupId?: string }) { return <RequireAuth><Gated groupId={groupId} /></RequireAuth>; }
