import { useEffect, useState } from "react";
import { ChevronRight, LayoutGrid } from "lucide-react";
import { canScope, RequireAuth, useIdentity } from "@/features/auth/components/RequireAuth";
import { DashboardPage } from "@/components/layout/page";
import { Alert, NewBadge, PageHeader } from "@/components/ui";
import { useT } from "@/i18n/react";
import { listApps } from "@/features/apps/api";
import { appsByCategory, mayReadAnApp } from "@/features/apps/model";
import { AppStatusBadge, AppTile } from "@/features/apps/components/AppMarks";
import type { AppSummary } from "@/features/apps/types";

function AppsList() {
  const t = useT("apps");
  const common = useT("common");
  const [apps, setApps] = useState<AppSummary[] | null>(null);
  const [failed, setFailed] = useState(false);

  async function load() {
    setFailed(false);
    try {
      setApps(await listApps());
    } catch {
      setFailed(true);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  if (failed)
    return (
      <Alert role="alert" tone="critical">
        <div className="flex-1">
          <p className="font-semibold">{t("page.load_error")}</p>
          <button type="button" onClick={() => void load()} className="mt-3 text-xs font-semibold underline underline-offset-4">
            {common("retry")}
          </button>
        </div>
      </Alert>
    );
  if (apps === null)
    return (
      <div role="status" aria-busy="true" className="grid gap-3 sm:grid-cols-2">
        {[0, 1, 2, 3].map((item) => <div key={item} className="h-28 shimmer rounded-xl" />)}
      </div>
    );
  if (apps.length === 0) return <p className="text-sm text-muted-foreground">{t("page.none")}</p>;

  return (
    <div className="space-y-8">
      {appsByCategory(apps).map(({ category, apps: listed }) => (
        <section key={category} aria-labelledby={`apps-${category}`}>
          <h2 id={`apps-${category}`} className="mb-3 text-xs font-semibold text-muted-foreground">
            {t(`categories.${category}`)}
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {listed.map((app) => (
              <li key={app.key}>
                <a
                  href={`/apps/${app.key}`}
                  data-app={app.key}
                  className="group flex h-full items-start gap-3 rounded-xl bg-card p-4 shadow-card transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <AppTile appKey={app.key} />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-sm font-semibold text-foreground">{t(`names.${app.key}`)}</span>
                      <AppStatusBadge status={app.status} />
                    </span>
                    <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{t(`descriptions.${app.key}`)}</span>
                  </span>
                  <ChevronRight size={16} aria-hidden="true" className="mt-2.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 rtl:rotate-180 rtl:group-hover:-translate-x-0.5" />
                </a>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function Gated() {
  const t = useT("apps");
  const auth = useT("auth");
  const tN = useT("navigation");
  const identity = useIdentity();
  return (
    <DashboardPage>
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2.5">
            <span className="grid size-9 place-items-center rounded-xl bg-[var(--tone-magic-bg)] text-[var(--tone-magic-text)] shadow-[inset_0_0_0_1px_var(--tone-magic-border)]">
              <LayoutGrid size={17} aria-hidden="true" />
            </span>
            <span>{t("page.title")}</span>
          </span>
        }
        badges={<NewBadge label={tN("badge.new")} />}
        subtitle={t("page.subtitle")}
      />
      {mayReadAnApp((scope) => canScope(identity, scope)) ? <AppsList /> : <Alert tone="critical">{auth("no_access")}</Alert>}
    </DashboardPage>
  );
}

export default function AppsPageApp() {
  return (
    <RequireAuth>
      <Gated />
    </RequireAuth>
  );
}
