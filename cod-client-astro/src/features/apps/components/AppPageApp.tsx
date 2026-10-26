import { useCallback, useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { canScope, RequireAuth, useIdentity } from "@/features/auth/components/RequireAuth";
import { DashboardPage } from "@/components/layout/page";
import { Alert, Button, PageHeader, useConfirmDialog } from "@/components/ui";
import { useT } from "@/i18n/react";
import { notify } from "@/lib/notify";
import { listApps, removeApp } from "@/features/apps/api";
import { appAccess, canRemove } from "@/features/apps/model";
import { AppBody } from "@/features/apps/registry";
import { AppStatusBadge, AppTile } from "@/features/apps/components/AppMarks";
import type { AppKey, AppStatus } from "@/features/apps/types";

/** Every App Page's frame: its header and App Status, its body, and removing it. An App only supplies its body. */
function AppPage({ appKey }: { appKey: AppKey }) {
  const t = useT("apps");
  const auth = useT("auth");
  const identity = useIdentity();
  const confirm = useConfirmDialog();
  const access = appAccess(appKey, (scope) => canScope(identity, scope));
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [generation, setGeneration] = useState(0);
  const [removing, setRemoving] = useState(false);
  const name = t(`names.${appKey}`);

  const refresh = useCallback(async () => {
    try {
      setStatus((await listApps()).find((app) => app.key === appKey)?.status ?? null);
    } catch {
      setStatus(null);
    }
  }, [appKey]);

  useEffect(() => {
    if (access.read) void refresh();
  }, [access.read, refresh]);

  async function remove() {
    const sure = await confirm({ title: t("remove.confirm_title", { name }), description: t("remove.confirm_body"), confirmLabel: t("remove.confirm"), tone: "danger" });
    if (!sure) return;
    setRemoving(true);
    try {
      await removeApp(appKey);
      notify.success(t("remove.done", { name }));
      setGeneration((current) => current + 1);
      await refresh();
    } catch {
      notify.error(t("remove.failed"));
    } finally {
      setRemoving(false);
    }
  }

  if (!access.read) return <Alert tone="critical">{auth("no_access")}</Alert>;

  return (
    <>
      <PageHeader
        backHref="/apps"
        backLabel={t("page.back")}
        media={<AppTile appKey={appKey} size="large" />}
        title={name}
        badges={status && <AppStatusBadge status={status} />}
        subtitle={t(`descriptions.${appKey}`)}
      />
      <div className="space-y-6">
        {!access.manage && <Alert tone="info">{t("page.read_only")}</Alert>}
        <AppBody key={generation} appKey={appKey} canManage={access.manage} onSaved={() => void refresh()} />
        {access.manage && canRemove(status) && (
          <section aria-labelledby="remove-app" className="flex flex-col gap-3 rounded-xl bg-card px-5 py-4 shadow-card sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <h2 id="remove-app" className="text-sm font-semibold text-foreground">{t("remove.title")}</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">{t("remove.hint")}</p>
            </div>
            <Button variant="dangerOutline" className="shrink-0" disabled={removing} onClick={() => void remove()}>
              <Trash2 size={15} aria-hidden="true" />
              {t("remove.action")}
            </Button>
          </section>
        )}
      </div>
    </>
  );
}

export default function AppPageApp({ appKey }: { appKey: AppKey }) {
  return (
    <RequireAuth>
      <DashboardPage narrow>
        <AppPage appKey={appKey} />
      </DashboardPage>
    </RequireAuth>
  );
}
