import { useEffect, useState } from "react";
import { Building2, ChevronRight, FilePlus, ShieldCheck } from "lucide-react";
import { RequireAuth, canScope, useIdentity } from "@/features/auth/components/RequireAuth";
import { DashboardChrome } from "@/components/layout/chrome";
import { Alert, Button, PageHeader, TableSkeleton, Tabs } from "@/components/ui";
import { useT } from "@/i18n/react";
import { SCOPES } from "../../../../../cod-shared/rbac/scopes";
import { getMyStore } from "@/features/settings/api";
import {
  getStoreLegalProfile,
  listStorePages,
  seedStoreDefaultPages,
} from "@/features/store-pages/api";
import { pageNeedsReview, storePagesErrorMessage } from "@/features/store-pages/model";
import type { StoreLegalProfile, StorePageSummary } from "@/features/store-pages/types";
import type { StoreLanguage } from "@/features/settings/types";
import { notify } from "@/lib/notify";
import { PageList } from "@/features/store-pages/components/PageList";
import { PageEditor } from "@/features/store-pages/components/PageEditor";
import { NewCustomPageDialog } from "@/features/store-pages/components/NewCustomPageDialog";
import { LegalProfileCard } from "@/features/store-pages/components/LegalProfileCard";

type ActiveTab = "pages" | "business_details";

function StorePagesContent() {
  const t = useT("store-pages");
  const common = useT("common");
  const identity = useIdentity();
  const canManage = canScope(identity, SCOPES.STORE_PAGES_MANAGE);

  const [activeTab, setActiveTab] = useState<ActiveTab>("pages");
  const [languages, setLanguages] = useState<StoreLanguage[] | null>(null);
  const [storefrontBaseUrl, setStorefrontBaseUrl] = useState("");
  const [pages, setPages] = useState<StorePageSummary[] | null>(null);
  const [legalProfile, setLegalProfile] = useState<StoreLegalProfile | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(pageFromUrl);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [showNewDialog, setShowNewDialog] = useState(false);

  async function load() {
    setLoadError(null);
    try {
      const [store, pageList, profile] = await Promise.all([
        getMyStore(),
        listStorePages(),
        getStoreLegalProfile(),
      ]);
      setLanguages(store.languages);
      setStorefrontBaseUrl(store.domain ? `https://${store.domain}` : "");
      setPages(pageList);
      setLegalProfile(profile);
    } catch (cause) {
      setLoadError(cause);
    }
  }

  useEffect(() => {
    void load();
    const onPop = () => setSelectedId(pageFromUrl());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  function open(id: string | null) {
    window.history.pushState(null, "", id ? `/pages?page=${encodeURIComponent(id)}` : "/pages");
    setSelectedId(id);
    document.getElementById("dashboard-main")?.scrollTo({ top: 0 });
  }

  async function handleSeedDefaults() {
    try {
      const result = await seedStoreDefaultPages();
      if (result.created.length > 0) {
        notify.success(t("list.seeded_toast", { count: result.created.length }));
      }
      await load();
    } catch (cause) {
      notify.error(storePagesErrorMessage(cause, t));
    }
  }

  function handlePageChanged() {
    void load();
  }

  function handlePageDeleted(pageId: string) {
    setPages((current) => current?.filter((p) => p.id !== pageId) ?? current);
    open(null);
  }

  function handlePageCreated(page: { id: string }) {
    setShowNewDialog(false);
    open(page.id);
    void load();
  }

  const header = (
    <PageHeader
      title={t("page_title")}
      actions={
        canManage && activeTab === "pages" ? (
          <Button onClick={() => setShowNewDialog(true)}>
            <FilePlus size={15} aria-hidden="true" />
            {t("list.new_page")}
          </Button>
        ) : undefined
      }
    />
  );

  if (loadError) {
    return (
      <>
        {header}
        <Alert role="alert" tone="critical">
          <div className="flex-1">
            <p className="font-semibold">{t("errors.load_failed")}</p>
            <button type="button" onClick={() => void load()} className="mt-3 text-xs font-semibold underline underline-offset-4">
              {common("retry")}
            </button>
          </div>
        </Alert>
      </>
    );
  }

  if (pages === null || languages === null) {
    return (
      <>
        {header}
        <div role="status" aria-busy="true" className="overflow-hidden rounded-xl shadow-card">
          <TableSkeleton rows={4} columns={4} />
        </div>
      </>
    );
  }

  if (selectedId) {
    return (
      <PageEditor
        key={selectedId}
        pageId={selectedId}
        languages={languages}
        storefrontBaseUrl={storefrontBaseUrl}
        onBack={() => open(null)}
        onChanged={handlePageChanged}
        onDeleted={handlePageDeleted}
      />
    );
  }

  const legalPages = pages.filter((p) => p.kind !== "custom");
  const storeLang = languages.find((language) => language.primary)?.locale ?? languages[0]!.locale;
  const locales = languages.map((language) => language.locale);
  const needsReviewCount = legalPages.filter((page) => pageNeedsReview(page, locales)).length;
  const isProfileIncomplete = Boolean(
    !legalProfile?.contactEmail?.trim() && !legalProfile?.contactPhone?.trim(),
  );

  return (
    <>
      {header}
      <div className="space-y-4">
        <Tabs
          label={t("tabs.pages")}
          value={activeTab}
          onChange={setActiveTab}
          items={[
            { key: "pages" as ActiveTab, label: t("tabs.pages"), icon: ShieldCheck, count: pages.length },
            { key: "business_details" as ActiveTab, label: isProfileIncomplete ? <>{t("tabs.business_details")}<span className="size-1.5 rounded-full bg-[var(--chart-to_confirm)]" title={t("legal_profile.incomplete_banner")} /></> : t("tabs.business_details"), icon: Building2 },
          ]}
        />

        {activeTab === "pages" && (
          <>
            {needsReviewCount > 0 && (
              <Alert tone="warning">
                <span className="flex flex-1 flex-wrap items-center justify-between gap-x-4 gap-y-2">
                  <span>{t("compliance.needs_review_count", { count: needsReviewCount })}</span>
                  {canManage && (
                    <button
                      type="button"
                      onClick={() => setActiveTab("business_details")}
                      className="inline-flex items-center gap-1 font-medium underline-offset-4 hover:underline"
                    >
                      {t("compliance.configure_profile")}
                      <ChevronRight size={14} aria-hidden="true" className="rtl:rotate-180" />
                    </button>
                  )}
                </span>
              </Alert>
            )}
            <PageList pages={pages} locales={locales} onOpen={open} onSeedDefaults={() => void handleSeedDefaults()} />
          </>
        )}

        {activeTab === "business_details" && (
          <LegalProfileCard profile={legalProfile} onSaved={setLegalProfile} />
        )}

        {showNewDialog && (
          <NewCustomPageDialog
            storeLang={storeLang}
            onClose={() => setShowNewDialog(false)}
            onCreated={handlePageCreated}
          />
        )}
      </div>
    </>
  );
}

function pageFromUrl() {
  return new URLSearchParams(window.location.search).get("page");
}

function Gated() {
  return (
    <DashboardChrome currentPath="/pages">
      <StorePagesContent />
    </DashboardChrome>
  );
}

export default function StorePagesApp() {
  return (
    <RequireAuth>
      <Gated />
    </RequireAuth>
  );
}
