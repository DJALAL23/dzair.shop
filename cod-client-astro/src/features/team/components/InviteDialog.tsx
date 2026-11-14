import { useEffect, useRef, useState, type SyntheticEvent } from "react";
import { Check, Copy, MailCheck, UserPlus } from "lucide-react";
import { Alert, Button, Dialog, Field, Input, Select } from "@/components/ui";
import { useT } from "@/i18n/react";
import { notify } from "@/lib/notify";
import { createTeamMember } from "@/features/team/api";
import { teamErrorMessage } from "@/features/team/model";
import type { TeamMemberFormValues, TeamRole } from "@/features/team/types";
import { PermissionDialogFooter, PermissionPicker, TeamDialogTitle } from "@/features/team/components/PermissionPicker";

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

type DialogState = "form" | "success";

const EMPTY_FORM: TeamMemberFormValues = {
  name: "",
  email: "",
  role: "staff",
  scopes: [],
  language: "en",
};

export function InviteDialog({ open, onClose, onSuccess }: Props) {
  const t = useT("team");
  const apps = useT("apps");
  const common = useT("common");
  const [loading, setLoading] = useState(false);
  const [dialogState, setDialogState] = useState<DialogState>("form");
  const [createdApiKey, setCreatedApiKey] = useState("");
  const [createdTempPassword, setCreatedTempPassword] = useState("");
  const [createdName, setCreatedName] = useState("");
  const [createdEmail, setCreatedEmail] = useState("");
  const [emailSent, setEmailSent] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedPassword, setCopiedPassword] = useState(false);
  const [form, setForm] = useState<TeamMemberFormValues>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const isAdmin = form.role === "admin";

  useEffect(() => {
    if (open) {
      setForm(EMPTY_FORM);
      setCreatedApiKey("");
      setCreatedTempPassword("");
      setCreatedName("");
      setCreatedEmail("");
      setEmailSent(false);
      setEmailError(null);
      setCopied(false);
      setCopiedPassword(false);
      setError(null);
      setDialogState("form");
    }
  }, [open]);

  function update<K extends keyof TeamMemberFormValues>(key: K, value: TeamMemberFormValues[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function copyText(value: string, setter: (v: boolean) => void, successMessage: string) {
    try {
      await navigator.clipboard.writeText(value);
      setter(true);
      notify.success(successMessage);
      window.setTimeout(() => setter(false), 2000);
    } catch {
      const message = common("feedback.copy_failed");
      setError(message);
      notify.error(message);
    }
  }

  function handleDone() {
    onClose();
    onSuccess?.();
  }

  async function handleSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.name.trim() || !form.email.trim()) {
      setError(t("invite_dialog.validation_error"));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await createTeamMember({
        name: form.name.trim(),
        email: form.email.trim(),
        role: form.role,
        scopes: isAdmin ? [] : form.scopes,
        language: form.language,
      });
      setCreatedApiKey(result.apiKey);
      setCreatedTempPassword(result.tempPassword);
      setCreatedName(result.user.name || form.name.trim());
      setCreatedEmail(form.email.trim());
      setEmailSent(result.emailSent);
      setEmailError(result.emailError);
      setDialogState("success");
      notify.success(result.emailSent ? t("invite_dialog.success") : t("invite_dialog_extra.success_title"));
    } catch (cause) {
      setError(teamErrorMessage(cause, t));
      notify.error(t("invite_dialog.error"));
    } finally {
      setLoading(false);
    }
  }

  const succeeded = dialogState === "success";

  return (
    <Dialog
      open={open}
      onClose={onClose}
      preventClose={loading}
      title={
        <TeamDialogTitle
          icon={succeeded ? <MailCheck size={16} aria-hidden="true" /> : <UserPlus size={16} aria-hidden="true" />}
          title={succeeded ? t("invite_dialog_extra.success_title") : t("invite_dialog.title")}
          about={succeeded ? createdName : undefined}
        />
      }
      description={succeeded ? undefined : t("invite_dialog.description")}
      initialFocusRef={nameRef}
      className="max-w-2xl"
      footer={
        succeeded ? (
          <Button type="button" onClick={handleDone}>
            {t("rotate_key_dialog.done")}
          </Button>
        ) : undefined
      }
    >
      {succeeded ? (
        <div className="space-y-4">
          <Alert tone={emailSent ? "success" : "warning"} role="status">
            <p className="font-semibold">
              {emailSent
                ? t("invite_dialog_extra.email_sent")
                : emailError
                  ? t("invite_dialog_extra.email_failed")
                  : t("invite_dialog_extra.email_not_configured")}
            </p>
            <p className="mt-0.5 text-xs opacity-80" dir="ltr">
              {createdEmail}
            </p>
            {!emailSent && <p className="mt-1 text-xs font-semibold">{t("invite_dialog_extra.email_share_manually")}</p>}
          </Alert>
          <Field label={t("invite_dialog_extra.api_key_label")}>
            <div className="flex items-center gap-2">
              <Input value={createdApiKey} readOnly dir="ltr" className="font-mono" />
              <Button
                type="button"
                variant="secondary"
                onClick={() => void copyText(createdApiKey, setCopied, t("api_key_copied"))}
                aria-label={t("api_key_copied")}
              >
                {copied ? <Check size={15} className="text-tone-success-text" /> : <Copy size={15} />}
              </Button>
            </div>
          </Field>
          <Field label={t("invite_dialog_extra.temp_password_label")}>
            <div className="flex items-center gap-2">
              <Input value={createdTempPassword} readOnly dir="ltr" className="font-mono" />
              <Button
                type="button"
                variant="secondary"
                onClick={() => void copyText(createdTempPassword, setCopiedPassword, common("feedback.copied"))}
                aria-label={t("invite_dialog_extra.temp_password_label")}
              >
                {copiedPassword ? <Check size={15} className="text-tone-success-text" /> : <Copy size={15} />}
              </Button>
            </div>
          </Field>
          <Alert tone="warning">
            <p className="font-semibold">{t("invite_dialog_extra.api_key_warning")}</p>
            <p className="mt-1 text-xs">{t("invite_dialog_extra.temp_password_warning")}</p>
          </Alert>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <Alert tone="critical" role="alert">
              {error}
            </Alert>
          )}
          <Field label={t("invite_dialog.name")}>
            <Input
              ref={nameRef}
              value={form.name}
              onChange={(event) => update("name", event.currentTarget.value)}
              placeholder={t("invite_dialog.name_placeholder")}
              required
              disabled={loading}
            />
          </Field>
          <Field label={t("invite_dialog.email")}>
            <Input
              type="email"
              value={form.email}
              onChange={(event) => update("email", event.currentTarget.value)}
              placeholder={t("invite_dialog.email_placeholder")}
              required
              disabled={loading}
              dir="ltr"
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("invite_dialog.role")} help={t("invite_dialog.role_help")}>
              <Select
                value={form.role}
                onChange={(event) => {
                  update("role", event.currentTarget.value as TeamRole);
                  if (event.currentTarget.value === "admin") update("scopes", []);
                }}
                disabled={loading}
              >
                <option value="staff">{common("roles.staff")}</option>
                <option value="admin">{common("roles.admin")}</option>
              </Select>
            </Field>
            <Field label={t("invite_dialog_extra.email_language_label")} help={t("invite_dialog.language_help")}>
              <Select
                value={form.language}
                onChange={(event) => update("language", event.currentTarget.value as "ar" | "en")}
                disabled={loading}
              >
                <option value="en">English</option>
                <option value="ar">العربية</option>
              </Select>
            </Field>
          </div>

          {isAdmin ? (
            <Alert tone="info">{t("invite_dialog_extra.admin_full_access")}</Alert>
          ) : (
            <div className="space-y-3 pt-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-foreground">{t("invite_dialog_extra.permissions_label")}</p>
                <span className="text-xs font-semibold text-muted-foreground">{t("invite_dialog_extra.n_selected", { count: form.scopes.length })}</span>
              </div>
              <PermissionPicker selected={form.scopes} onChange={(scopes) => update("scopes", scopes)} disabled={loading} />
            </div>
          )}
          <PermissionDialogFooter>
            <Button type="button" variant="secondary" onClick={onClose} disabled={loading}>
              {t("invite_dialog.cancel")}
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? t("invite_dialog.sending") : t("invite_dialog.send_invite")}
            </Button>
          </PermissionDialogFooter>
        </form>
      )}
    </Dialog>
  );
}
