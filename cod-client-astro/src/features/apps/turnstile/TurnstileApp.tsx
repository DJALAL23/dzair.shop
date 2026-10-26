import { useEffect, useState } from "react";
import { Eye, EyeOff, Shield } from "lucide-react";
import { Input, SwitchField } from "@/components/ui";
import { useT } from "@/i18n/react";
import { getTurnstileApp, saveTurnstileApp } from "@/features/apps/turnstile/api";
import type { AppBodyProps } from "@/features/apps/types";
import { FieldRow, SettingsSection } from "@/features/settings/components/SettingsSection";

/** The Turnstile App: its bot check at checkout and the widget the storefront shows for it. */
export default function TurnstileApp({ canManage, onSaved }: AppBodyProps) {
  const t = useT("apps");
  const [siteKey, setSiteKey] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [siteKeyStored, setSiteKeyStored] = useState<string | null>(null);
  const [secretKeyMasked, setSecretKeyMasked] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getTurnstileApp().then((data) => {
      if (!alive || !data) return;
      setEnabled(data.enabled);
      setSiteKeyStored(data.siteKey);
      setSecretKeyMasked(data.secretKeyMasked);
      setLastSaved(data.updatedAt);
    });
    return () => {
      alive = false;
    };
  }, []);

  async function handleSave() {
    if (enabled && !siteKey.trim() && !siteKeyStored) {
      throw new Error(`${t("turnstile.site_key_label")} ${t("page.field_required")}`);
    }
    if (enabled && !secretKey.trim() && !secretKeyMasked) {
      throw new Error(`${t("turnstile.secret_key_label")} ${t("page.field_required")}`);
    }
    const result = await saveTurnstileApp({
      siteKey: siteKey.trim() || undefined,
      secretKey: secretKey.trim() || undefined,
      enabled,
    });
    setSiteKeyStored(result.siteKey);
    setSecretKeyMasked(result.secretKeyMasked);
    setLastSaved(result.updatedAt);
    setSiteKey("");
    setSecretKey("");
    onSaved();
  }

  return (
    <SettingsSection
      savedAt={lastSaved}
      icon={Shield}
      title={t("turnstile.title")}
      subtitle={t("turnstile.subtitle")}
      onSave={handleSave}
      readOnly={!canManage}
    >
      <SwitchField
        label={t("turnstile.enabled_label")}
        help={t("turnstile.enabled_hint")}
        checked={enabled}
        onChange={setEnabled}
      />

      <FieldRow
        label={t("turnstile.site_key_label")}
        help={
          <>
            <span className="block">{t("turnstile.site_key_hint")}</span>
            <span className="mt-1.5 block">{t("turnstile.hostname_hint")}</span>
          </>
        }
      >
        <Input
          type="text"
          dir="ltr"
          value={siteKey}
          onChange={(event) => setSiteKey(event.currentTarget.value)}
          placeholder={siteKeyStored ?? t("turnstile.site_key_placeholder")}
        />
      </FieldRow>

      <FieldRow label={t("turnstile.secret_key_label")} help={t("turnstile.secret_key_hint")}>
        <div dir="ltr" className="relative">
          <Input
            type={showSecret ? "text" : "password"}
            dir="ltr"
            value={secretKey}
            onChange={(event) => setSecretKey(event.currentTarget.value)}
            placeholder={secretKeyMasked ?? t("turnstile.secret_key_placeholder")}
            className="pe-10"
          />
          <button
            type="button"
            onClick={() => setShowSecret((current) => !current)}
            tabIndex={-1}
            aria-label={showSecret ? t("secret.hide") : t("secret.reveal")}
            className="absolute end-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
          >
            {showSecret ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </div>
      </FieldRow>
    </SettingsSection>
  );
}
