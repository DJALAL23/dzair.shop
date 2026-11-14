import { useEffect, useState } from "react";
import { BarChart3, Users, Wallet } from "lucide-react";
import { canScope, RequireAuth, useIdentity } from "@/features/auth/components/RequireAuth";
import { DashboardPage } from "@/components/layout/page";
import { Alert, PageHeader, Tabs } from "@/components/ui";
import { useT } from "@/i18n/react";
import { getTeam, getTeamSettings } from "@/features/confirmation/api";
import type { TeamConfig, TeamOverview } from "@/features/confirmation/types";
import { tabFrom, type TeamTab as Tab } from "@/features/confirmation/views";
import { ReceivingToggle } from "@/features/confirmation/components/ReceivingToggle";
import { TeamSettingsDialog } from "@/features/confirmation/components/TeamSettingsDialog";
import { AddMemberDialog } from "@/features/confirmation/components/AddMemberDialog";
import { TeamTab } from "@/features/confirmation/components/tabs/TeamTab";
import { ResultsTab } from "@/features/confirmation/components/tabs/ResultsTab";
import { PayrollTab } from "@/features/confirmation/components/tabs/PayrollTab";

function rememberTab(tab: Tab) {
  const url = new URL(window.location.href);
  if (tab === "team") url.searchParams.delete("tab");
  else url.searchParams.set("tab", tab);
  window.history.replaceState(null, "", url);
}

/**
 * The confirmation team in three views: the team as it works now, its
 * results over a period, and — with the finance permission — the month's
 * payroll. The open view is in the address, so a link opens it; a view is
 * loaded the first time it is opened and kept as it was when left.
 */
function Gated() {
  const t = useT("confirmation");
  const common = useT("common");
  const identity = useIdentity();
  const may = (scope: string) => canScope(identity, scope);
  const canSeePay = may("finance:read");
  const [tab, setTab] = useState<Tab>(() => tabFrom(window.location.search, canSeePay));
  const [opened, setOpened] = useState<Set<Tab>>(() => new Set([tab]));
  const [team, setTeam] = useState<TeamOverview | null>(null);
  const [config, setConfig] = useState<TeamConfig | null>(null);
  const [failed, setFailed] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editingRule, setEditingRule] = useState(false);
  const [version, setVersion] = useState(0);

  async function load() {
    setFailed(false);
    try {
      const [overview, settings] = await Promise.all([getTeam(), getTeamSettings()]);
      setTeam(overview);
      setConfig(settings);
    } catch {
      setFailed(true);
    }
  }

  function changed() {
    void load();
    setVersion((v) => v + 1);
  }

  function open(next: Tab) {
    setTab(next);
    setOpened((current) => new Set(current).add(next));
    rememberTab(next);
  }

  useEffect(() => {
    if (may("team:read")) void load();
  }, [identity?.role, identity?.scopes.join(",")]);

  if (!may("team:read")) {
    return (
      <DashboardPage>
        <Alert tone="critical">{t("no_access")}</Alert>
      </DashboardPage>
    );
  }

  const tabs = [
    { key: "team" as const, label: t("tabs.team"), icon: Users, count: team?.members.length },
    { key: "results" as const, label: t("tabs.results"), icon: BarChart3 },
    ...(canSeePay ? [{ key: "payroll" as const, label: t("tabs.payroll"), icon: Wallet }] : []),
  ];

  return (
    <DashboardPage>
      <PageHeader title={t("page_title")} subtitle={t("page_subtitle")} actions={<ReceivingToggle onChanged={changed} />} className="mb-4" />
      <Tabs label={t("tabs.label")} value={tab} onChange={open} items={tabs} className="mb-4" />

      {failed ? (
        <Alert role="alert" tone="critical">
          <div className="flex-1">
            <p className="font-semibold">{t("load_error")}</p>
          </div>
          <button type="button" onClick={() => void load()} className="text-xs font-semibold underline underline-offset-4">
            {common("retry")}
          </button>
        </Alert>
      ) : (
        <>
          <section role="tabpanel" aria-label={t("tabs.team")} hidden={tab !== "team"}>
            {!team || !config ? (
              <div className="space-y-4">
                <div className="h-24 shimmer rounded-xl" />
                <div className="h-64 shimmer rounded-xl" />
              </div>
            ) : (
              <TeamTab
                team={team}
                config={config}
                meId={identity?.user?.id}
                access={{ manage: may("team:manage") }}
                onAdd={() => setAdding(true)}
                onEditRule={() => setEditingRule(true)}
                onChanged={changed}
              />
            )}
          </section>
          {opened.has("results") && (
            <section role="tabpanel" aria-label={t("tabs.results")} hidden={tab !== "results"}>
              <ResultsTab version={version} />
            </section>
          )}
          {canSeePay && opened.has("payroll") && (
            <section role="tabpanel" aria-label={t("tabs.payroll")} hidden={tab !== "payroll"}>
              <PayrollTab version={version} canManage={may("finance:manage")} onChanged={changed} />
            </section>
          )}
        </>
      )}

      {editingRule && config && (
        <TeamSettingsDialog
          config={config}
          onClose={() => setEditingRule(false)}
          onSaved={(saved) => {
            setConfig(saved);
            changed();
          }}
        />
      )}
      {adding && <AddMemberDialog onClose={() => setAdding(false)} onAdded={changed} />}
    </DashboardPage>
  );
}

export default function ConfirmationPageApp() {
  return (
    <RequireAuth>
      <Gated />
    </RequireAuth>
  );
}
