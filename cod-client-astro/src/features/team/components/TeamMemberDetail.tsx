import { useEffect, useState } from "react";
import { CalendarDays, Crown, Shield, User as UserIcon } from "lucide-react";
import { useIdentity } from "@/features/auth/components/RequireAuth";
import { useLocale, useT } from "@/i18n/react";
import { Alert, PageHeader, StatStrip } from "@/components/ui";
import { getTeamMember } from "@/features/team/api";
import { formatTeamDate, teamScopeCount } from "@/features/team/model";
import type { TeamMember } from "@/features/team/types";
import {
  RoleBadge,
  StatusBadge,
} from "@/features/team/components/TeamMemberBadges";
import { TeamActivitySection } from "@/features/team/components/TeamActivitySection";

function Loading() {
  return (
    <div role="status" aria-busy="true" className="space-y-4">
      <div className="h-20 shimmer rounded-xl" />
      <div className="h-64 shimmer rounded-xl" />
    </div>
  );
}

export function TeamMemberDetail({ memberId }: { memberId: string }) {
  const t = useT("team");
  const common = useT("common");
  const auth = useT("auth");
  const locale = useLocale();
  const identity = useIdentity();
  const [member, setMember] = useState<TeamMember | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);

  async function load() {
    setLoadError(null);
    try {
      setMember(await getTeamMember(memberId));
    } catch (cause) {
      setLoadError(cause);
    }
  }

  useEffect(() => {
    if (identity?.role === "admin") void load();
  }, [identity?.role, memberId]);

  if (identity?.role !== "admin")
    return (
      <Alert role="alert" tone="critical">
        {auth("no_access")}
      </Alert>
    );
  if (loadError)
    return (
      <Alert role="alert" tone="critical">
        <div className="flex-1">
          <p className="font-semibold">{t("error_load")}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-3 text-xs font-semibold underline underline-offset-4"
          >
            {common("retry")}
          </button>
        </div>
      </Alert>
    );
  if (member === null) return <Loading />;

  return (
    <div className="space-y-5">
      <PageHeader
        title={member.name}
        subtitle={<span dir="ltr">{member.email}</span>}
        backHref="/team"
        backLabel={t("header.title")}
        media={
          <span className="grid size-12 place-items-center rounded-full bg-muted text-muted-foreground">
            {member.role === "admin" ? <Crown size={20} aria-hidden="true" /> : <UserIcon size={20} aria-hidden="true" />}
          </span>
        }
        badges={
          <>
            <RoleBadge role={member.role} />
            <StatusBadge status={member.status} />
          </>
        }
      />
      <StatStrip
        items={[
          { label: t("joined"), value: formatTeamDate(member.createdAt, locale), icon: CalendarDays },
          { label: t("table.permissions"), value: teamScopeCount(member), icon: Shield },
        ]}
      />

      <TeamActivitySection memberId={memberId} />
    </div>
  );
}
