import { useEffect, useState } from "react";
import { KeyRound, Power, PowerOff, Shield } from "lucide-react";
import { useIdentity } from "@/features/auth/components/RequireAuth";
import { useLocale, useT } from "@/i18n/react";
import { notify } from "@/lib/notify";
import { Alert, Badge, Button, Card, Initial, PageHeader, useConfirmDialog } from "@/components/ui";
import { SCOPE_CATEGORIES } from "../../../../../cod-shared/rbac/scopes";
import { getTeamMember, rotateTeamMemberApiKey, setTeamMemberStatus } from "@/features/team/api";
import { formatTeamDate, scopeLabel, teamErrorMessage } from "@/features/team/model";
import type { TeamMember } from "@/features/team/types";
import { RoleBadge, StatusBadge } from "@/features/team/components/TeamMemberBadges";
import { TeamActivitySection } from "@/features/team/components/TeamActivitySection";
import { ScopeAssignmentDialog } from "@/features/team/components/ScopeAssignmentDialog";
import { RotateKeyDialog } from "@/features/team/components/RotateKeyDialog";

function Loading() {
  return (
    <div role="status" aria-busy="true" className="space-y-4">
      <div className="h-20 shimmer rounded-xl" />
      <div className="h-64 shimmer rounded-xl" />
    </div>
  );
}

/**
 * One member: what they may do, with the way to change it right here, whether
 * they can get in at all, and what they did. An admin cannot deactivate
 * their own account.
 */
export function TeamMemberDetail({ memberId }: { memberId: string }) {
  const t = useT("team");
  const common = useT("common");
  const auth = useT("auth");
  const identity = useIdentity();
  const confirm = useConfirmDialog();
  const [member, setMember] = useState<TeamMember | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [managing, setManaging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);

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
          <button type="button" onClick={() => void load()} className="mt-3 text-xs font-semibold underline underline-offset-4">
            {common("retry")}
          </button>
        </div>
      </Alert>
    );
  if (member === null) return <Loading />;

  const shown = member;
  const isSelf = identity.user.id === shown.id;

  async function setAccess(status: TeamMember["status"]) {
    if (
      status === "inactive" &&
      !(await confirm({
        title: t("member.deactivate_title", { name: shown.name }),
        description: t("member.deactivate_body"),
        confirmLabel: t("member.deactivate"),
        tone: "danger",
      }))
    )
      return;
    setBusy(true);
    try {
      setMember(await setTeamMemberStatus(shown.id, status));
      notify.success(t(status === "inactive" ? "member.deactivated" : "member.reactivated", { name: shown.name }));
    } catch (cause) {
      notify.error(teamErrorMessage(cause, t));
    } finally {
      setBusy(false);
    }
  }

  async function rotateKey() {
    if (
      !(await confirm({
        title: t("rotate_key_dialog.confirm_title", { name: shown.name }),
        description: t("rotate_key_dialog.confirm_description"),
        confirmLabel: t("rotate_key_dialog.confirm_button"),
        tone: "danger",
      }))
    )
      return;
    try {
      setNewKey((await rotateTeamMemberApiKey(shown.id)).apiKey);
      notify.success(t("api_key_generated"));
    } catch (cause) {
      notify.error(teamErrorMessage(cause, t));
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={shown.name}
        subtitle={<span dir="ltr">{shown.email}</span>}
        backHref="/team"
        backLabel={t("header.title")}
        media={<Initial name={shown.name} className="size-12 text-base" />}
        badges={
          <>
            <RoleBadge role={shown.role} />
            <StatusBadge status={shown.status} />
          </>
        }
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-5">
          <MemberPermissions member={shown} onManage={() => setManaging(true)} />
          <TeamActivitySection memberId={memberId} />
        </div>
        <div className="order-first lg:order-none">
          <MemberAccess member={shown} isSelf={isSelf} busy={busy} onAccess={(status) => void setAccess(status)} onRotateKey={() => void rotateKey()} />
        </div>
      </div>

      {managing && <ScopeAssignmentDialog open user={shown} onClose={() => setManaging(false)} onSuccess={setMember} />}
      <RotateKeyDialog open={newKey !== null} apiKey={newKey} userName={shown.name} onClose={() => setNewKey(null)} />
    </div>
  );
}

/** What the member may do, by the part of the store it opens, and the way to change it. */
function MemberPermissions({ member, onManage }: { member: TeamMember; onManage: () => void }) {
  const t = useT("team");
  const apps = useT("apps");
  const isAdmin = member.role === "admin";
  const groups = Object.entries(SCOPE_CATEGORIES)
    .map(([key, category]) => [key, (category.scopes as readonly string[]).filter((scope) => member.scopes.includes(scope))] as const)
    .filter(([, scopes]) => scopes.length > 0);

  return (
    <Card
      title={t("table.permissions")}
      action={
        !isAdmin && (
          <Button type="button" variant="secondary" size="sm" onClick={onManage}>
            <Shield size={14} aria-hidden="true" />
            {t("manage_permissions")}
          </Button>
        )
      }
    >
      {isAdmin ? (
        <p className="text-sm text-muted-foreground">{t("member.admin_everything")}</p>
      ) : groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("member.no_permissions")}</p>
      ) : (
        <dl className="-my-3 divide-y divide-border">
          {groups.map(([key, scopes]) => (
            <div key={key} className="grid gap-2 py-3 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-4">
              <dt className="text-xs font-semibold text-muted-foreground sm:pt-1">{t(`scope_categories.${key}`)}</dt>
              <dd className="flex flex-wrap gap-1.5">
                {scopes.map((scope) => (
                  <Badge key={scope} tone="neutral">
                    {scopeLabel(scope, t, apps)}
                  </Badge>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </Card>
  );
}

/** Whether the member can get in, since when, and the two levers: a new API key, and turning access off or on. */
function MemberAccess({
  member,
  isSelf,
  busy,
  onAccess,
  onRotateKey,
}: {
  member: TeamMember;
  isSelf: boolean;
  busy: boolean;
  onAccess: (status: TeamMember["status"]) => void;
  onRotateKey: () => void;
}) {
  const t = useT("team");
  const locale = useLocale();
  const active = member.status === "active";

  return (
    <Card title={t("member.access_title")}>
      <p className={`text-sm ${active ? "text-muted-foreground" : "font-medium text-[var(--tone-warning-text)]"}`}>
        {active ? t("member.access_on") : t("member.access_off")}
      </p>
      <dl className="mt-4 space-y-2 text-sm">
        <div className="flex items-center justify-between gap-3">
          <dt className="text-muted-foreground">{t("joined")}</dt>
          <dd className="font-medium text-foreground">{formatTeamDate(member.createdAt, locale)}</dd>
        </div>
      </dl>
      <div className="mt-4 flex flex-col gap-2 border-t border-border pt-4">
        <Button type="button" variant="secondary" onClick={onRotateKey} disabled={busy}>
          <KeyRound size={15} aria-hidden="true" />
          {t("rotate_api_key")}
        </Button>
        {isSelf ? (
          <p className="text-xs text-muted-foreground">{t("member.you")}</p>
        ) : active ? (
          <Button type="button" variant="dangerOutline" onClick={() => onAccess("inactive")} disabled={busy}>
            <PowerOff size={15} aria-hidden="true" />
            {t("member.deactivate")}
          </Button>
        ) : (
          <Button type="button" onClick={() => onAccess("active")} disabled={busy}>
            <Power size={15} aria-hidden="true" />
            {t("member.reactivate")}
          </Button>
        )}
      </div>
    </Card>
  );
}
