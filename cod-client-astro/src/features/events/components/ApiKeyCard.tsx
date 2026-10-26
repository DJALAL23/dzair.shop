import { useEffect, useState } from "react";
import { Check, Copy, Eye, EyeOff, Key } from "lucide-react";
import { useT } from "@/i18n/react";
import { notify } from "@/lib/notify";
import { Button, inputClass } from "@/components/ui";
import { getMyStore } from "@/features/settings/api";

/** The store's API key, for the merchant's own systems to call the API with. Admins only. */
export function ApiKeyCard() {
  const t = useT("events");
  const common = useT("common");
  const [apiKey, setApiKey] = useState<string | null | undefined>(undefined);
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    getMyStore().then(
      (store) => alive && setApiKey(store.storeApiKey),
      () => alive && setApiKey(null),
    );
    return () => {
      alive = false;
    };
  }, []);

  async function handleCopy() {
    if (!apiKey) return;
    try {
      await navigator.clipboard.writeText(apiKey);
      setCopied(true);
      notify.success(t("api_key.copied"));
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
          <h2 className="text-sm font-semibold text-foreground">{t("api_key.title")}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{t("api_key.subtitle")}</p>
        </div>
      </div>
      <div className="px-5 py-5">
        {apiKey === undefined ? (
          <div role="status" aria-busy="true" className="h-10 shimmer rounded-lg" />
        ) : apiKey ? (
          <div className="space-y-1.5">
            <span className="text-sm font-medium text-foreground">{t("api_key.label")}</span>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <input
                  readOnly
                  dir="ltr"
                  type={revealed ? "text" : "password"}
                  value={apiKey}
                  aria-label={t("api_key.label")}
                  className={`${inputClass} cursor-default select-all pe-10 font-mono`}
                />
                <button
                  type="button"
                  onClick={() => setRevealed((current) => !current)}
                  title={revealed ? t("api_key.hide") : t("api_key.reveal")}
                  aria-label={revealed ? t("api_key.hide") : t("api_key.reveal")}
                  className="absolute end-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                >
                  {revealed ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
              <Button type="button" variant="secondary" onClick={() => void handleCopy()}>
                {copied ? (
                  <>
                    <Check size={14} className="text-[var(--tone-success-text)]" aria-hidden="true" />
                    {t("api_key.copied")}
                  </>
                ) : (
                  <>
                    <Copy size={14} aria-hidden="true" />
                    {t("api_key.copy")}
                  </>
                )}
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t("api_key.missing")}</p>
        )}
      </div>
    </section>
  );
}
