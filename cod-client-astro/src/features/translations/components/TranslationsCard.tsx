import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Languages, Loader2, Save } from "lucide-react";
import { Alert, Badge, Button, Card, Field, Input, Skeleton, Textarea } from "@/components/ui";
import { useT } from "@/i18n/react";
import { notify } from "@/lib/notify";
import { RichTextField } from "@/features/products/components/RichTextField";
import { getTranslations, saveTranslations } from "@/features/translations/api";
import {
  draftFor,
  languageInfo,
  patchFor,
  pendingCount,
  translationFields,
  type TranslationFieldSpec,
} from "@/features/translations/model";
import type { StoreLocale, TranslatableResource, TranslationView } from "@/features/translations/types";


/** The source's text without markup, for the read-only reference beside a translation. */
function plainText(value: string | null, kind: TranslationFieldSpec["kind"]): string {
  if (!value) return "";
  if (kind !== "html") return value;
  return new DOMParser().parseFromString(value, "text/html").body.textContent ?? "";
}

/**
 * A resource's text in the store's other languages: one tab per language,
 * each field beside its source, saved one language at a time. Shopify's
 * Translate & Adapt, folded into the resource's own page.
 */
export function TranslationsCard({
  resource,
  id,
  canEdit,
}: {
  resource: TranslatableResource;
  id: string;
  /** Without the resource's write scope the translations are shown, not editable. */
  canEdit: boolean;
}) {
  const t = useT("translations");
  const common = useT("common");
  const [view, setView] = useState<TranslationView | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [active, setActive] = useState<StoreLocale | null>(null);
  const [drafts, setDrafts] = useState<Partial<Record<StoreLocale, Record<string, string>>>>({});
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoadError(false);
    try {
      const loaded = await getTranslations(resource, id);
      setView(loaded);
      setDrafts({});
      setActive((current) => current ?? loaded.targetLocales[0]?.locale ?? null);
    } catch {
      setLoadError(true);
    }
  }

  useEffect(() => {
    void load();
  }, [resource, id]);

  const fields = useMemo(() => translationFields(resource), [resource]);

  if (loadError) {
    return (
      <Alert role="alert" tone="critical">
        <AlertCircle size={18} className="shrink-0" />
        <div className="flex-1">
          <p className="font-semibold">{t("error_load")}</p>
          <button type="button" onClick={() => void load()} className="mt-2 text-xs font-semibold underline">
            {common("retry")}
          </button>
        </div>
      </Alert>
    );
  }

  if (view === null) {
    return (
      <Card title={t("title")}>
        <Skeleton className="h-24 w-full" />
      </Card>
    );
  }

  if (view.targetLocales.length === 0 || active === null) {
    return (
      <Card title={t("title")} subtitle={t("subtitle")}>
        <p className="text-sm text-muted-foreground">{t("no_languages")}</p>
      </Card>
    );
  }

  const draft = drafts[active] ?? draftFor(view, active);
  const patch = patchFor(view, active, draft);
  const target = languageInfo(active);
  const source = languageInfo(view.sourceLocale);

  function edit(key: string, value: string) {
    setDrafts((current) => ({ ...current, [active!]: { ...draft, [key]: value } }));
  }

  async function save() {
    if (!view || !patch) return;
    setSaving(true);
    try {
      const saved = await saveTranslations(resource, id, patch);
      setView(saved);
      setDrafts((current) => {
        const next = { ...current };
        delete next[patch.locale];
        return next;
      });
      notify.success(t("saved"));
    } catch {
      notify.error(t("save_error"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card
      title={t("title")}
      subtitle={t("subtitle")}
      action={<Languages size={18} className="text-muted-foreground" aria-hidden="true" />}
    >
      <div role="tablist" aria-label={t("languages_label")} className="mb-5 flex flex-wrap gap-2">
        {view.targetLocales.map(({ locale, published }) => {
          const pending = pendingCount(view, locale);
          const selected = locale === active;
          return (
            <button
              key={locale}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setActive(locale)}
              className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-semibold transition-colors ${
                selected ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:bg-muted"
              }`}
            >
              <span lang={locale}>{languageInfo(locale).nativeName}</span>
              {!published && <Badge tone="neutral" size="sm">{t("draft")}</Badge>}
              {pending > 0 && <Badge tone="warning" size="sm">{pending}</Badge>}
            </button>
          );
        })}
      </div>

      <div role="tabpanel" className="space-y-5">
        {fields.map((field) => {
          const stored = view.translations[active]?.[field.key];
          const reference = plainText(view.source[field.key] ?? null, field.kind);
          const label = (
            <span className="inline-flex items-center gap-2">
              {t(`fields.${resource}.${field.key}`)}
              {stored?.outdated && <Badge tone="warning" size="sm">{t("outdated")}</Badge>}
            </span>
          );
          const sourceReference = (
            <p
              lang={view.sourceLocale}
              dir={source.direction}
              className="line-clamp-3 rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground"
            >
              {reference || t("source_empty")}
            </p>
          );
          if (field.control === "rich") {
            return (
              <Field key={field.key} label={label} as="div">
                {sourceReference}
                <div lang={active} dir={target.direction}>
                  <RichTextField
                    value={draft[field.key] ?? ""}
                    onChange={(html) => edit(field.key, html)}
                    busy={saving}
                    disabled={!canEdit}
                  />
                </div>
              </Field>
            );
          }
          const controlProps = {
            value: draft[field.key] ?? "",
            maxLength: field.maxLength,
            lang: active,
            dir: target.direction,
            disabled: saving || !canEdit,
          };
          return (
            <Field key={field.key} label={label}>
              {sourceReference}
              {field.control === "textarea" ? (
                <Textarea {...controlProps} rows={3} onChange={(event) => edit(field.key, event.currentTarget.value)} />
              ) : (
                <Input {...controlProps} onChange={(event) => edit(field.key, event.currentTarget.value)} />
              )}
            </Field>
          );
        })}
      </div>

      {canEdit && (
        <div className="mt-5 flex justify-end">
          <Button type="button" onClick={() => void save()} disabled={!patch || saving}>
            {saving ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Save size={15} aria-hidden="true" />}
            {saving ? t("saving") : t("save")}
          </Button>
        </div>
      )}
    </Card>
  );
}
