import { Activity, KeyRound, MoreHorizontal, Shield } from "lucide-react";
import {
  Badge,
  DropdownItem,
  DropdownMenu,
  Initial,
  RowActions,
  RowTitle,
  TableCell,
  TableRow,
  openRowOnClick,
} from "@/components/ui";
import { useT } from "@/i18n/react";
import { teamScopeCount } from "@/features/team/model";
import type { TeamMember } from "@/features/team/types";

function StatusBadge({ status }: { status: TeamMember["status"] }) {
  const t = useT("team");
  return status === "active" ? (
    <Badge tone="success">{t("status.active")}</Badge>
  ) : (
    <Badge tone="neutral">{t("status.inactive")}</Badge>
  );
}

function MemberActionsMenu({
  member,
  onView,
  onManageScopes,
  onRotateApiKey,
}: {
  member: TeamMember;
  onView: (member: TeamMember) => void;
  onManageScopes: (member: TeamMember) => void;
  onRotateApiKey: (member: TeamMember) => void;
}) {
  const t = useT("team");
  const common = useT("common");
  return (
    <DropdownMenu
      trigger={<MoreHorizontal size={16} />}
      triggerLabel={common("table.actions")}
    >
      <DropdownItem onClick={() => onView(member)}>
        <Activity size={15} />
        {t("view_activity")}
      </DropdownItem>
      <DropdownItem onClick={() => onManageScopes(member)}>
        <Shield size={15} />
        {t("manage_permissions")}
      </DropdownItem>
      <DropdownItem onClick={() => onRotateApiKey(member)}>
        <KeyRound size={15} />
        {t("rotate_api_key")}
      </DropdownItem>
    </DropdownMenu>
  );
}

interface TeamRowProps {
  member: TeamMember;
  onView: (member: TeamMember) => void;
  onManageScopes: (member: TeamMember) => void;
  onRotateApiKey: (member: TeamMember) => void;
}

function memberHref(member: TeamMember) {
  return `/team/${encodeURIComponent(member.id)}`;
}

export function TeamDesktopRow({ member, ...menu }: TeamRowProps) {
  const common = useT("common");
  return (
    <TableRow onClick={openRowOnClick(memberHref(member))} className="cursor-pointer">
      <TableCell className="max-w-64">
        <RowTitle href={memberHref(member)} media={<Initial name={member.name} />}>
          {member.name}
        </RowTitle>
      </TableCell>
      <TableCell className="max-w-64 truncate text-muted-foreground">
        <span dir="ltr">{member.email}</span>
      </TableCell>
      <TableCell className="text-muted-foreground">{common(`roles.${member.role}`)}</TableCell>
      <TableCell>
        <StatusBadge status={member.status} />
      </TableCell>
      <TableCell numeric>{teamScopeCount(member)}</TableCell>
      <TableCell className="w-px">
        <RowActions>
          <MemberActionsMenu member={member} {...menu} />
        </RowActions>
      </TableCell>
    </TableRow>
  );
}

export function TeamMobileCard({ member, ...menu }: TeamRowProps) {
  const common = useT("common");
  return (
    <article
      onClick={openRowOnClick(memberHref(member))}
      className="flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors active:bg-subtle"
    >
      <Initial name={member.name} className="size-9" />
      <div className="min-w-0 flex-1">
        <a href={memberHref(member)} className="block truncate text-sm font-medium text-foreground">
          {member.name}
        </a>
        <p className="truncate text-xs text-muted-foreground">{common(`roles.${member.role}`)}</p>
      </div>
      <StatusBadge status={member.status} />
      <MemberActionsMenu member={member} {...menu} />
    </article>
  );
}
