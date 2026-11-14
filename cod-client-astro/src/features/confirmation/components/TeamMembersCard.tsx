import { useState } from "react";
import { AlarmClock, AlertTriangle, Plus, Trash2, Users, Wallet } from "lucide-react";
import { useTeamError } from "@/features/confirmation/errors";
import { useT } from "@/i18n/react";
import { notify } from "@/lib/notify";
import { Badge, Button, Card, EmptyState, Switch, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, useConfirmDialog } from "@/components/ui";
import { removeTeamMember, setMemberReceiving } from "@/features/confirmation/api";
import { memberWarning } from "@/features/confirmation/model";
import { MemberPayDialog } from "@/features/confirmation/components/MemberPayDialog";
import type { TeamConfig, TeamMember } from "@/features/confirmation/types";

interface Access {
  manage: boolean;
  seePay: boolean;
  managePay: boolean;
}

const ordersOf = (member: TeamMember, view: "to_confirm" | "callbacks") => `/orders?${new URLSearchParams({ view, assignee: member.userId })}`;

/**
 * The team's members: who is receiving new orders now, how many orders wait
 * with each and how many customers they must call back, which orders their
 * permissions let them work, and — with the finance permission — their pay.
 * A row warns when a member cannot take orders, and says how to fix it.
 */
export function TeamMembersCard({ members, config, meId, access, onAdd, onChanged }: { members: TeamMember[]; config: TeamConfig; meId?: string; access: Access; onAdd: () => void; onChanged: () => void }) {
  const t = useT("confirmation");
  const explain = useTeamError();
  const common = useT("common");
  const confirm = useConfirmDialog();
  const [busy, setBusy] = useState<string | null>(null);
  const [paying, setPaying] = useState<TeamMember | null>(null);

  async function changeReceiving(member: TeamMember, receiving: boolean) {
    setBusy(member.userId);
    try {
      await setMemberReceiving(member.userId, receiving);
      notify.success(receiving ? t("members.receiving_on", { name: member.name }) : t("members.receiving_off", { name: member.name }));
      onChanged();
    } catch (cause) {
      notify.error(explain(cause, "members.error"));
    } finally {
      setBusy(null);
    }
  }

  async function remove(member: TeamMember) {
    const byHand = config.distribution === "manual";
    const ok = await confirm({
      title: t("members.remove_title", { name: member.name }),
      description:
        member.waiting === 0
          ? t("members.remove_empty", { name: member.name })
          : t(byHand ? "members.remove_manual" : "members.remove_rule", { name: member.name, count: member.waiting }),
      confirmLabel: t("members.remove"),
      tone: "danger",
    });
    if (!ok) return;
    setBusy(member.userId);
    try {
      await removeTeamMember(member.userId);
      notify.success(t("members.removed", { name: member.name }));
      onChanged();
    } catch (cause) {
      notify.error(explain(cause, "members.error"));
    } finally {
      setBusy(null);
    }
  }

  const addButton = access.manage ? (
    <Button type="button" size="sm" onClick={onAdd}>
      <Plus size={14} aria-hidden="true" />
      {t("members.add")}
    </Button>
  ) : undefined;

  if (members.length === 0) {
    return (
      <Card title={t("members.title")}>
        <EmptyState icon={<Users />} title={t("members.empty_title")} description={t("members.empty_body")} action={addButton} />
      </Card>
    );
  }

  const receivingSwitch = (member: TeamMember) =>
    access.manage ? (
      <Switch checked={member.receiving} disabled={busy === member.userId || !member.active} onChange={(on) => void changeReceiving(member, on)} aria-label={t("members.receiving_for", { name: member.name })} />
    ) : member.receiving ? (
      <Badge tone="success" size="sm" dot>
        {t("members.receiving")}
      </Badge>
    ) : (
      <span className="text-xs text-muted-foreground">{t("members.not_receiving")}</span>
    );

  const actions = (member: TeamMember) => (
    <div className="flex items-center justify-end gap-1">
      {access.seePay && (
        <Button type="button" variant="ghost" size="sm" onClick={() => setPaying(member)}>
          <Wallet size={14} aria-hidden="true" />
          {t("pay.set")}
        </Button>
      )}
      {access.manage && (
        <button
          type="button"
          disabled={busy === member.userId}
          onClick={() => void remove(member)}
          aria-label={t("members.remove_name", { name: member.name })}
          title={t("members.remove")}
          className="grid size-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-destructive disabled:opacity-50 pointer-coarse:size-10"
        >
          <Trash2 size={15} aria-hidden="true" />
        </button>
      )}
    </div>
  );

  return (
    <Card title={t("members.title")} subtitle={t("members.subtitle")} action={addButton} flush>
      <div className="divide-y divide-border border-t border-border md:hidden">
        {members.map((member) => (
          <article key={member.userId} className="space-y-2 px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <MemberName member={member} me={member.userId === meId} />
              {receivingSwitch(member)}
            </div>
            <MemberCounts member={member} />
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">{t(`members.reach_${member.reach}`)}</span>
              {actions(member)}
            </div>
          </article>
        ))}
      </div>
      <div className="relative hidden overflow-x-auto md:block">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>{t("members.member")}</TableHead>
              <TableHead>{t("members.receiving")}</TableHead>
              <TableHead>{t("members.waiting")}</TableHead>
              <TableHead>{t("members.sees")}</TableHead>
              <TableHead className="w-px">
                <span className="sr-only">{common("table.actions")}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((member) => (
              <TableRow key={member.userId} className="hover:bg-transparent">
                <TableCell className="max-w-72">
                  <MemberName member={member} me={member.userId === meId} />
                </TableCell>
                <TableCell>{receivingSwitch(member)}</TableCell>
                <TableCell>
                  <MemberCounts member={member} />
                </TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">{t(`members.reach_${member.reach}`)}</TableCell>
                <TableCell className="w-px">{actions(member)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {paying && <MemberPayDialog member={paying} canManage={access.managePay} onClose={() => setPaying(null)} onChanged={onChanged} />}
    </Card>
  );
}

function MemberName({ member, me }: { member: TeamMember; me: boolean }) {
  const t = useT("confirmation");
  const warning = memberWarning(member);
  return (
    <div className="min-w-0">
      <p className="flex items-center gap-1.5 truncate font-semibold text-foreground">
        <span className="truncate">{member.name}</span>
        {me && (
          <Badge tone="neutral" size="sm">
            {t("members.you")}
          </Badge>
        )}
      </p>
      <p className="truncate text-xs text-muted-foreground">{member.email}</p>
      {warning && (
        <p className="mt-1 flex items-start gap-1.5 text-xs font-medium text-[var(--tone-warning-text)]">
          <AlertTriangle size={13} className="mt-px shrink-0" aria-hidden="true" />
          <span>
            {t(`members.warning_${warning}`)}{" "}
            <a href={`/team/${encodeURIComponent(member.userId)}`} className="underline underline-offset-2">
              {t("members.fix")}
            </a>
          </span>
        </p>
      )}
    </div>
  );
}

function MemberCounts({ member }: { member: TeamMember }) {
  const t = useT("confirmation");
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <a href={ordersOf(member, "to_confirm")} className="font-medium tabular-nums text-foreground underline-offset-2 hover:underline">
        {t("members.waiting_count", { count: member.waiting })}
      </a>
      {member.callbacks > 0 && (
        <a href={ordersOf(member, "callbacks")} className="inline-flex items-center gap-1 text-xs font-medium tabular-nums text-muted-foreground underline-offset-2 hover:underline">
          <AlarmClock size={12} aria-hidden="true" />
          {t("members.callbacks_count", { count: member.callbacks })}
        </a>
      )}
    </span>
  );
}
