import { useEffect, useState } from "react";
import { BarChart2, Eye, EyeOff } from "lucide-react";
import { Alert, InfoTip, Input, SwitchField } from "@/components/ui";
import { useT } from "@/i18n/react";
import {
  ConversionEventPicker,
  type ConversionEvent,
} from "@/components/tracking/ConversionEventPicker";
import { getPixelConfig, savePixelConfig } from "@/features/settings/api";
import { FieldRow, SettingsSection } from "@/features/settings/components/SettingsSection";

export function TrackingSettings() {
  const t = useT("settings");
  const [pixelId, setPixelId] = useState("");
  const [adAccountName, setAdAccountName] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [accessTokenMasked, setAccessTokenMasked] = useState<string | null>(null);
  const [testEventCode, setTestEventCode] = useState("");
  const [testMode, setTestMode] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [conversionEvent, setConversionEvent] = useState<ConversionEvent | null>(null);
  const [perPageTracking, setPerPageTracking] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [lastSaved, setLastSaved] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getPixelConfig().then((data) => {
      if (!alive || !data) return;
      setPixelId(data.pixelId);
      setAdAccountName(data.adAccountName ?? "");
      setAccessTokenMasked(data.accessTokenMasked);
      setTestEventCode(data.testEventCode ?? "");
      setConversionEvent(data.conversionEvent);
      setTestMode(data.testMode);
      setEnabled(data.enabled);
      setPerPageTracking(data.perPageTrackingEnabled);
      setLastSaved(data.updatedAt);
    });
    return () => {
      alive = false;
    };
  }, []);

  async function handleSave() {
    if (enabled && !pixelId.trim()) {
      throw new Error(
        `${t("store.tracking_pixel_id_label")} ${t("store.field_required")}`,
      );
    }
    if (!conversionEvent) {
      throw new Error(
        `${t("store.tracking_event_label")} ${t("store.field_required")}`,
      );
    }
    if (enabled && !accessToken.trim() && !accessTokenMasked) {
      throw new Error(
        `${t("store.tracking_token_label")} ${t("store.field_required")}`,
      );
    }
    if (enabled && testMode && !testEventCode.trim()) {
      throw new Error(
        `${t("store.tracking_test_code_label")} ${t("store.field_required")}`,
      );
    }
    const result = await savePixelConfig({
      pixelId: pixelId.trim(),
      adAccountName: adAccountName.trim() || null,
      accessToken: accessToken.trim() || undefined,
      testEventCode: testEventCode.trim() || null,
      conversionEvent,
      testMode,
      enabled,
      perPageTrackingEnabled: perPageTracking,
    });
    setAccessTokenMasked(result.accessTokenMasked);
    setAccessToken("");
    setLastSaved(result.updatedAt);
  }

  return (
    <SettingsSection
      savedAt={lastSaved}
      icon={BarChart2}
      title={t("store.tracking_title")}
      subtitle={t("store.tracking_subtitle")}
      onSave={handleSave}
    >
      <SwitchField
        label={t("store.tracking_enabled_label")}
        help={t("store.tracking_enabled_hint")}
        checked={enabled}
        onChange={setEnabled}
      />

      <FieldRow label={t("store.tracking_ad_account_label")} help={t("store.tracking_ad_account_hint")}>
        <Input
          dir="ltr"
          value={adAccountName}
          onChange={(event) => setAdAccountName(event.currentTarget.value)}
          placeholder={t("store.tracking_ad_account_placeholder")}
        />
      </FieldRow>

      <FieldRow label={t("store.tracking_pixel_id_label")} help={t("store.tracking_pixel_id_hint")}>
        <Input
          dir="ltr"
          value={pixelId}
          onChange={(event) => setPixelId(event.currentTarget.value)}
          placeholder={t("store.tracking_pixel_id_placeholder")}
        />
      </FieldRow>

      <FieldRow label={t("store.tracking_token_label")} help={t("store.tracking_token_hint")}>
        <div className="relative">
          <Input
            type={showToken ? "text" : "password"}
            dir="ltr"
            value={accessToken}
            onChange={(event) => setAccessToken(event.currentTarget.value)}
            placeholder={accessTokenMasked ?? t("store.tracking_token_placeholder")}
            className="pe-10"
          />
          <button
            type="button"
            onClick={() => setShowToken((current) => !current)}
            tabIndex={-1}
            aria-label={showToken ? t("store.api_key_hide") : t("store.api_key_reveal")}
            className="absolute end-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
          >
            {showToken ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </div>
      </FieldRow>

      <div className="space-y-2">
        <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
          <span>{t("store.tracking_event_label")}</span>
          <InfoTip>{t("store.tracking_event_description")}</InfoTip>
        </span>

        <ConversionEventPicker
          value={conversionEvent}
          onChange={setConversionEvent}
        />
      </div>

      {/* Per-landing-page pixels. Off is the default and the rollback: while
          it is off, every landing page reports to the pixel above no matter
          what is saved against it. */}
      <SwitchField
        label={t("store.tracking_per_page_label")}
        help={
          <>
            <span className="block">{t("store.tracking_per_page_hint")}</span>
            <span className="mt-1.5 block">{t("store.tracking_per_page_next_step")}</span>
          </>
        }
        checked={perPageTracking}
        onChange={setPerPageTracking}
      />

      <SwitchField
        label={t("store.tracking_test_mode_label")}
        help={t("store.tracking_test_mode_hint")}
        checked={testMode}
        onChange={setTestMode}
      />

      {testMode && (
        <Alert tone="warning">{t("store.tracking_test_mode_warning")}</Alert>
      )}

      {testMode && (
        <FieldRow label={t("store.tracking_test_code_label")} help={t("store.tracking_test_code_hint")}>
          <Input
            dir="ltr"
            value={testEventCode}
            onChange={(event) => setTestEventCode(event.currentTarget.value)}
            placeholder={t("store.tracking_test_code_placeholder")}
          />
        </FieldRow>
      )}
    </SettingsSection>
  );
}
