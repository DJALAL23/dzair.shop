import { lazy, Suspense, useEffect, useState } from "react";
import { ArrowLeft, Check, ChevronDown, ChevronUp, Copy, ExternalLink, MoreHorizontal, RotateCcw, Trash2 } from "lucide-react";
import { canScope, useIdentity } from "@/features/auth/components/RequireAuth";
import { useT } from "@/i18n/react";
import { notify } from "@/lib/notify";
import { SCOPES } from "../../../../../cod-shared/rbac/scopes";
import { RICH_TEXT_MAX_CHARS } from "../../../../../cod-shared/lib/rich-text";
import {
  isValidPageSlug,
  pageKindLabelKey,
  localeLabelKey,
  storePagesErrorMessage,
} from "@/features/store-pages/model";
import {
  deleteStorePage,
  getStorePage,
  resetStorePageTranslation,
  saveStorePageTranslation,
  updateStorePage,
} from "@/features/store-pages/api";
import type { PageLocale, StorePageDetail } from "@/features/store-pages/types";
import type { StoreLanguage } from "@/features/settings/types";
import {
  Alert,
  Badge,
  Button,
  Card,
  DropdownItem,
  DropdownMenu,
  ErrorBoundary,
  Field,
  InfoTip,
  Input,
  LinkButton,
  PageHeader,
  StickyFormActions,
  Switch,
  useConfirmDialog,
} from "@/components/ui";
import { buttonVariants } from "@/components/ui/button";

const PageBodyEditor = lazy(() => import("./PageBodyEditor"));

interface PageEditorProps {
  pageId: string;
  /** The store's languages, primary first: one tab each. */
  languages: StoreLanguage[];
  storefrontBaseUrl: string;
  /** Back to the list of pages. */
  onBack: () => void;
  onChanged: (page: StorePageDetail) => void;
  onDeleted: (pageId: string) => void;
}

interface DraftState {
  title: string;
  bodyHtml: string;
  metaTitle: string;
  metaDescription: string;
}


function draftFromPage(page: StorePageDetail, locale: PageLocale): DraftState {
  const body = page.bodies[locale];
  return {
    title: body?.title ?? "",
    bodyHtml: body?.bodyHtml ?? "",
    metaTitle: body?.metaTitle ?? "",
    metaDescription: body?.metaDescription ?? "",
  };
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

export function PageEditor({
  pageId,
  languages,
  storefrontBaseUrl,
  onBack,
  onChanged,
  onDeleted,
}: PageEditorProps) {
  const t = useT("store-pages");
  const common = useT("common");
  const identity = useIdentity();
  const confirm = useConfirmDialog();
  const canManage = canScope(identity, SCOPES.STORE_PAGES_MANAGE);
  const storeLang = languages.find((language) => language.primary)?.locale ?? languages[0]!.locale;

  const [page, setPage] = useState<StorePageDetail | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [locale, setLocale] = useState<PageLocale>(storeLang);
  const [drafts, setDrafts] = useState<Record<PageLocale, DraftState>>({
    ar: { title: "", bodyHtml: "", metaTitle: "", metaDescription: "" },
    en: { title: "", bodyHtml: "", metaTitle: "", metaDescription: "" },
    fr: { title: "", bodyHtml: "", metaTitle: "", metaDescription: "" },
  });

  const [slug, setSlug] = useState("");
  const [status, setStatus] = useState<"published" | "draft">("published");
  const [showInFooter, setShowInFooter] = useState(true);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState(false);
  const [showSeoEditor, setShowSeoEditor] = useState(false);
  const back = (
    <button
      type="button"
      onClick={onBack}
      aria-label={t("page_title")}
      className="-ms-1.5 grid size-8 shrink-0 place-items-center rounded-lg text-foreground/80 transition-colors hover:bg-foreground/[0.06] hover:text-foreground pointer-coarse:size-10"
    >
      <ArrowLeft size={16} className="rtl:rotate-180" aria-hidden="true" />
    </button>
  );

  useEffect(() => {
    setPage(null);
    setLoadError(null);
    setLocale(storeLang);
    setCopied(false);
    setShowSeoEditor(false);

    void (async () => {
      try {
        const detail = await getStorePage(pageId);
        setPage(detail);
        setSlug(detail.slug);
        setStatus(detail.status);
        setShowInFooter(detail.showInFooter);

        const initialDrafts: Record<PageLocale, DraftState> = {
          ar: draftFromPage(detail, "ar"),
          en: draftFromPage(detail, "en"),
          fr: draftFromPage(detail, "fr"),
        };
        setDrafts(initialDrafts);
      } catch (cause) {
        setLoadError(cause);
      }
    })();
  }, [pageId, storeLang]);

  const activeLanguage = languages.find((language) => language.locale === locale);

  const currentDraft = drafts[locale];

  function updateCurrentDraft(updates: Partial<DraftState>) {
    setDrafts((prev) => ({
      ...prev,
      [locale]: { ...prev[locale], ...updates },
    }));
  }

  function handleCopyUrl() {
    const fullUrl = `${storefrontBaseUrl}/pages/${slug}`;
    void navigator.clipboard.writeText(fullUrl);
    setCopied(true);
    notify.success(t("editor.slug_copied"));
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleSave() {
    if (!page) return;

    const nextErrors: Record<string, string> = {};
    if (!isValidPageSlug(slug)) {
      nextErrors.slug = t("errors.validation");
    }
    if (!currentDraft.title.trim() || !currentDraft.bodyHtml.trim()) {
      nextErrors.body = t("errors.validation");
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    setBusy(true);
    try {
      // 1. Update metadata if changed
      const metaChanged =
        slug !== page.slug || status !== page.status || showInFooter !== page.showInFooter;

      if (metaChanged) {
        await updateStorePage(page.id, { slug, status, showInFooter });
      }

      // 2. Save current translation
      await saveStorePageTranslation(page.id, locale, {
        title: currentDraft.title.trim(),
        bodyHtml: currentDraft.bodyHtml,
        metaTitle: currentDraft.metaTitle?.trim() || null,
        metaDescription: currentDraft.metaDescription?.trim() || null,
      });

      const refreshed = await getStorePage(page.id);
      setPage(refreshed);
      setSlug(refreshed.slug);
      setStatus(refreshed.status);
      setShowInFooter(refreshed.showInFooter);
      setDrafts((prev) => ({
        ...prev,
        [locale]: draftFromPage(refreshed, locale),
      }));
      onChanged(refreshed);
      setErrors({});
      notify.success(t("editor.saved_toast"));
    } catch (cause) {
      const message = storePagesErrorMessage(cause, t);
      notify.error(message);
    } finally {
      setBusy(false);
    }
  }

  async function handleReset() {
    if (!page || page.kind === "custom") return;

    const ok = await confirm({
      title: t("editor.reset_confirm_title"),
      description: t("editor.reset_confirm_body", { locale: t(localeLabelKey(locale)) }),
      confirmLabel: t("editor.reset_button"),
      tone: "danger",
    });
    if (!ok) return;

    setBusy(true);
    try {
      await resetStorePageTranslation(page.id, locale);
      const refreshed = await getStorePage(page.id);
      setPage(refreshed);
      setDrafts((prev) => ({
        ...prev,
        [locale]: draftFromPage(refreshed, locale),
      }));
      onChanged(refreshed);
      notify.success(t("editor.reset_toast"));
    } catch (cause) {
      notify.error(storePagesErrorMessage(cause, t));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!page || page.kind !== "custom") return;

    const ok = await confirm({
      title: t("editor.delete_confirm_title"),
      description: t("editor.delete_confirm_body", { title: currentDraft.title || page.slug }),
      confirmLabel: common("delete"),
      tone: "danger",
    });
    if (!ok) return;

    setBusy(true);
    try {
      await deleteStorePage(page.id);
      notify.success(t("editor.deleted_toast"));
      onDeleted(page.id);
    } catch (cause) {
      notify.error(storePagesErrorMessage(cause, t));
      setBusy(false);
    }
  }

  if (loadError) {
    return (
      <>
        <PageHeader title={back} />
        <Alert role="alert" tone="critical">
          {t("errors.load_failed")}
        </Alert>
      </>
    );
  }

  if (!page) {
    return (
      <div role="status" aria-busy="true">
        <div className="mb-6 flex h-[52px] items-center gap-3 border-b border-border pb-4">
          {back}
          <div className="h-5 w-48 shimmer rounded" />
        </div>
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
          <div className="h-[480px] rounded-xl bg-card shadow-card" />
          <div className="h-48 rounded-xl bg-card shadow-card" />
        </div>
      </div>
    );
  }

  const isLegal = page.kind !== "custom";
  const translationSource = page.bodies[locale]?.source ?? "template";
  const bodyTooLong = currentDraft.bodyHtml.length > RICH_TEXT_MAX_CHARS;
  const publicUrl = `${storefrontBaseUrl}/pages/${slug}`;

  // Live SEO Snippet Calculations (Shopify style)
  const previewTitle = currentDraft.metaTitle.trim() || currentDraft.title.trim() || t(pageKindLabelKey(page.kind));
  const cleanSnippet = stripHtml(currentDraft.bodyHtml);
  const previewDescription =
    currentDraft.metaDescription.trim() ||
    (cleanSnippet ? cleanSnippet.slice(0, 160) + (cleanSnippet.length > 160 ? "..." : "") : "");
  const domainOnly = storefrontBaseUrl ? storefrontBaseUrl.replace(/^https?:\/\//, "") : "store.codflow.store";
  const plainBody = (
    <textarea
      value={currentDraft.bodyHtml}
      onChange={(event) => updateCurrentDraft({ bodyHtml: event.currentTarget.value })}
      rows={14}
      disabled={busy || !canManage}
      className="w-full rounded-lg border border-border/80 bg-card p-3.5 text-sm"
    />
  );

  const pageTitle = isLegal ? t(pageKindLabelKey(page.kind)) : currentDraft.title || page.slug;
  const languageHelp =
    locale === storeLang
      ? t("editor.body_own_language_hint")
      : activeLanguage?.published
        ? t("editor.body_published_hint", { locale: t(localeLabelKey(locale)) })
        : t("editor.body_unpublished_hint", { locale: t(localeLabelKey(locale)) });

  return (
    <div>
      <header className="mb-6 flex min-h-9 flex-wrap items-center justify-between gap-x-4 gap-y-3 border-b border-border pb-4">
        <div className="flex min-w-0 items-center gap-2">
          {back}
          <h1 className="truncate text-xl font-semibold tracking-tight text-foreground">{pageTitle}</h1>
          <Badge tone={status === "published" ? "success" : "neutral"}>
            {status === "published" ? t("list.status_published") : t("list.status_draft")}
          </Badge>
          {isLegal && translationSource !== "merchant" && <Badge tone="warning">{t("editor.template_badge")}</Badge>}
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="secondary" onClick={handleCopyUrl}>
            {copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
            {copied ? t("editor.copy_link_done") : t("editor.copy_link")}
          </Button>
          {storefrontBaseUrl && (
            <LinkButton href={publicUrl} target="_blank" rel="noopener noreferrer" variant="secondary" aria-label={t("editor.view_page")} title={t("editor.view_page")} className="w-9 px-0">
              <ExternalLink size={15} aria-hidden="true" />
            </LinkButton>
          )}
          {canManage && (
            <DropdownMenu
              trigger={<MoreHorizontal size={16} aria-hidden="true" />}
              triggerLabel={t("editor.more_actions")}
              triggerClassName={buttonVariants({ variant: "secondary", className: "w-9 px-0" })}
            >
              {isLegal ? (
                <DropdownItem disabled={busy} onClick={() => void handleReset()}>
                  <RotateCcw size={14} />
                  {t("editor.reset_button")}
                </DropdownItem>
              ) : (
                <DropdownItem danger disabled={busy} onClick={() => void handleDelete()}>
                  <Trash2 size={14} />
                  {t("editor.delete_button")}
                </DropdownItem>
              )}
            </DropdownMenu>
          )}
        </div>
      </header>

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
        <div className="min-w-0 space-y-4">
          <section className="overflow-hidden rounded-xl bg-card shadow-card">
            <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
              <div role="tablist" aria-label={t("editor.body_label")} className="no-scrollbar flex min-w-0 items-center gap-0.5 overflow-x-auto">
                {languages.map(({ locale: l, primary: isStorePrimary, published }) => {
                  const isActive = locale === l;
                  const reviewed = (page.bodies[l]?.source ?? "template") === "merchant";
                  return (
                    <button
                      key={l}
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      onClick={() => setLocale(l)}
                      className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm transition-colors ${
                        isActive ? "bg-subtle font-medium text-foreground" : "text-muted-foreground hover:bg-subtle hover:text-foreground"
                      }`}
                    >
                      {t(localeLabelKey(l))}
                      {isStorePrimary && <span className="text-xs text-muted-foreground">· {t("editor.primary_language_badge")}</span>}
                      {!published && <span className="text-xs text-muted-foreground">· {t("editor.unpublished_language_badge")}</span>}
                      {isLegal && !reviewed && (
                        <span aria-label={t("editor.template_badge")} title={t("editor.template_badge")} className="size-1.5 rounded-full bg-[var(--chart-to_confirm)]" />
                      )}
                    </button>
                  );
                })}
              </div>
              <InfoTip>
                <span className="block">{languageHelp}</span>
                {isLegal && translationSource !== "merchant" && <span className="mt-1.5 block">{t("editor.template_help")}</span>}
              </InfoTip>
            </div>

            <div className="space-y-4 p-4 sm:p-5">
              <Field label={t("editor.title_label")} error={errors.title}>
                <Input
                  dir={locale === "ar" ? "rtl" : "ltr"}
                  value={currentDraft.title}
                  onChange={(event) => updateCurrentDraft({ title: event.currentTarget.value })}
                  disabled={busy || !canManage}
                />
              </Field>

              <Field label={t("editor.body_label")} as="div" error={errors.body}>
                <ErrorBoundary
                  fallback={
                    <div className="space-y-1.5">
                      <p role="alert" className="text-xs font-medium text-[var(--tone-warning-text)]">
                        {common("editor_load_failed")}{" "}
                        <button type="button" onClick={() => window.location.reload()} className="underline underline-offset-2">
                          {common("reload_page")}
                        </button>
                      </p>
                      {plainBody}
                    </div>
                  }
                >
                  <Suspense fallback={plainBody}>
                    <div dir={locale === "ar" ? "rtl" : "ltr"}>
                    <PageBodyEditor
                      value={currentDraft.bodyHtml}
                      onChange={(html) => updateCurrentDraft({ bodyHtml: html })}
                      disabled={!canManage}
                      busy={busy}
                    />
                    </div>
                  </Suspense>
                </ErrorBoundary>
              </Field>
            </div>
          </section>

          <section className="rounded-xl bg-card p-4 shadow-card sm:p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                <span>{t("editor.serp_preview_title")}</span>
                <InfoTip>{t("editor.serp_preview_hint")}</InfoTip>
              </h2>
              {canManage && (
                <Button type="button" variant="ghost" size="sm" onClick={() => setShowSeoEditor((v) => !v)} aria-expanded={showSeoEditor}>
                  {t("editor.edit_seo")}
                  {showSeoEditor ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
                </Button>
              )}
            </div>
            <div className="mt-3 space-y-0.5">
              <p className="truncate text-xs text-muted-foreground" dir="ltr">
                {domainOnly} › pages › {slug || "page"}
              </p>
              <p className="truncate text-base text-[var(--link)]">{previewTitle}</p>
              <p className="line-clamp-2 text-sm text-muted-foreground">{previewDescription || t("editor.serp_empty")}</p>
            </div>
            {showSeoEditor && (
              <div className="mt-4 grid grid-cols-1 gap-4 border-t border-border pt-4 sm:grid-cols-2">
                <Field label={t("editor.meta_title_label")} help={t("editor.meta_title_hint")}>
                  <Input
                    value={currentDraft.metaTitle}
                    onChange={(event) => updateCurrentDraft({ metaTitle: event.currentTarget.value })}
                    disabled={busy || !canManage}
                    placeholder={currentDraft.title || pageTitle}
                  />
                </Field>
                <Field label={t("editor.meta_description_label")} help={t("editor.meta_desc_hint")}>
                  <Input
                    value={currentDraft.metaDescription}
                    onChange={(event) => updateCurrentDraft({ metaDescription: event.currentTarget.value })}
                    disabled={busy || !canManage}
                  />
                </Field>
              </div>
            )}
          </section>
        </div>

        <aside className="space-y-4">
          <Card title={t("editor.status_label")}>
            <div className="space-y-3">
              <div role="radiogroup" aria-label={t("editor.status_label")} className="space-y-1">
                {(["published", "draft"] as const).map((value) => (
                  <label key={value} className="flex cursor-pointer items-center gap-2.5 py-1 text-sm text-foreground">
                    <input
                      type="radio"
                      name="page_status"
                      value={value}
                      checked={status === value}
                      onChange={() => setStatus(value)}
                      disabled={busy || !canManage}
                      className="accent-[var(--primary)]"
                    />
                    <span className="flex-1">{value === "published" ? t("list.status_published") : t("list.status_draft")}</span>
                    <InfoTip>{value === "published" ? t("editor.published_help") : t("editor.draft_help")}</InfoTip>
                  </label>
                ))}
              </div>
              <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
                <span className="flex items-center gap-1.5 text-sm text-foreground">
                  <span id="page-footer-label">{t("editor.show_in_footer_label")}</span>
                  <InfoTip>{t("editor.footer_help")}</InfoTip>
                </span>
                <Switch checked={showInFooter} onChange={setShowInFooter} disabled={busy || !canManage} aria-labelledby="page-footer-label" />
              </div>
            </div>
          </Card>

          <Card>
            <div className="space-y-2">
              <h2 className="flex items-center gap-1.5 text-sm font-semibold text-card-foreground">
                <span>{t("editor.slug_label")}</span>
                <InfoTip>{t("editor.slug_hint")}</InfoTip>
              </h2>
              <div className={`flex overflow-hidden rounded-lg border bg-card focus-within:border-ring focus-within:shadow-[0_0_0_1px_var(--ring)] ${errors.slug ? "border-destructive" : "border-input"}`} dir="ltr">
                <span className="inline-flex select-none items-center bg-subtle px-2.5 text-sm text-muted-foreground">/pages/</span>
                <input
                  value={slug}
                  onChange={(event) => setSlug(event.currentTarget.value)}
                  aria-label={t("editor.slug_label")}
                  className="h-8 min-w-0 flex-1 bg-transparent px-2.5 text-sm text-foreground outline-none pointer-coarse:h-10"
                  disabled={busy || !canManage}
                />
              </div>
              {errors.slug && <p role="alert" className="text-xs font-medium text-destructive">{errors.slug}</p>}
            </div>
          </Card>
        </aside>
      </div>

      {canManage && (
        <StickyFormActions info={<span className="text-xs text-muted-foreground">{pageTitle} · {t(localeLabelKey(locale))}</span>}>
          <Button type="button" onClick={() => void handleSave()} disabled={busy || bodyTooLong}>
            {t("editor.save_button")}
          </Button>
        </StickyFormActions>
      )}
    </div>
  );
}
