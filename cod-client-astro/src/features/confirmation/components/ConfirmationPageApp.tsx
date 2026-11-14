import { useEffect, useState } from "react";
import { ArrowRight, Settings2, Shuffle } from "lucide-react";
import { canScope, RequireAuth, useIdentity } from "@/features/auth/components/RequireAuth";
import { DashboardPage } from "@/components/layout/page";
import { Alert, Button, Card, PageHeader } from "@/components/ui";
import { useT } from "@/i18n/react";
import { getTeam, getTeamSettings, shareOutNow } from "@/features/confirmation/api";
import { notify } from "@/lib/notify";
import { TEAM_QUEUES, type PayrollLine, type TeamConfig, type TeamOverview, type TeamQueue } from "@/features/confirmation/types";
import { ReceivingToggle } from "@/features/confirmation/components/ReceivingToggle";
import { TeamMembersCard } from "@/features/confirmation/components/TeamMembersCard";
import { TeamResultsCard } from "@/features/confirmation/components/TeamResultsCard";
import { PayrollCard } from "@/features/confirmation/components/PayrollCard";
import { TeamSettingsDialog } from "@/features/confirmation/components/TeamSettingsDialog";
import { AddMemberDialog } from "@/features/confirmation/components/AddMemberDialog";
import { MemberPayDialog } from "@/features/confirmation/components/MemberPayDialog";

/** How the store shares new orders out, in a sentence, and who is receiving them now. */
function RuleCard({ team, config, canManage, onChange }: { team: TeamOverview; config: TeamConfig; canManage: boolean; onChange: () => void }) {
  const t = useT("confirmation");
  const active = team.members.filter((member) => member.active);
  const receiving = active.filter((member) => member.receiving).length;
  return (
    <Card
      title={t("rule.title")}
      action={
        canManage ? (
          <Button type="button" variant="secondary" size="sm" onClick={onChange}>
            <Settings2 size={14} aria-hidden="true" />
            {t("rule.change")}
          </Button>
        ) : undefined
      }
    >
      <div className="space-y-1.5 text-sm">
        <p className="font-medium text-foreground">{t(`rule.${config.distribution}`)}</p>
        {config.distribution !== "manual" && (
          <p className="text-muted-foreground">
            {config.takeBackMinutes === null ? t("rule.take_back_off") : t("rule.take_back_on", { minutes: config.takeBackMinutes, limit: config.takeBackLimit })}
          </p>
        )}
        {active.length > 0 && (
          <p className={receiving === 0 ? "font-medium text-[var(--tone-warning-text)]" : "text-muted-foreground"}>
            {receiving === 0 ? t("rule.nobody_receiving") : t("rule.receiving_now", { count: receiving, total: active.length })}
          </p>
        )}
      </div>
    </Card>
  );
}

/** What waits for someone to act, each with what to do, a link to the orders themselves, and — when the rule can take them now — sharing them out at once. */
function QueueAlerts({ team, config, canManage, onShared }: { team: TeamOverview; config: TeamConfig; canManage: boolean; onShared: () => void }) {
  const t = useT("confirmation");
  const [sharing, setSharing] = useState(false);
  const byHand = config.distribution === "manual";
  const receiving = team.members.some((member) => member.active && member.receiving);
  const canShare = canManage && !byHand && receiving;

  async function share() {
    setSharing(true);
    try {
      const { shared } = await shareOutNow();
      if (shared > 0) notify.success(t("queue.shared", { count: shared }));
      else notify.error(t("queue.shared_none"));
      onShared();
    } catch {
      notify.error(t("order.error"));
    } finally {
      setSharing(false);
    }
  }

  const counts: Record<TeamQueue, number> = { unassigned: team.unassigned, needs_manager: team.needsManager, former: team.withFormerMembers };
  const hint: Record<TeamQueue, string | null> = {
    unassigned: byHand ? t("queue.unassigned_manual") : receiving ? t("queue.unassigned_auto") : t("queue.unassigned_nobody"),
    needs_manager: t("queue.needs_manager_hint"),
    former: byHand ? t("queue.former_manual") : t("queue.former_rule"),
  };
  const title = (queue: TeamQueue, count: number) =>
    queue === "unassigned" ? t("queue.unassigned", { count }) : queue === "needs_manager" ? t("queue.needs_manager", { count }) : t("queue.former", { count });
  const open = TEAM_QUEUES.filter((queue) => counts[queue] > 0);
  if (open.length === 0) return null;
  return (
    <div className="space-y-2">
      {open.map((queue) => (
        <Alert key={queue} tone="warning">
          <div className="flex flex-1 flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <div className="min-w-0">
              <p className="font-semibold">{title(queue, counts[queue])}</p>
              {hint[queue] && <p className="mt-0.5 text-xs opacity-90">{hint[queue]}</p>}
            </div>
            <div className="flex shrink-0 items-center gap-3">
              {canShare && queue !== "needs_manager" && (
                <Button type="button" variant="secondary" size="sm" disabled={sharing} onClick={() => void share()}>
                  <Shuffle size={14} aria-hidden="true" />
                  {t("queue.share_now")}
                </Button>
              )}
              <a href={`/orders?${new URLSearchParams({ view: "to_confirm", team: queue })}`} className="inline-flex items-center gap-1 text-xs font-semibold underline underline-offset-4">
                {t("queue.see")}
                <ArrowRight size={13} className="rtl:rotate-180" aria-hidden="true" />
              </a>
            </div>
          </div>
        </Alert>
      ))}
    </div>
  );
}

function Gated() {
  const t = useT("confirmation");
  const common = useT("common");
  const identity = useIdentity();
  const may = (scope: string) => canScope(identity, scope);
  const [team, setTeam] = useState<TeamOverview | null>(null);
  const [config, setConfig] = useState<TeamConfig | null>(null);
  const [failed, setFailed] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editingRule, setEditingRule] = useState(false);
  const [paying, setPaying] = useState<PayrollLine | null>(null);
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

  const access = { manage: may("team:manage"), seePay: may("finance:read"), managePay: may("finance:manage") };

  return (
    <DashboardPage>
      <PageHeader title={t("page_title")} subtitle={t("page_subtitle")} actions={<ReceivingToggle onChanged={changed} />} />
      {failed ? (
        <Alert role="alert" tone="critical">
          <div className="flex-1">
            <p className="font-semibold">{t("load_error")}</p>
          </div>
          <button type="button" onClick={() => void load()} className="text-xs font-semibold underline underline-offset-4">
            {common("retry")}
          </button>
        </Alert>
      ) : !team || !config ? (
        <div className="space-y-4">
          <div className="h-28 shimmer rounded-xl" />
          <div className="h-64 shimmer rounded-xl" />
        </div>
      ) : (
        <div className="space-y-4">
          <QueueAlerts team={team} config={config} canManage={access.manage} onShared={changed} />
          <RuleCard team={team} config={config} canManage={access.manage} onChange={() => setEditingRule(true)} />
          <TeamMembersCard members={team.members} config={config} meId={identity?.user?.id} access={access} onAdd={() => setAdding(true)} onChanged={changed} />
          {team.members.length > 0 && <TeamResultsCard version={version} />}
          {access.seePay && team.members.length > 0 && <PayrollCard version={version} onEditPay={setPaying} />}
        </div>
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
      {paying && <MemberPayDialog member={paying} canManage={access.managePay} onClose={() => setPaying(null)} onChanged={changed} />}
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
