import { useEffect, useMemo, useState } from "react";
import { Save, Shield } from "lucide-react";
import { Alert, Button, Dialog } from "@/components/ui";
import { useT } from "@/i18n/react";
import { notify } from "@/lib/notify";
import { setTeamMemberScopes } from "@/features/team/api";
import { teamErrorMessage } from "@/features/team/model";
import type { TeamMember } from "@/features/team/types";
import { KNOWN_SCOPES, PermissionDialogFooter, PermissionPicker, TeamDialogTitle } from "@/features/team/components/PermissionPicker";

interface Props {
  open: boolean;
  onClose: () => void;
  user: TeamMember;
  onSuccess?: (member: TeamMember) => void;
}

/** A member's permissions, ticked or not, saved all at once. */
export function ScopeAssignmentDialog({ open, onClose, user, onSuccess }: Props) {
  const t = useT("team");
  const current = useMemo(() => (user.scopes ?? []).filter((scope) => KNOWN_SCOPES.includes(scope)), [user]);
  const [selected, setSelected] = useState<string[]>(current);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isAdmin = user.role === "admin";
  const changed = selected.some((scope) => !current.includes(scope)) || current.some((scope) => !selected.includes(scope));

  useEffect(() => {
    if (!open) return;
    setSelected(current);
    setError(null);
  }, [open, current]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const member = await setTeamMemberScopes(user.id, selected);
      notify.success(t("scope_dialog.success"));
      onClose();
      onSuccess?.(member);
    } catch (cause) {
      setError(teamErrorMessage(cause, t));
      notify.error(t("scope_dialog.error"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!saving) onClose();
      }}
      title={<TeamDialogTitle icon={<Shield size={16} aria-hidden="true" />} title={t("scope_dialog.title")} about={user.name} />}
      className="max-w-2xl"
      showClose={!saving}
    >
      {error && (
        <Alert tone="critical" role="alert" className="mb-4">
          {error}
        </Alert>
      )}
      {isAdmin ? (
        <Alert tone="info">{t("scope_dialog.admin_full_access")}</Alert>
      ) : (
        <PermissionPicker selected={selected} current={current} onChange={setSelected} disabled={saving} />
      )}
      <PermissionDialogFooter>
        <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
          {t("scope_dialog.cancel")}
        </Button>
        {!isAdmin && (
          <Button type="button" onClick={() => void save()} disabled={saving || !changed}>
            <Save size={15} aria-hidden="true" />
            {saving ? t("scope_dialog.saving") : t("scope_dialog.save_changes")}
          </Button>
        )}
      </PermissionDialogFooter>
    </Dialog>
  );
}
