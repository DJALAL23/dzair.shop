import { useEffect, useState } from "react";
import { Eye, EyeOff, MessageCircle, ShieldCheck } from "lucide-react";
import { Button, Input, Select, SwitchField } from "@/components/ui";
import { useT } from "@/i18n/react";
import { getOtpConfig, saveOtpConfig, testOtpConnection } from "@/features/settings/api";
import type { OtpConnectionCheck } from "@/features/settings/types";
import { FieldRow, SettingsSection } from "@/features/settings/components/SettingsSection";

type Language = "ar" | "fr" | "en";

export function VerificationSettings() {
  const t = useT("settings");
  const [apiKey, setApiKey] = useState("");
  const [language, setLanguage] = useState<Language>("ar");
  const [enabled, setEnabled] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [apiKeyMasked, setApiKeyMasked] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [check, setCheck] = useState<OtpConnectionCheck | null>(null);

  useEffect(() => {
    let alive = true;
    getOtpConfig().then((data) => {
      if (!alive || !data) return;
      setLanguage(data.language);
      setEnabled(data.enabled);
      setApiKeyMasked(data.apiKeyMasked);
      setLastSaved(data.updatedAt);
    });
    return () => {
      alive = false;
    };
  }, []);

  async function handleSave() {
    if (enabled && !apiKey.trim() && !apiKeyMasked) {
      throw new Error(`${t("store.otp_key_label")} ${t("store.field_required")}`);
    }
    const result = await saveOtpConfig({
      apiKey: apiKey.trim() || undefined,
      language,
      enabled,
    });
    setApiKeyMasked(result.apiKeyMasked);
    setLastSaved(result.updatedAt);
    setApiKey("");
  }

  async function handleTest() {
    setChecking(true);
    setCheck(null);
    try {
      setCheck(await testOtpConnection(apiKey.trim() || undefined));
    } catch {
      setCheck({ ok: false, message: t("store.otp_check_failed") });
    } finally {
      setChecking(false);
    }
  }

  return (
    <SettingsSection
      savedAt={lastSaved}
      icon={ShieldCheck}
      title={t("store.otp_title")}
      subtitle={t("store.otp_subtitle")}
      onSave={handleSave}
    >
      <SwitchField
        label={t("store.otp_enabled_label")}
        help={t("store.otp_enabled_hint")}
        checked={enabled}
        onChange={setEnabled}
      />

      <FieldRow label={t("store.otp_key_label")} help={t("store.otp_key_hint")}>
        <div className="relative">
          <Input
            type={showKey ? "text" : "password"}
            dir="ltr"
            value={apiKey}
            onChange={(event) => setApiKey(event.currentTarget.value)}
            placeholder={apiKeyMasked ?? t("store.otp_key_placeholder")}
            className="pe-10"
          />
          <button
            type="button"
            onClick={() => setShowKey((current) => !current)}
            tabIndex={-1}
            aria-label={showKey ? t("store.api_key_hide") : t("store.api_key_reveal")}
            className="absolute end-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
          >
            {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </div>
      </FieldRow>

      <FieldRow label={t("store.otp_language_label")} help={t("store.otp_language_hint")}>
        <Select value={language} onChange={(event) => setLanguage(event.target.value as Language)}>
          <option value="ar">العربية (WhatsApp)</option>
          <option value="fr">Français (WhatsApp)</option>
          <option value="en">English (WhatsApp)</option>
        </Select>
      </FieldRow>

      <div className="space-y-2 border-t border-border pt-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <MessageCircle size={15} aria-hidden="true" />
            {t("store.otp_check_title")}
          </div>
          <Button type="button" variant="secondary" size="sm" onClick={() => void handleTest()} disabled={checking || (!apiKey.trim() && !apiKeyMasked)}>
            {checking ? t("store.otp_checking") : t("store.otp_check_btn")}
          </Button>
        </div>

        {check && (
          <div
            className={`rounded-lg border px-3 py-2 text-xs font-semibold ${
              check.ok
                ? "border-[var(--tone-success-border)] bg-[var(--tone-success-bg)] text-[var(--tone-success-text)]"
                : "border-destructive/30 bg-destructive/5 text-destructive"
            }`}
          >
            {check.ok && check.balanceDa != null ? (
              <>
                {t("store.otp_check_ok")} — {t("store.otp_check_balance")}: {check.balanceDa} DA ·{" "}
                {t("store.otp_check_estimate")}: ~{check.otpEstimate} · {check.plan}
              </>
            ) : check.ok ? (
              check.message ?? t("store.otp_check_ok")
            ) : (
              <>
                {check.outOfCredits ? t("store.otp_check_no_credits") : null}
                {check.message ?? t("store.otp_check_failed")}
              </>
            )}
          </div>
        )}
      </div>
    </SettingsSection>
  );
}
