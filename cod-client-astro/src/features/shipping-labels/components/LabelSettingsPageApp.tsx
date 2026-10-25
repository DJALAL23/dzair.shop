import { useEffect, useState } from "react";
import { Info } from "lucide-react";
import { RequireAuth, canScope, useIdentity } from "@/features/auth/components/RequireAuth";
import { DashboardPage } from "@/components/layout/page";
import { Alert, Button, Card, Field, Input, PageHeader, Select, SwitchField } from "@/components/ui";
import { useT } from "@/i18n/react";
import { notify } from "@/lib/notify";
import { SCOPES } from "../../../../../cod-shared/rbac/scopes";
import { LABEL_LIMITS, type OpenParcelPolicy, type ShippingLabelConfig } from "../../../../../cod-shared/shipping-label/config";
import { getLabelSettings, saveLabelSettings } from "@/features/shipping-labels/api";
import { sampleParcel } from "@/features/shipping-labels/model";
import type { LabelSettings } from "@/features/shipping-labels/types";
import { ShippingLabel } from "@/features/shipping-labels/components/ShippingLabel";

/**
 * How the store's labels for its own drivers look: the language of the
 * label's words, what it shows, the sender's phone and a line of the
 * merchant's own — with the label itself beside the form, at its real size,
 * drawn by the same component that prints it.
 */
function Gated() {
  const t = useT("delivery");
  const identity = useIdentity();
  const canManage = canScope(identity, SCOPES.DELIVERY_MANAGE);
  const [settings, setSettings] = useState<LabelSettings | null>(null);
  const [draft, setDraft] = useState<ShippingLabelConfig | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getLabelSettings()
      .then((loaded) => {
        setSettings(loaded);
        setDraft(loaded.config);
      })
      .catch((cause) => setLoadError(cause instanceof Error ? cause.message : t("labels.settings.load_error")));
  }, []);

  if (loadError) {
    return (
      <Alert role="alert" tone="critical">
        {loadError}
      </Alert>
    );
  }
  if (!settings || !draft) return <div role="status" aria-busy="true" className="h-96 shimmer rounded-xl" />;

  const set = <K extends keyof ShippingLabelConfig>(key: K, value: ShippingLabelConfig[K]) => setDraft((current) => (current ? { ...current, [key]: value } : current));
  const legalPhone = settings.legalPhone;
  const preview = { config: draft, currency: settings.currency, sender: { ...settings.sender, phone: draft.senderPhone?.trim() || legalPhone } };
  const changed = JSON.stringify(draft) !== JSON.stringify(settings.config);

  async function save() {
    if (!draft) return;
    setSaving(true);
    try {
      const saved = await saveLabelSettings({ ...draft, senderPhone: draft.senderPhone?.trim() || null, footer: draft.footer?.trim() || null });
      setSettings(saved);
      setDraft(saved.config);
      notify.success(t("labels.settings.saved"));
    } catch (cause) {
      notify.error(cause instanceof Error ? cause.message : t("labels.settings.save_error"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_auto]">
      <div className="space-y-4">
        <p className="flex items-start gap-2 rounded-lg bg-muted/50 p-3 text-sm font-medium text-muted-foreground">
          <Info size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          {t("labels.settings.carrier_note")}
        </p>
        <Card title={t("labels.settings.section_label")}>
          <div className="space-y-4">
            <Field label={t("labels.settings.language")} hint={t("labels.settings.size")}>
              <Select value={draft.language} disabled={!canManage} onChange={(event) => set("language", event.currentTarget.value === "ar" ? "ar" : "fr")}>
                <option value="fr">{t("labels.settings.language_fr")}</option>
                <option value="ar">{t("labels.settings.language_ar")}</option>
              </Select>
            </Field>
            <SwitchField
              label={t("labels.settings.show_logo")}
              help={settings.sender.logoUrl ? undefined : t("labels.settings.no_logo")}
              checked={draft.showLogo}
              disabled={!canManage}
              onChange={(checked) => set("showLogo", checked)}
            />
            <Field
              label={t("labels.settings.sender_phone")}
              hint={legalPhone ? t("labels.settings.sender_phone_hint", { phone: legalPhone }) : t("labels.settings.sender_phone_hint_none")}
            >
              <Input
                value={draft.senderPhone ?? ""}
                disabled={!canManage}
                inputMode="tel"
                dir="ltr"
                maxLength={LABEL_LIMITS.PHONE_MAX}
                placeholder={legalPhone ?? "0551 23 45 67"}
                onChange={(event) => set("senderPhone", event.currentTarget.value || null)}
              />
            </Field>
          </div>
        </Card>
        <Card title={t("labels.settings.section_content")}>
          <div className="space-y-4">
            <SwitchField label={t("labels.settings.show_items")} checked={draft.showItems} disabled={!canManage} onChange={(checked) => set("showItems", checked)} />
            <SwitchField label={t("labels.settings.show_notes")} checked={draft.showNotes} disabled={!canManage} onChange={(checked) => set("showNotes", checked)} />
            <Field label={t("labels.settings.open_parcel")}>
              <Select value={draft.openParcel} disabled={!canManage} onChange={(event) => set("openParcel", event.currentTarget.value as OpenParcelPolicy)}>
                <option value="unset">{t("labels.settings.open_unset")}</option>
                <option value="allowed">{t("labels.settings.open_allowed")}</option>
                <option value="forbidden">{t("labels.settings.open_forbidden")}</option>
              </Select>
            </Field>
            <Field label={t("labels.settings.footer")} hint={t("labels.settings.footer_hint", { count: (draft.footer ?? "").length, max: LABEL_LIMITS.FOOTER_MAX })}>
              <Input value={draft.footer ?? ""} disabled={!canManage} dir="auto" maxLength={LABEL_LIMITS.FOOTER_MAX} onChange={(event) => set("footer", event.currentTarget.value || null)} />
            </Field>
          </div>
        </Card>
        {canManage && (
          <div className="flex justify-end">
            <Button type="button" disabled={!changed || saving} onClick={() => void save()}>
              {saving ? t("labels.settings.saving") : t("labels.settings.save")}
            </Button>
          </div>
        )}
      </div>
      <aside className="space-y-2 lg:sticky lg:top-6">
        <p className="text-sm font-semibold text-foreground">{t("labels.settings.preview")}</p>
        <div className="w-fit overflow-hidden rounded-lg border border-border shadow-card" aria-label={t("labels.settings.preview")}>
          <ShippingLabel parcel={sampleParcel(draft.language)} batch={preview} />
        </div>
        <p className="max-w-[100mm] text-xs font-medium text-muted-foreground">{t("labels.settings.preview_hint")}</p>
      </aside>
    </div>
  );
}

export default function LabelSettingsPageApp() {
  const t = useT("delivery");
  return (
    <RequireAuth>
      <DashboardPage>
        <PageHeader title={t("labels.settings.title")} subtitle={t("labels.settings.subtitle")} />
        <Gated />
      </DashboardPage>
    </RequireAuth>
  );
}
