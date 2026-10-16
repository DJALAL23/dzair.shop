import { useState } from "react";
import { Check, Copy, Eye, EyeOff, Key } from "lucide-react";
import { useT } from "@/i18n/react";
import { notify } from "@/lib/notify";
import { Button, inputClass } from "@/components/ui";
import type { StoreConfig } from "@/features/settings/types";

export function ApiSettings({ storeConfig }: { storeConfig: StoreConfig }) {
  const t = useT("settings");
  const common = useT("common");
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);

  const apiKey = storeConfig.storeApiKey;

  async function handleCopy() {
    if (!apiKey) return;
    try {
      await navigator.clipboard.writeText(apiKey);
      setCopied(true);
      notify.success(t("store.api_key_copied"));
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
      notify.error(common("feedback.copy_failed"));
    }
  }

  return (
    <section className="rounded-xl bg-card shadow-card">
      <div className="flex items-start gap-3 border-b border-border px-5 py-4">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
          <Key size={18} aria-hidden="true" />
        </span>
        <div>
          <h2 className="text-sm font-semibold text-foreground">{t("store.api_key_title")}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{t("store.api_key_subtitle")}</p>
        </div>
      </div>
      <div className="px-5 py-5">
        {apiKey ? (
          <div className="space-y-1.5">
            <span className="text-sm font-medium text-foreground">{t("store.api_key_label")}</span>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <input
                  readOnly
                  dir="ltr"
                  type={revealed ? "text" : "password"}
                  value={apiKey}
                  aria-label={t("store.api_key_label")}
                  className={`${inputClass} cursor-default select-all pe-10 font-mono`}
                />
                <button
                  type="button"
                  onClick={() => setRevealed((current) => !current)}
                  title={revealed ? t("store.api_key_hide") : t("store.api_key_reveal")}
                  aria-label={revealed ? t("store.api_key_hide") : t("store.api_key_reveal")}
                  className="absolute end-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                >
                  {revealed ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
              <Button type="button" variant="secondary" onClick={() => void handleCopy()}>
                {copied ? (
                  <>
                    <Check size={14} className="text-[var(--tone-success-text)]" aria-hidden="true" />
                    {t("store.api_key_copied")}
                  </>
                ) : (
                  <>
                    <Copy size={14} aria-hidden="true" />
                    {t("store.api_key_copy")}
                  </>
                )}
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t("store.api_key_missing")}</p>
        )}
      </div>
    </section>
  );
}
