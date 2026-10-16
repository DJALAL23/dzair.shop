import { useMemo, useState } from "react";
import { ExternalLink, Radio, Trash2 } from "lucide-react";
import { Button, Field, Input } from "@/components/ui";
import { useT } from "@/i18n/react";
import { cn } from "@/lib/utils";
import { notify } from "@/lib/notify";
import {
  registerZrWebhook,
  unregisterZrWebhook,
  updateDeliveryCompany,
} from "@/features/delivery/api";
import { statusMapDraft, statusMapFrom, type ZrMeaning } from "@/features/delivery/model";
import type { DeliveryCompany } from "@/features/delivery/types";
import { ZR_MAPPABLE_MEANINGS } from "../../../../../cod-shared/carriers/providers";

/**
 * ZR Express webhook management — one-click register/unregister (the
 * signing secret is fetched and stored server-side) — and this tenant's
 * own state names. ZR states are free text per tenant: a name the standard
 * workflow does not know is mapped here to what it means for the delivery,
 * saved in the company's settings; a name nobody mapped is recorded as an
 * unknown status in the inbox, never guessed.
 */
export function CompanyZrWebhookCard({
  company,
  canManage,
  onSaved,
}: {
  company: DeliveryCompany | null;
  canManage: boolean;
  onSaved: () => void | Promise<void>;
}) {
  const t = useT("delivery_companies");
  const registered = !!company?.webhookEndpointId;
  const [busy, setBusy] = useState<"register" | "unregister" | "mapping" | null>(null);
  const saved = useMemo(() => statusMapDraft(company), [company?.providerConfig]);
  const [draft, setDraft] = useState<Record<ZrMeaning, string>>(saved);
  const [lastSaved, setLastSaved] = useState(saved);
  if (saved !== lastSaved) {
    setLastSaved(saved);
    setDraft(saved);
  }
  const hasDraftChanges = JSON.stringify(statusMapFrom(draft)) !== JSON.stringify(statusMapFrom(saved));

  async function register() {
    if (!company) return;
    setBusy("register");
    try {
      await registerZrWebhook(company.id);
      notify.flashSuccess(t("zr_webhook_registered"));
      await onSaved();
    } catch (cause) {
      notify.error(
        cause instanceof Error ? cause.message : t("zr_webhook_register_failed"),
      );
    } finally {
      setBusy(null);
    }
  }

  async function unregister() {
    if (!company) return;
    setBusy("unregister");
    try {
      await unregisterZrWebhook(company.id);
      notify.flashSuccess(t("zr_webhook_unregistered"));
      await onSaved();
    } catch (cause) {
      notify.error(
        cause instanceof Error ? cause.message : t("zr_webhook_unregister_failed"),
      );
    } finally {
      setBusy(null);
    }
  }

  async function saveMapping() {
    if (!company) return;
    setBusy("mapping");
    try {
      await updateDeliveryCompany(company.id, { providerConfig: { statusMap: statusMapFrom(draft) } });
      notify.flashSuccess(t("zr_mapping_saved"));
      await onSaved();
    } catch (cause) {
      notify.error(cause instanceof Error ? cause.message : t("zr_mapping_save_failed"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded-xl bg-card p-5 shadow-card">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-[11px] font-semibold text-muted-foreground/60">
          <Radio size={14} className="text-primary/50" aria-hidden="true" />
          {t("zr_webhook_title")}
        </h2>
        <span
          className={cn(
            "rounded-full px-2.5 py-1 text-[11px] font-semibold",
            registered
              ? "bg-[var(--tone-success-bg)] text-[var(--tone-success-text)]"
              : "bg-muted text-muted-foreground",
          )}
        >
          {registered ? t("zr_webhook_status_registered") : t("zr_webhook_status_off")}
        </span>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 p-3">
          <p className="text-xs font-medium leading-relaxed text-muted-foreground">
            {registered ? t("zr_webhook_registered_hint") : t("zr_webhook_off_hint")}
          </p>
          {canManage && (
            <div className="flex shrink-0 gap-2">
              {registered ? (
                <Button
                  type="button"
                  variant="dangerOutline"
                  onClick={() => void unregister()}
                  disabled={busy !== null}
                >
                  <Trash2 size={13} />
                  {busy === "unregister" ? t("saving") : t("zr_webhook_unregister")}
                </Button>
              ) : (
                <Button
                  type="button"
                  onClick={() => void register()}
                  disabled={busy !== null || !company?.isConnected}
                >
                  {busy === "register" ? t("saving") : t("zr_webhook_register")}
                </Button>
              )}
            </div>
          )}
        </div>

        <div className="space-y-2">
          <p className="text-[11px] font-semibold text-muted-foreground/60">
            {t("zr_mapping_title")}
          </p>
          <p className="text-xs font-medium leading-relaxed text-muted-foreground/70">
            {t("zr_mapping_hint")}
          </p>
        </div>

        <div className="space-y-3">
          {ZR_MAPPABLE_MEANINGS.map((meaning) => (
            <Field key={meaning} label={t(`zr_meaning.${meaning}`)}>
              <Input
                value={draft[meaning]}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setDraft((prev) => ({ ...prev, [meaning]: value }));
                }}
                placeholder={t("zr_mapping_placeholder")}
                disabled={!canManage}
              />
            </Field>
          ))}
          <Button
            type="button"
            variant="secondary"
            className="w-full"
            onClick={() => void saveMapping()}
            disabled={!canManage || !company || busy !== null || !hasDraftChanges}
          >
            {busy === "mapping" ? t("saving") : t("zr_mapping_save")}
          </Button>
        </div>

        <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground/70">
          <ExternalLink size={12} aria-hidden="true" className="shrink-0" />
          {t("webhook_events_hint")}
        </p>
      </div>
    </div>
  );
}
