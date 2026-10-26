import { useEffect, useState } from "react";
import { Eye, EyeOff, Mail, Send } from "lucide-react";
import { Button, Input, Select, SwitchField } from "@/components/ui";
import { useT } from "@/i18n/react";
import { getSendiliApp, saveSendiliApp, testSendiliKey } from "@/features/apps/sendili/api";
import type { SendiliKeyCheck } from "@/features/apps/sendili/types";
import type { AppBodyProps } from "@/features/apps/types";
import { FieldRow, SettingsSection } from "@/features/settings/components/SettingsSection";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The Sendili App: the store's emails, sent through the merchant's Sendili account. */
export default function SendiliApp({ canManage, onSaved }: AppBodyProps) {
  const t = useT("apps");
  const [apiKey, setApiKey] = useState("");
  const [apiKeyMasked, setApiKeyMasked] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [fromEmail, setFromEmail] = useState("");
  const [fromName, setFromName] = useState("");
  const [domains, setDomains] = useState<string[]>([]);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [check, setCheck] = useState<SendiliKeyCheck | null>(null);

  const localPart = fromEmail.split("@")[0] ?? "";
  const currentDomain = fromEmail.includes("@") ? (fromEmail.split("@").pop() as string) : "";

  function applyDomain(domain: string) {
    const prefix = localPart.trim() || "noreply";
    setFromEmail(`${prefix}@${domain}`);
  }

  function setLocalPart(part: string) {
    setFromEmail(currentDomain ? `${part}@${currentDomain}` : part);
  }

  useEffect(() => {
    let alive = true;
    getSendiliApp().then((data) => {
      if (!alive || !data) return;
      setEnabled(data.enabled);
      setFromEmail(data.fromEmail);
      setFromName(data.fromName ?? "");
      setApiKeyMasked(data.apiKeyMasked);
      setLastSaved(data.updatedAt);
      // Silent: load the verified domains with the STORED key so the picker
      // is ready on arrival (cheap account read, one call per page visit).
      testSendiliKey()
        .then((result) => {
          if (!alive || !result.ok || !result.domains?.length) return;
          setDomains(result.domains);
        })
        .catch(() => {});
    });
    return () => {
      alive = false;
    };
  }, []);

  /**
   * Pasting a key and leaving the field pre-validates it against Sendili and
   * loads the domains it may send from — BEFORE any save, so the merchant
   * picks a verified domain first and completes the from address with it.
   */
  async function handleKeyBlur() {
    const submitted = apiKey.trim();
    if (!submitted.startsWith("sk_") || submitted.length < 20) return;
    try {
      const result = await testSendiliKey(submitted);
      setCheck(result);
      if (result.ok && result.domains?.length) {
        setDomains(result.domains);
        if (!fromEmail.includes("@")) applyDomain(result.domains[0]);
      }
    } catch {
      // Manual Test connection reports failures; keep the blur silent.
    }
  }

  async function handleSave() {
    if (!EMAIL_PATTERN.test(fromEmail.trim())) {
      throw new Error(`${t("sendili.from_label")}: ${t("page.field_required")}`);
    }
    if (enabled && !apiKey.trim() && !apiKeyMasked) {
      throw new Error(`${t("sendili.key_label")}: ${t("page.field_required")}`);
    }
    const result = await saveSendiliApp({
      apiKey: apiKey.trim() || undefined,
      fromEmail: fromEmail.trim(),
      fromName: fromName.trim() || null,
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
      const result = await testSendiliKey(apiKey.trim() || undefined);
      setCheck(result);
      if (result.ok && result.domains?.length) {
        setDomains(result.domains);
        if (!fromEmail.includes("@")) applyDomain(result.domains[0]);
      }
    } catch {
      setCheck({ ok: false, message: t("sendili.check_failed") });
    } finally {
      setChecking(false);
    }
  }

  // A free-typed domain that is not in the verified list stays selectable
  // (it was deliberately entered); otherwise the picker covers it.
  const domainOptions =
    currentDomain && !domains.includes(currentDomain)
      ? [currentDomain, ...domains]
      : domains;

  return (
    <SettingsSection
      savedAt={lastSaved}
      icon={Mail}
      title={t("sendili.title")}
      subtitle={t("sendili.subtitle")}
      onSave={handleSave}
      readOnly={!canManage}
    >
      <SwitchField
        label={t("sendili.enabled_label")}
        help={t("sendili.enabled_hint")}
        checked={enabled}
        onChange={setEnabled}
      />

      <FieldRow label={t("sendili.key_label")} help={t("sendili.key_hint")}>
        <div className="relative">
          <Input
            type={showKey ? "text" : "password"}
            dir="ltr"
            value={apiKey}
            onChange={(event) => setApiKey(event.currentTarget.value)}
            onBlur={() => void handleKeyBlur()}
            placeholder={apiKeyMasked ?? t("sendili.key_placeholder")}
            className="pe-10"
            autoComplete="off"
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

      <FieldRow
        label={t("sendili.from_label")}
        help={
          <>
            <span className="block">{t("sendili.from_hint")}</span>
            <span className="mt-1.5 block">{t("sendili.domains_hint")}</span>
          </>
        }
      >
        {domainOptions.length > 0 ? (
          <div className="flex items-center gap-2">
            <Input
              dir="ltr"
              value={localPart}
              onChange={(event) => setLocalPart(event.currentTarget.value)}
              placeholder={t("sendili.local_placeholder")}
              className="flex-1"
              autoComplete="off"
              spellCheck={false}
            />
            <span className="shrink-0 text-sm font-semibold text-muted-foreground" aria-hidden="true">
              @
            </span>
            <Select
              value={currentDomain || domainOptions[0]}
              onChange={(event) => applyDomain(event.currentTarget.value)}
              className="w-auto min-w-44"
            >
              {domainOptions.map((domain) => (
                <option key={domain} value={domain}>
                  {domain}
                </option>
              ))}
            </Select>
          </div>
        ) : (
          <Input
            type="email"
            dir="ltr"
            value={fromEmail}
            onChange={(event) => setFromEmail(event.currentTarget.value)}
            placeholder={t("sendili.from_placeholder")}
          />
        )}
      </FieldRow>

      <FieldRow label={t("sendili.from_name_label")}>
        <Input
          value={fromName}
          onChange={(event) => setFromName(event.currentTarget.value)}
          placeholder={t("sendili.from_name_placeholder")}
        />
      </FieldRow>

      <div className="space-y-2 border-t border-border pt-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Send size={15} aria-hidden="true" />
            {t("sendili.check_title")}
          </div>
          <Button type="button" variant="secondary" size="sm" onClick={() => void handleTest()} disabled={checking || (!apiKey.trim() && !apiKeyMasked)}>
            {checking ? t("sendili.checking") : t("sendili.check_btn")}
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
            {check.ok ? (
              check.domains?.length ? (
                <>
                  {t("sendili.check_ok")} — {t("sendili.domains_label")}:{" "}
                  <span dir="ltr">{check.domains.join(", ")}</span>
                </>
              ) : (
                t("sendili.check_ok")
              )
            ) : (
              <>
                {check.outOfCredits ? t("sendili.check_no_credits") : null}
                {check.message ?? t("sendili.check_failed")}
              </>
            )}
          </div>
        )}
      </div>
    </SettingsSection>
  );
}
