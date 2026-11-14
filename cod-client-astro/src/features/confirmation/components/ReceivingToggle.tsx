import { useEffect, useState } from "react";
import { useT } from "@/i18n/react";
import { notify } from "@/lib/notify";
import { Switch } from "@/components/ui";
import { getMyMembership, setMyReceiving } from "@/features/confirmation/api";

/**
 * A team member starts and ends their shift: while on, new orders reach them
 * by the store's rule, starting with the ones that waited for someone. Shown
 * only to members of the confirmation team.
 */
export function ReceivingToggle({ onChanged }: { onChanged?: () => void }) {
  const t = useT("confirmation");
  const [membership, setMembership] = useState<{ member: boolean; receiving: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getMyMembership()
      .then(setMembership)
      .catch(() => setMembership(null));
  }, []);

  if (!membership?.member) return null;

  async function change(receiving: boolean) {
    setBusy(true);
    try {
      setMembership(await setMyReceiving(receiving));
      onChanged?.();
    } catch {
      notify.error(t("me.error"));
    } finally {
      setBusy(false);
    }
  }

  const label = membership.receiving ? t("me.receiving_on") : t("me.receiving_off");
  return (
    <label
      className={`inline-flex h-9 items-center gap-2.5 rounded-lg border px-3 text-sm font-medium ${
        membership.receiving ? "border-[var(--tone-success-text)]/30 bg-[var(--tone-success-bg)] text-[var(--tone-success-text)]" : "border-border bg-card text-muted-foreground"
      }`}
    >
      <span className={`size-2 shrink-0 rounded-full ${membership.receiving ? "bg-[var(--tone-success-text)]" : "bg-foreground/25"}`} aria-hidden="true" />
      <span className="max-sm:hidden">{label}</span>
      <span className="sm:hidden" aria-hidden="true">
        {membership.receiving ? t("me.short_on") : t("me.short_off")}
      </span>
      <Switch checked={membership.receiving} disabled={busy} onChange={(on) => void change(on)} aria-label={label} />
    </label>
  );
}
