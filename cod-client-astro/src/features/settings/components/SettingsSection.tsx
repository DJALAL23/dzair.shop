import { useState, type ReactNode } from "react";
import { Check, Loader2, type LucideIcon } from "lucide-react";
import { Button, InfoTip } from "@/components/ui";
import { useLocale, useT } from "@/i18n/react";
import { notify } from "@/lib/notify";

/** Section card with icon header and a save action that reports inline status. */
export function SettingsSection({
  icon: Icon,
  title,
  subtitle,
  children,
  onSave,
  savedAt,
  readOnly = false,
}: {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  children: ReactNode;
  onSave: () => Promise<void>;
  /** When this section was last saved, for settings stored on their own. */
  savedAt?: string | null;
  /** Shown to someone who may see these settings but not change them: no field can be edited, nothing saved. */
  readOnly?: boolean;
}) {
  const t = useT("settings");
  const locale = useLocale();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");
  const [error, setError] = useState("");

  async function handleSave() {
    setBusy(true);
    setStatus("idle");
    try {
      await onSave();
      setStatus("saved");
      notify.success(t("store.saved"));
      window.setTimeout(() => setStatus("idle"), 2500);
    } catch (cause) {
      const detail =
        cause instanceof Error && cause.message && cause.message !== "Error"
          ? cause.message
          : t("store.save_error");
      setError(detail);
      setStatus("error");
      notify.error(t("store.save_error"));
      window.setTimeout(() => setStatus("idle"), 4000);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl bg-card shadow-card">
      <div className="flex items-start gap-3 border-b border-border px-5 py-4">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
          <Icon size={18} aria-hidden="true" />
        </span>
        <div>
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
        </div>
      </div>
      <fieldset disabled={readOnly} className="min-w-0 space-y-5 px-5 py-5">{children}</fieldset>
      <div className="flex items-center justify-end gap-3 border-t border-border px-5 py-4">
        {savedAt && status === "idle" && (
          <span className="me-auto text-xs text-muted-foreground">
            {t("store.tracking_last_saved")}: {new Date(savedAt).toLocaleString(locale)}
          </span>
        )}
        {status === "saved" && (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--tone-success-text)]">
            <Check size={14} aria-hidden="true" />
            {t("store.saved")}
          </span>
        )}
        {status === "error" && (
          <span className="text-xs font-medium text-destructive">{error}</span>
        )}
        {!readOnly && (
          <Button type="button" onClick={() => void handleSave()} disabled={busy}>
            {busy && <Loader2 size={15} className="animate-spin" aria-hidden="true" />}
            {busy ? t("store.saving") : t("store.save")}
          </Button>
        )}
      </div>
    </section>
  );
}

/** Label + control; the label's ⓘ holds the explanation. */
export function FieldRow({
  label,
  help,
  children,
}: {
  label: string;
  help?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
        <span>{label}</span>
        {help && <InfoTip>{help}</InfoTip>}
      </span>
      {children}
    </div>
  );
}
