import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Languages, Loader2, Save } from "lucide-react";
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
  fields: keys,
}: {
  resource: TranslatableResource;
  id: string;
  /** Without the resource's write scope the translations are shown, not editable. */
  canEdit: boolean;
  /** Only these fields, when the resource's fields are edited in more than one place. */
  fields?: readonly string[];
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

  const fields = useMemo(() => (view ? translationFields(view, keys) : []), [view, keys]);

  if (loadError) {
    return (
      <Alert role="alert" tone="critical">
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

  const draft = drafts[active] ?? draftFor(view, active, keys);
  const patch = patchFor(view, active, draft, keys);
  const target = languageInfo(active);
  const source = languageInfo(view.sourceLocale);

  /** A field's label, flagged when its translation is older than its source. */
  function labelFor(key: string, text: ReactNode) {
    return (
      <span className="inline-flex items-center gap-2">
        {text}
        {view!.translations[active!]?.[key]?.outdated && <Badge tone="warning" size="sm">{t("outdated")}</Badge>}
      </span>
    );
  }

  function controlProps({ key }: { key: string }) {
    const field = fields.find((candidate) => candidate.key === key);
    return {
      value: draft[key] ?? "",
      maxLength: field?.maxLength,
      lang: active!,
      dir: target.direction,
      disabled: saving || !canEdit,
    };
  }

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
          const pending = pendingCount(view, locale, keys);
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
        {fields.filter((field) => field.part.kind === "field").map((field) => {
          const sourceReference = (
            <p
              lang={view.sourceLocale}
              dir={source.direction}
              className="line-clamp-3 rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground"
            >
              {plainText(view.source[field.key] ?? null, field.kind) || t("source_empty")}
            </p>
          );
          const label = labelFor(field.key, t(`fields.${resource}.${field.key}`));
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
          return (
            <Field key={field.key} label={label}>
              {sourceReference}
              {field.control === "textarea" ? (
                <Textarea {...controlProps(field)} rows={3} onChange={(event) => edit(field.key, event.currentTarget.value)} />
              ) : (
                <Input {...controlProps(field)} onChange={(event) => edit(field.key, event.currentTarget.value)} />
              )}
            </Field>
          );
        })}

        {view.options.length > 0 && (
          <section className="space-y-3 border-t border-border pt-5">
            <div>
              <h3 className="text-sm font-semibold text-foreground">{t("options_title")}</h3>
              <p className="text-xs text-muted-foreground">{t("options_hint")}</p>
            </div>
            {view.options.map((option) => (
              <div key={option.key} className="space-y-3 rounded-lg border border-border p-3">
                <Field label={labelFor(option.key, t("option_name"))}>
                  <p lang={view.sourceLocale} dir={source.direction} className="rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
                    {option.name}
                  </p>
                  <Input {...controlProps(option)} onChange={(event) => edit(option.key, event.currentTarget.value)} />
                </Field>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {option.values.map((value) => (
                    <Field
                      key={value.key}
                      label={labelFor(value.key, <span lang={view.sourceLocale} dir={source.direction}>{value.value}</span>)}
                    >
                      <Input {...controlProps(value)} onChange={(event) => edit(value.key, event.currentTarget.value)} />
                    </Field>
                  ))}
                </div>
              </div>
            ))}
          </section>
        )}
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
