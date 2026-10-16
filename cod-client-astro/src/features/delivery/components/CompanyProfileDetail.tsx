import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, X } from "lucide-react";
import {
  canScope,
  useIdentity,
} from "@/features/auth/components/RequireAuth";
import { useT } from "@/i18n/react";
import { SCOPES } from "../../../../../cod-shared/rbac/scopes";
import {
  listAllDeliveryCompanies,
  syncCarrierGeoNames,
  syncCompanyShipments,
  syncCompanyStopDesks,
  updateDeliveryCompany,
} from "@/features/delivery/api";
import type { DeliveryCompany } from "@/features/delivery/types";
import { getProviderConfig } from "@/features/delivery/types";
import { Alert, Badge, LinkButton, PageHeader } from "@/components/ui";
import { ExternalLink, Settings } from "lucide-react";
import { CompanySettingsSection } from "@/features/delivery/components/CompanySettingsSection";
import { CompanyWebhookEventsCard } from "@/features/delivery/components/CompanyWebhookEventsCard";
import { isCompanyConnected } from "@/features/delivery/model";
import { notify } from "@/lib/notify";

function Loading() {
  return (
    <div role="status" aria-busy="true" className="space-y-4">
      <div className="h-20 shimmer rounded-xl" />
      <div className="h-32 shimmer rounded-xl" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="h-24 shimmer rounded-xl lg:col-span-2" />
        <div className="h-24 shimmer rounded-xl" />
      </div>
    </div>
  );
}

function Notice({
  message,
  tone,
  onDismiss,
}: {
  message: string;
  tone: "success" | "error";
  onDismiss: () => void;
}) {
  const common = useT("common");
  return (
    <Alert
      role={tone === "error" ? "alert" : "status"}
      tone={tone === "error" ? "critical" : "info"}
    >
      {tone === "error" ? (
        <AlertCircle size={18} className="shrink-0" />
      ) : (
        <CheckCircle2 size={18} className="shrink-0" />
      )}
      <span className="flex-1">{message}</span>
      <button type="button" onClick={onDismiss} aria-label={common("cancel")}>
        <X size={16} />
      </button>
    </Alert>
  );
}

export function CompanyProfileDetail({ providerCode }: { providerCode: string }) {
  const t = useT("delivery_companies");
  const auth = useT("auth");
  const common = useT("common");
  const identity = useIdentity();
  const [company, setCompany] = useState<DeliveryCompany | null | undefined>(undefined);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [notice, setNotice] = useState<{ message: string; tone: "success" | "error" } | null>(null);
  const [syncingDesks, setSyncingDesks] = useState(false);
  const [syncingGeo, setSyncingGeo] = useState(false);
  const [syncingShipments, setSyncingShipments] = useState(false);
  const [autoValidate, setAutoValidate] = useState(true);
  const [savingAutoValidate, setSavingAutoValidate] = useState(false);

  const config = getProviderConfig(providerCode);
  const canManage = canScope(identity, SCOPES.DELIVERY_MANAGE);

  async function load() {
    setLoadError(null);
    try {
      const companies = await listAllDeliveryCompanies();
      const found = companies.find((item) => item.code === providerCode);
      setCompany(found ?? null);
    } catch (cause) {
      setLoadError(cause);
    }
  }

  useEffect(() => {
    if (canScope(identity, SCOPES.DELIVERY_READ)) void load();
  }, [identity?.role, identity?.scopes.join(","), providerCode]);

  useEffect(() => {
    if (company) setAutoValidate(company.autoValidate);
  }, [company?.id, company?.autoValidate]);

  async function handleSyncDesks() {
    if (!company) return;
    setNotice(null);
    setSyncingDesks(true);
    try {
      const result = await syncCompanyStopDesks(company.id);
      const detail =
        result.removed > 0
          ? `${result.total} ${t("desks")} · ${result.removed} ${t("removed")}`
          : `${result.total} ${t("desks")}`;
      const message = `${t("sync_desks_success")} — ${detail}`;
      setNotice({ message, tone: "success" });
      notify.success(message);
      await load();
    } catch {
      const message = t("error_saving");
      setNotice({ message, tone: "error" });
      notify.error(message);
    } finally {
      setSyncingDesks(false);
    }
  }

  async function handleSyncGeo() {
    if (!company) return;
    setNotice(null);
    setSyncingGeo(true);
    try {
      const result = await syncCarrierGeoNames(company.id);
      const detail = `${result.wilayasMatched} ${t("geo_wilayas")} · ${result.communesMatched} ${t("geo_communes")}`;
      const message =
        result.communesUnmapped > 0
          ? `${t("sync_geo_success")} — ${detail} · ${result.communesUnmapped} ${t("geo_unmapped")}`
          : `${t("sync_geo_success")} — ${detail}`;
      setNotice({ message, tone: result.communesUnmapped > 0 ? "success" : "success" });
      notify.success(message);
    } catch {
      const message = t("error_saving");
      setNotice({ message, tone: "error" });
      notify.error(message);
    } finally {
      setSyncingGeo(false);
    }
  }

  async function handleSyncShipments() {
    if (!company) return;
    setNotice(null);
    setSyncingShipments(true);
    try {
      const result = await syncCompanyShipments(company.id);
      const message = result.synced === 0 ? t("sync_shipments_none") : t("sync_shipments_done", { count: result.synced, recorded: result.recorded });
      setNotice({ message: result.moreRemain ? `${message} ${t("sync_shipments_more")}` : message, tone: "success" });
      notify.success(message);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : t("error_saving");
      setNotice({ message, tone: "error" });
      notify.error(message);
    } finally {
      setSyncingShipments(false);
    }
  }

  async function handleToggleAutoValidate() {
    if (!company) return;
    setNotice(null);
    const newValue = !autoValidate;
    const previous = autoValidate;
    setAutoValidate(newValue);
    setSavingAutoValidate(true);
    try {
      await updateDeliveryCompany(company.id, { autoValidate: newValue });
      const message = newValue
        ? t("auto_validate_enabled")
        : t("auto_validate_disabled");
      setNotice({ message, tone: "success" });
      notify.success(message);
    } catch {
      setAutoValidate(previous);
      const message = t("error_saving");
      setNotice({ message, tone: "error" });
      notify.error(message);
    } finally {
      setSavingAutoValidate(false);
    }
  }

  if (!canScope(identity, SCOPES.DELIVERY_READ)) {
    return (
      <Alert role="alert" tone="critical">
        {auth("no_access")}
      </Alert>
    );
  }

  if (!config) {
    return (
      <Alert role="alert" tone="critical">
        {t("error_not_found")}
      </Alert>
    );
  }

  if (loadError) {
    return (
      <Alert role="alert" tone="critical">
        <div className="flex-1">
          <p className="font-semibold">{t("error_load")}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-3 text-xs font-semibold underline underline-offset-4"
          >
            {common("retry")}
          </button>
        </div>
      </Alert>
    );
  }

  if (company === undefined) return <Loading />;

  return (
    <div className="space-y-5">
      {notice && (
        <Notice
          message={notice.message}
          tone={notice.tone}
          onDismiss={() => setNotice(null)}
        />
      )}

      <PageHeader
        title={config.name}
        backHref="/delivery/companies"
        backLabel={t("page_title")}
        media={
          <span
            className={`grid size-12 place-items-center rounded-lg text-lg font-semibold ${isCompanyConnected(company) ? "bg-foreground text-background" : "bg-muted text-muted-foreground"}`}
          >
            {config.name.charAt(0)}
          </span>
        }
        badges={
          isCompanyConnected(company) ? <Badge tone="success" dot>{t("connected")}</Badge> : <Badge tone="neutral">{t("not_connected")}</Badge>
        }
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
            <a href={config.website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-foreground hover:underline">
              {new URL(config.website).hostname}
              <ExternalLink size={11} aria-hidden="true" />
            </a>
            {config.supportsHomeDelivery && <span>{t("capability_home")}</span>}
            {config.supportsStopDesk && <span>{t("capability_desk")}</span>}
            <span>{t(config.updates === "webhook" ? "updates_live" : "updates_checked")}</span>
          </span>
        }
        actions={
          canManage ? (
            <LinkButton href={`/delivery/companies/${providerCode}/credentials`} variant={isCompanyConnected(company) ? "secondary" : "primary"}>
              <Settings size={15} aria-hidden="true" />
              {isCompanyConnected(company) ? t("configure") : t("connect")}
            </LinkButton>
          ) : undefined
        }
      />

      <CompanySettingsSection
        config={config}
        company={company}
        providerCode={providerCode}
        canManage={canManage}
        autoValidate={autoValidate}
        savingAutoValidate={savingAutoValidate}
        onToggleAutoValidate={() => void handleToggleAutoValidate()}
        syncingDesks={syncingDesks}
        onSyncDesks={() => void handleSyncDesks()}
        syncingGeo={syncingGeo}
        onSyncGeo={() => void handleSyncGeo()}
        syncingShipments={syncingShipments}
        onSyncShipments={() => void handleSyncShipments()}
      />

      {config.updates === "webhook" && <CompanyWebhookEventsCard company={company} canManage={canManage} />}
    </div>
  );
}
