import { useEffect, useState } from "react";
import { Shuffle, UserRound, UserX } from "lucide-react";
import { useTeamError } from "@/features/confirmation/errors";
import { useT } from "@/i18n/react";
import { notify } from "@/lib/notify";
import { Button, Dialog } from "@/components/ui";
import { Choice } from "@/features/orders/components/HandoffDialog";
import { assignOrders, getTeam, getTeamSettings } from "@/features/confirmation/api";
import type { TeamConfig, TeamMember } from "@/features/confirmation/types";

/**
 * Giving one order or several to a member of the confirmation team, to
 * nobody, or by the store's rule. Members who are receiving come first, each
 * with how many orders already wait with them, so the manager sees who has
 * room. Orders that changed hands meanwhile are left as they are, and said.
 */
export function GiveOrdersDialog({ orderIds, currentAssigneeId, onClose, onDone }: { orderIds: string[]; currentAssigneeId?: string | null; onClose: () => void; onDone: () => void }) {
  const t = useT("confirmation");
  const explain = useTeamError();
  const [members, setMembers] = useState<TeamMember[] | null>(null);
  const [config, setConfig] = useState<TeamConfig | null>(null);
  const [to, setTo] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const single = orderIds.length === 1;

  useEffect(() => {
    getTeam()
      .then((team) => setMembers([...team.members.filter((m) => m.active && m.reach !== "none")].sort((a, b) => Number(b.receiving) - Number(a.receiving))))
      .catch(() => setMembers([]));
    getTeamSettings().then(setConfig).catch(() => setConfig(null));
  }, []);

  async function submit() {
    if (to === undefined) return;
    setBusy(true);
    setError(null);
    try {
      const results = await assignOrders(orderIds, to);
      const given = results.filter((r) => r.ok && r.changed).length;
      const notMoved = results.filter((r) => !r.ok && r.reason === "changed").length;
      const decided = results.filter((r) => !r.ok && r.reason === "decided").length;
      if (single) {
        if (decided) notify.error(t("order.decided"));
        else if (notMoved) notify.error(t("order.changed"));
        else notify.success(to === null ? t("order.given_nobody") : t("order.given", { name: members?.find((m) => m.userId === to)?.name ?? "" }));
      } else {
        notify.success(t("list.given", { count: given }));
        if (notMoved) notify.error(t("list.not_moved", { count: notMoved }));
        if (decided) notify.error(t("list.decided", { count: decided }));
      }
      onDone();
      onClose();
    } catch (cause) {
      setError(explain(cause, "order.error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title={single ? t("order.give_title") : t("list.give_title", { count: orderIds.length })} onClose={onClose}>
      <div className="space-y-4">
        {members === null ? (
          <div className="h-32 shimmer rounded-lg" />
        ) : (
          <div role="radiogroup" aria-label={single ? t("order.give_title") : t("list.give_title", { count: orderIds.length })} className="space-y-1.5">
            {members
              .filter((member) => member.userId !== currentAssigneeId)
              .map((member) => (
                <Choice key={member.userId} selected={to === member.userId} onSelect={() => setTo(member.userId)}>
                  <span className="flex items-center gap-2">
                    <UserRound size={15} className="shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate">{member.name}</span>
                    {member.receiving && <span className="shrink-0 rounded-md bg-tone-success-bg px-1.5 py-0.5 text-[11px] font-semibold text-tone-success-text">{t("members.receiving")}</span>}
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{t("members.waiting_count", { count: member.waiting })}</span>
                  </span>
                </Choice>
              ))}
            {config && config.distribution !== "manual" && (
              <Choice selected={to === "rule"} onSelect={() => setTo("rule")}>
                <span className="flex items-center gap-2">
                  <Shuffle size={15} className="shrink-0 text-muted-foreground" aria-hidden="true" />
                  {t("order.give_rule")}
                </span>
              </Choice>
            )}
            {currentAssigneeId !== null && (
              <Choice selected={to === null} onSelect={() => setTo(null)}>
                <span className="flex items-center gap-2">
                  <UserX size={15} className="shrink-0 text-muted-foreground" aria-hidden="true" />
                  {t("order.give_nobody")}
                </span>
              </Choice>
            )}
          </div>
        )}
        {error && (
          <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm font-medium text-destructive">
            {error}
          </p>
        )}
        <Button type="button" className="w-full" disabled={to === undefined || busy} onClick={() => void submit()}>
          {single ? t("order.give") : t("list.give", { count: orderIds.length })}
        </Button>
      </div>
    </Dialog>
  );
}
