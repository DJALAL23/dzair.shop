import { useEffect, useState } from "react";
import { Eye, EyeOff, MessageCircle, ShieldCheck } from "lucide-react";
import { Button, Input, Select, SwitchField } from "@/components/ui";
import { useT } from "@/i18n/react";
import { getDZVerifyApp, saveDZVerifyApp, testDZVerifyKey } from "@/features/apps/dzverify/api";
import type { DZVerifyKeyCheck } from "@/features/apps/dzverify/types";
import type { AppBodyProps } from "@/features/apps/types";
import { FieldRow, SettingsSection } from "@/features/settings/components/SettingsSection";

type Language = "ar" | "fr" | "en";

/** The DZVerify App: its phone check at checkout. */
export default function DZVerifyApp({ canManage, onSaved }: AppBodyProps) {
  const t = useT("apps");
  const [apiKey, setApiKey] = useState("");
  const [language, setLanguage] = useState<Language>("ar");
  const [enabled, setEnabled] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [apiKeyMasked, setApiKeyMasked] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [check, setCheck] = useState<DZVerifyKeyCheck | null>(null);

  useEffect(() => {
    let alive = true;
    getDZVerifyApp().then((data) => {
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
      throw new Error(`${t("dzverify.key_label")} ${t("page.field_required")}`);
    }
    const result = await saveDZVerifyApp({
      apiKey: apiKey.trim() || undefined,
      language,
      enabled,
    });
    setApiKeyMasked(result.apiKeyMasked);
    setLastSaved(result.updatedAt);
    setApiKey("");
    onSaved();
  }

  async function handleTest() {
    setChecking(true);
    setCheck(null);
    try {
      setCheck(await testDZVerifyKey(apiKey.trim() || undefined));
    } catch {
      setCheck({ ok: false, message: t("dzverify.check_failed") });
    } finally {
      setChecking(false);
    }
  }

  return (
    <SettingsSection
      savedAt={lastSaved}
      icon={ShieldCheck}
      title={t("dzverify.title")}
      subtitle={t("dzverify.subtitle")}
      onSave={handleSave}
      readOnly={!canManage}
    >
      <SwitchField
        label={t("dzverify.enabled_label")}
        help={t("dzverify.enabled_hint")}
        checked={enabled}
        onChange={setEnabled}
      />

      <FieldRow label={t("dzverify.key_label")} help={t("dzverify.key_hint")}>
        <div className="relative">
          <Input
            type={showKey ? "text" : "password"}
            dir="ltr"
            value={apiKey}
            onChange={(event) => setApiKey(event.currentTarget.value)}
            placeholder={apiKeyMasked ?? t("dzverify.key_placeholder")}
            className="pe-10"
          />
          <button
            type="button"
            onClick={() => setShowKey((current) => !current)}
            tabIndex={-1}
            aria-label={showKey ? t("secret.hide") : t("secret.reveal")}
            className="absolute end-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
          >
            {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </div>
      </FieldRow>

      <FieldRow label={t("dzverify.language_label")} help={t("dzverify.language_hint")}>
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
            {t("dzverify.check_title")}
          </div>
          <Button type="button" variant="secondary" size="sm" onClick={() => void handleTest()} disabled={checking || (!apiKey.trim() && !apiKeyMasked)}>
            {checking ? t("dzverify.checking") : t("dzverify.check_btn")}
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
                {t("dzverify.check_ok")} — {t("dzverify.check_balance")}: {check.balanceDa} DA ·{" "}
                {t("dzverify.check_estimate")}: ~{check.otpEstimate} · {check.plan}
              </>
            ) : check.ok ? (
              check.message ?? t("dzverify.check_ok")
            ) : (
              <>
                {check.outOfCredits ? t("dzverify.check_no_credits") : null}
                {check.message ?? t("dzverify.check_failed")}
              </>
            )}
          </div>
        )}
      </div>
    </SettingsSection>
  );
}
