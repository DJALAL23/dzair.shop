import { useState } from "react";
import { Check, Copy, KeyRound } from "lucide-react";
import { Button, Dialog, inputClass } from "@/components/ui";
import { useLocale, useT } from "@/i18n/react";
import { notify } from "@/lib/notify";
import { relativeTime } from "@/lib/relative-time";
import type { IssuedSecret } from "@/features/events/types";

/** A Signing Secret in full, the one time it is seen: when a webhook is added, and when its secret is changed. */
export function SigningSecretDialog({ secret, onClose }: { secret: IssuedSecret; onClose: () => void }) {
  const t = useT("events");
  const common = useT("common");
  const locale = useLocale();
  const [copied, setCopied] = useState(false);
  const rotated = secret.previousSecretSignsUntil !== undefined;

  async function copy() {
    try {
      await navigator.clipboard.writeText(secret.signingSecret);
      setCopied(true);
    } catch {
      notify.error(common("feedback.copy_failed"));
    }
  }

  return (
    <Dialog
      onClose={onClose}
      role="alertdialog"
      title={t(rotated ? "secret.rotated_title" : "secret.created_title")}
      description={rotated ? t("secret.rotated_body", { time: relativeTime(secret.previousSecretSignsUntil!, locale) }) : t("secret.body")}
      icon={<KeyRound size={18} />}
      footer={<Button onClick={onClose}>{t("secret.done")}</Button>}
    >
      <div className="flex gap-2">
        <input readOnly dir="ltr" aria-label={t("secret.copy")} value={secret.signingSecret} className={`${inputClass} font-mono text-xs`} onFocus={(event) => event.currentTarget.select()} />
        <Button variant="secondary" onClick={() => void copy()}>
          {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
          {t(copied ? "secret.copied" : "secret.copy")}
        </Button>
      </div>
      {rotated && <p className="mt-3 text-xs text-muted-foreground">{t("secret.body")}</p>}
    </Dialog>
  );
}
