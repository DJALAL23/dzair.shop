import { useState } from "react";
import { AlarmClock, AlertTriangle, ArrowRight, Inbox, Radio, Shuffle } from "lucide-react";
import { useT } from "@/i18n/react";
import { notify } from "@/lib/notify";
import { Button, Card, StatStrip } from "@/components/ui";
import { shareOutNow } from "@/features/confirmation/api";
import { TEAM_QUEUES, type TeamConfig, type TeamMember, type TeamOverview, type TeamQueue } from "@/features/confirmation/types";
import { TeamMembersCard } from "@/features/confirmation/components/TeamMembersCard";

interface Access {
  manage: boolean;
}

/** Whether new orders can reach a member now: active, available, and able to see orders. */
const getsOrders = (member: TeamMember) => member.active && member.receiving && member.reach !== "none";

/**
 * The team as it works now: who is available, what is left to call, what
 * needs the manager, and the members with how orders reach them. Each number
 * opens the orders it counts.
 */
export function TeamTab({ team, config, meId, access, onAdd, onEditRule, onChanged }: {
  team: TeamOverview;
  config: TeamConfig;
  meId?: string;
  access: Access;
  onAdd: () => void;
  onEditRule: () => void;
  onChanged: () => void;
}) {
  const t = useT("confirmation");
  const active = team.members.filter((member) => member.active);
  const available = active.filter(getsOrders).length;
  const toCall = team.members.reduce((sum, member) => sum + member.waiting, 0);
  const callbacks = team.members.reduce((sum, member) => sum + member.callbacks, 0);

  return (
    <div className="@container space-y-4">
      {team.members.length > 0 && (
        <StatStrip
          items={[
            {
              label: t("stats.receiving"),
              value: available,
              hint: t("stats.receiving_of", { count: active.length }),
              icon: Radio,
              tone: active.length > 0 && available === 0 ? "warning" : "neutral",
            },
            {
              label: t("stats.waiting"),
              value: toCall,
              hint: team.unassigned > 0 ? t("stats.waiting_nobody", { count: team.unassigned }) : undefined,
              icon: Inbox,
              href: "/orders?view=to_confirm",
            },
            { label: t("stats.callbacks"), value: callbacks, icon: AlarmClock, href: "/orders?view=callbacks" },
          ]}
        />
      )}
      <NeedsYou team={team} config={config} canManage={access.manage} onShared={onChanged} />
      <TeamMembersCard
        members={team.members}
        config={config}
        meId={meId}
        canManage={access.manage}
        onAdd={onAdd}
        onChanged={onChanged}
        rule={<RuleLine config={config} canManage={access.manage} onChange={onEditRule} />}
      />
    </div>
  );
}

/** How new orders reach the members, in a line, with the way to change it. */
function RuleLine({ config, canManage, onChange }: { config: TeamConfig; canManage: boolean; onChange: () => void }) {
  const t = useT("confirmation");
  return (
    <div className="flex items-start gap-2.5 border-t border-border bg-subtle px-4 py-2.5 text-xs">
      <Shuffle size={14} className="mt-px shrink-0 text-muted-foreground" aria-hidden="true" />
      <p className="min-w-0 flex-1 text-muted-foreground">
        <span className="font-semibold text-foreground">{t(`rule.${config.distribution}_name`)}</span>
        {" · "}
        {t(`rule.${config.distribution}`)}
        {config.distribution !== "manual" && (
          <>
            {" "}
            {config.takeBackMinutes === null ? t("rule.take_back_off") : t("rule.take_back_on", { minutes: config.takeBackMinutes, limit: config.takeBackLimit })}
          </>
        )}
      </p>
      {canManage && (
        <button type="button" onClick={onChange} className="shrink-0 font-semibold text-foreground underline underline-offset-4 pointer-coarse:py-1">
          {t("rule.change")}
        </button>
      )}
    </div>
  );
}

/**
 * What waits for a manager, in one card: each with what to do, a link to
 * the orders themselves, and — when the rule can take them now — assigning
 * them at once. Nothing shows while nothing waits.
 */
function NeedsYou({ team, config, canManage, onShared }: { team: TeamOverview; config: TeamConfig; canManage: boolean; onShared: () => void }) {
  const t = useT("confirmation");
  const [sharing, setSharing] = useState(false);
  const byHand = config.distribution === "manual";
  const available = team.members.some(getsOrders);
  const canShare = canManage && !byHand && available;
  const counts: Record<TeamQueue, number> = { unassigned: team.unassigned, needs_manager: team.needsManager, former: team.withFormerMembers };
  const hint: Record<TeamQueue, string> = {
    unassigned: byHand ? t("queue.unassigned_manual") : available ? t("queue.unassigned_auto") : t("queue.unassigned_nobody"),
    needs_manager: t("queue.needs_manager_hint"),
    former: byHand ? t("queue.former_manual") : t("queue.former_rule"),
  };
  const title = (queue: TeamQueue, count: number) =>
    queue === "unassigned" ? t("queue.unassigned", { count }) : queue === "needs_manager" ? t("queue.needs_manager", { count }) : t("queue.former", { count });
  const open = TEAM_QUEUES.filter((queue) => counts[queue] > 0);

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

  if (open.length === 0) return null;
  return (
    <Card title={t("queue.title")} flush className="overflow-hidden">
      <ul className="divide-y divide-border border-t border-border">
        {open.map((queue) => (
          <li key={queue} className="flex flex-col gap-3 px-4 py-3 @lg:flex-row @lg:items-center @lg:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-[var(--tone-warning-bg)] text-[var(--tone-warning-text)]">
                <AlertTriangle size={14} aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">{title(queue, counts[queue])}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{hint[queue]}</p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2 ps-10 @lg:ps-0">
              {canShare && queue !== "needs_manager" && (
                <Button type="button" variant="secondary" size="sm" disabled={sharing} onClick={() => void share()}>
                  <Shuffle size={14} aria-hidden="true" />
                  {t("queue.share_now")}
                </Button>
              )}
              <a
                href={`/orders?${new URLSearchParams({ view: "to_confirm", team: queue })}`}
                className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-foreground underline-offset-4 hover:underline pointer-coarse:h-10"
              >
                {t("queue.see")}
                <ArrowRight size={13} className="rtl:rotate-180" aria-hidden="true" />
              </a>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
