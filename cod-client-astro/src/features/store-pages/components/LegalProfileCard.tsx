import { useState } from "react";
import { canScope, useIdentity } from "@/features/auth/components/RequireAuth";
import { useT } from "@/i18n/react";
import { notify } from "@/lib/notify";
import { SCOPES } from "../../../../../cod-shared/rbac/scopes";
import { storePagesErrorMessage } from "@/features/store-pages/model";
import { saveStoreLegalProfile } from "@/features/store-pages/api";
import type { StoreLegalProfile } from "@/features/store-pages/types";
import { Alert, Button, Card, Field, InfoTip, Input, StickyFormActions } from "@/components/ui";

interface LegalProfileCardProps {
  profile: StoreLegalProfile | null;
  onSaved: (profile: StoreLegalProfile) => void;
}

function textField(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function dayField(value: string, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : fallback;
}

export function LegalProfileCard({ profile, onSaved }: LegalProfileCardProps) {
  const t = useT("store-pages");
  const identity = useIdentity();
  const canManage = canScope(identity, SCOPES.STORE_PAGES_MANAGE);

  const [legalName, setLegalName] = useState(profile?.legalName ?? "");
  const [rcNumber, setRcNumber] = useState(profile?.rcNumber ?? "");
  const [nif, setNif] = useState(profile?.nif ?? "");
  const [address, setAddress] = useState(profile?.address ?? "");
  const [contactEmail, setContactEmail] = useState(profile?.contactEmail ?? "");
  const [contactPhone, setContactPhone] = useState(profile?.contactPhone ?? "");
  const [returnWindowDays, setReturnWindowDays] = useState(String(profile?.returnWindowDays ?? 0));
  const [deliveryMinDays, setDeliveryMinDays] = useState(String(profile?.deliveryMinDays ?? 2));
  const [deliveryMaxDays, setDeliveryMaxDays] = useState(String(profile?.deliveryMaxDays ?? 7));
  const [busy, setBusy] = useState(false);

  const isComplete = Boolean(contactEmail.trim() || contactPhone.trim());

  async function handleSave() {
    setBusy(true);
    try {
      const saved = await saveStoreLegalProfile({
        legalName: textField(legalName),
        rcNumber: textField(rcNumber),
        nif: textField(nif),
        address: textField(address),
        contactEmail: textField(contactEmail),
        contactPhone: textField(contactPhone),
        returnWindowDays: dayField(returnWindowDays, 0),
        deliveryMinDays: dayField(deliveryMinDays, 2),
        deliveryMaxDays: dayField(deliveryMaxDays, 7),
      });
      onSaved(saved);
      notify.success(t("legal_profile.saved_toast"));
    } catch (cause) {
      notify.error(storePagesErrorMessage(cause, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {!isComplete && <Alert tone="warning">{t("legal_profile.incomplete_banner")}</Alert>}

      {/* 3 Structured Sections */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Section 1: Company & Legal Identity */}
        <Card
          title={t("legal_profile.company_section_title")}
          help={t("legal_profile.company_section_subtitle")}
          className="md:col-span-2"
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={t("legal_profile.legal_name_label")}>
              <Input
                value={legalName}
                onChange={(e) => setLegalName(e.currentTarget.value)}
                disabled={busy || !canManage}
                placeholder="e.g. SARL CodFlow Algérie"
              />
            </Field>

            <Field label={t("legal_profile.address_label")}>
              <Input
                value={address}
                onChange={(e) => setAddress(e.currentTarget.value)}
                disabled={busy || !canManage}
                placeholder="e.g. 12 Rue Didouche Mourad, Alger"
              />
            </Field>

            <Field label={t("legal_profile.rc_number_label")}>
              <Input
                value={rcNumber}
                onChange={(e) => setRcNumber(e.currentTarget.value)}
                dir="ltr"
                disabled={busy || !canManage}
                placeholder="e.g. 16/00-1234567B22"
                className="font-mono text-xs"
              />
            </Field>

            <Field label={t("legal_profile.nif_label")}>
              <Input
                value={nif}
                onChange={(e) => setNif(e.currentTarget.value)}
                dir="ltr"
                disabled={busy || !canManage}
                placeholder="e.g. 002216012345678"
                className="font-mono text-xs"
              />
            </Field>
          </div>
        </Card>

        {/* Section 2: Customer Contact Channels */}
        <Card
          title={t("legal_profile.contact_section_title")}
          help={t("legal_profile.contact_section_subtitle")}
        >
          <div className="space-y-4">
            <Field label={t("legal_profile.contact_email_label")}>
              <div className="relative">
                <Input
                  type="email"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.currentTarget.value)}
                  dir="ltr"
                  disabled={busy || !canManage}
                  placeholder="contact@yourstore.dz"
                />
              </div>
            </Field>

            <Field label={t("legal_profile.contact_phone_label")}>
              <div className="relative">
                <Input
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.currentTarget.value)}
                  dir="ltr"
                  disabled={busy || !canManage}
                  placeholder="+213 550 12 34 56"
                />
              </div>
            </Field>
          </div>
        </Card>

        {/* Section 3: COD Delivery & Return Settings */}
        <Card
          title={t("legal_profile.cod_section_title")}
          help={t("legal_profile.cod_section_subtitle")}
        >
          <div className="space-y-4">
            <Field
              label={t("legal_profile.return_window_label")}
              help={t("legal_profile.return_window_hint")}
            >
              <Input
                type="number"
                min={0}
                max={90}
                value={returnWindowDays}
                onChange={(e) => setReturnWindowDays(e.currentTarget.value)}
                dir="ltr"
                disabled={busy || !canManage}
                className="font-mono"
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label={t("legal_profile.delivery_min_days_label")}>
                <Input
                  type="number"
                  min={0}
                  max={60}
                  value={deliveryMinDays}
                  onChange={(e) => setDeliveryMinDays(e.currentTarget.value)}
                  dir="ltr"
                  disabled={busy || !canManage}
                  className="font-mono"
                />
              </Field>

              <Field label={t("legal_profile.delivery_max_days_label")}>
                <Input
                  type="number"
                  min={0}
                  max={60}
                  value={deliveryMaxDays}
                  onChange={(e) => setDeliveryMaxDays(e.currentTarget.value)}
                  dir="ltr"
                  disabled={busy || !canManage}
                  className="font-mono"
                />
              </Field>
            </div>
          </div>
        </Card>
      </div>

      {/* Sticky Bottom Actions */}
      {canManage && (
        <StickyFormActions
          info={
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {t("legal_profile.title")}
              <InfoTip>
                <span className="block">{t("legal_profile.subtitle")}</span>
                <span className="mt-1.5 block">{t("legal_profile.apply_hint")}</span>
              </InfoTip>
            </span>
          }
        >
          <Button type="button" onClick={() => void handleSave()} disabled={busy}>
            {t("legal_profile.save_button")}
          </Button>
        </StickyFormActions>
      )}
    </div>
  );
}
