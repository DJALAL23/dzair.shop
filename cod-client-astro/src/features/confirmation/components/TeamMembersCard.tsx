import { useState, type ReactNode } from "react";
import { AlarmClock, AlertTriangle, Plus, Trash2, Users } from "lucide-react";
import { useT } from "@/i18n/react";
import { notify } from "@/lib/notify";
import { Badge, Button, Card, EmptyState, IconButton, Initial, Pagination, RowActions, SearchInput, Switch, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, useConfirmDialog } from "@/components/ui";
import { removeTeamMember, setMemberReceiving } from "@/features/confirmation/api";
import { memberWarning } from "@/features/confirmation/model";
import { findMembers, pageOf, PAGE_SIZE } from "@/features/confirmation/views";
import { useTeamError } from "@/features/confirmation/errors";
import type { TeamConfig, TeamMember } from "@/features/confirmation/types";

const ordersOf = (member: TeamMember, view: "to_confirm" | "callbacks") => `/orders?${new URLSearchParams({ view, assignee: member.userId })}`;
const SEARCH_FROM = 6;

/**
 * The team's members: who is receiving new orders now, how many orders wait
 * with each and how many customers they must call back, and which orders
 * their permissions let them work. A row warns when a member cannot take
 * orders, and says how to fix it. A larger team gets a search and pages.
 */
export function TeamMembersCard({ members, config, meId, canManage, onAdd, onChanged, rule }: {
  members: TeamMember[];
  config: TeamConfig;
  meId?: string;
  canManage: boolean;
  onAdd: () => void;
  onChanged: () => void;
  rule?: ReactNode;
}) {
  const t = useT("confirmation");
  const common = useT("common");
  const explain = useTeamError();
  const confirm = useConfirmDialog();
  const [busy, setBusy] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);

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

  const addButton = canManage ? (
    <Button type="button" size="sm" onClick={onAdd}>
      <Plus size={14} aria-hidden="true" />
      {t("members.add")}
    </Button>
  ) : undefined;

  if (members.length === 0) {
    return (
      <Card title={t("members.title")} flush className="overflow-hidden">
        {rule}
        <div className="border-t border-border p-4">
          <EmptyState icon={<Users />} title={t("members.empty_title")} description={t("members.empty_body")} action={addButton} />
        </div>
      </Card>
    );
  }

  const found = findMembers(members, query);
  const shown = pageOf(found, page);

  const receivingSwitch = (member: TeamMember) =>
    canManage ? (
      <Switch checked={member.receiving} disabled={busy === member.userId || !member.active} onChange={(on) => void changeReceiving(member, on)} aria-label={t("members.receiving_for", { name: member.name })} />
    ) : member.receiving ? (
      <Badge tone="success" size="sm" dot>
        {t("members.receiving")}
      </Badge>
    ) : (
      <span className="text-xs text-muted-foreground">{t("members.not_receiving")}</span>
    );

  const removeButton = (member: TeamMember) =>
    canManage && (
      <IconButton
        type="button"
        variant="danger"
        disabled={busy === member.userId}
        onClick={() => void remove(member)}
        aria-label={t("members.remove_name", { name: member.name })}
        title={t("members.remove")}
      >
        <Trash2 size={15} aria-hidden="true" />
      </IconButton>
    );

  return (
    <Card title={t("members.title")} action={addButton} flush className="overflow-hidden">
      {rule}
      {members.length >= SEARCH_FROM && (
        <div className="border-t border-border px-4 py-2.5">
          <SearchInput
            value={query}
            onChange={(next) => {
              setQuery(next);
              setPage(1);
            }}
            placeholder={t("members.search")}
            className="@lg:max-w-72"
          />
        </div>
      )}
      {found.length === 0 ? (
        <p className="border-t border-border px-4 py-8 text-center text-sm text-muted-foreground">{t("members.none_found", { query: query.trim() })}</p>
      ) : (
        <>
          <ul className="divide-y divide-border border-t border-border @2xl:hidden">
            {shown.rows.map((member) => (
              <li key={member.userId} className="flex items-start gap-3 px-4 py-3">
                <Initial name={member.name} className="size-9" />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <MemberName member={member} me={member.userId === meId} />
                    {receivingSwitch(member)}
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 space-y-0.5">
                      <MemberCounts member={member} />
                      <span className="block text-xs text-muted-foreground">{t(`members.reach_${member.reach}`)}</span>
                    </span>
                    {removeButton(member)}
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <div className="relative hidden overflow-x-auto @2xl:block">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>{t("members.member")}</TableHead>
                  <TableHead>{t("members.receiving")}</TableHead>
                  <TableHead>{t("members.waiting")}</TableHead>
                  <TableHead>{t("members.sees")}</TableHead>
                  {canManage && (
                    <TableHead className="w-px">
                      <span className="sr-only">{common("table.actions")}</span>
                    </TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.rows.map((member) => (
                  <TableRow key={member.userId}>
                    <TableCell className="max-w-96">
                      <span className="flex min-w-0 items-center gap-3">
                        <Initial name={member.name} />
                        <MemberName member={member} me={member.userId === meId} />
                      </span>
                    </TableCell>
                    <TableCell>{receivingSwitch(member)}</TableCell>
                    <TableCell>
                      <MemberCounts member={member} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{t(`members.reach_${member.reach}`)}</TableCell>
                    {canManage && (
                      <TableCell className="w-px">
                        <RowActions>{removeButton(member)}</RowActions>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {shown.totalPages > 1 && <Pagination page={shown.page} totalPages={shown.totalPages} total={shown.total} pageSize={PAGE_SIZE} onPageChange={setPage} />}
        </>
      )}
    </Card>
  );
}

function MemberName({ member, me }: { member: TeamMember; me: boolean }) {
  const t = useT("confirmation");
  const warning = memberWarning(member);
  return (
    <div className="min-w-0">
      <p className="flex items-center gap-1.5 font-medium text-foreground">
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
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1 whitespace-nowrap text-sm">
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
