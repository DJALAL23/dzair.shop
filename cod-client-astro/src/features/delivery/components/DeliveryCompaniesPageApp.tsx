import { useEffect, useState } from "react";
import { ChevronRight, SearchX, Truck } from "lucide-react";
import {
  canScope,
  RequireAuth,
  useIdentity,
} from "@/features/auth/components/RequireAuth";
import { DashboardChrome } from "@/components/layout/chrome";
import { useT } from "@/i18n/react";
import { SCOPES } from "../../../../../cod-shared/rbac/scopes";
import { listAllDeliveryCompanies } from "@/features/delivery/api";
import type { DeliveryCompany, ProviderConfig } from "@/features/delivery/types";
import { PROVIDER_CONFIGS } from "@/features/delivery/types";
import { webhookSetup } from "@/features/delivery/model";
import { Alert, Badge, Card, EmptyState, ListToolbar, PageHeader, SearchInput, TableSkeleton, Tabs } from "@/components/ui";

type TabKey = "connected" | "available";

function Loading() {
  return (
    <div role="status" aria-busy="true" className="overflow-hidden rounded-xl shadow-card">
      <TableSkeleton rows={6} columns={3} />
    </div>
  );
}

function CarrierMark({ name, connected }: { name: string; connected: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`grid size-9 shrink-0 place-items-center rounded-lg text-sm font-semibold ${
        connected ? "bg-foreground text-background" : "bg-muted text-muted-foreground"
      }`}
    >
      {name.charAt(0)}
    </span>
  );
}

function Capabilities({ provider, webhookReady }: { provider: ProviderConfig; webhookReady: boolean }) {
  const t = useT("delivery_companies");
  const items = [
    provider.supportsHomeDelivery && t("capability_home"),
    provider.supportsStopDesk && t("capability_desk"),
    t(provider.updates === "webhook" ? "updates_live" : "updates_checked"),
    webhookReady && t("capability_webhook"),
  ].filter(Boolean) as string[];
  return (
    <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
      {items.map((item) => (
        <span key={item}>{item}</span>
      ))}
    </span>
  );
}

function matchesQuery(provider: ProviderConfig, query: string): boolean {
  if (!query) return true;
  const haystack = `${provider.name} ${provider.nameAr} ${provider.code}`.toLowerCase();
  return haystack.includes(query.toLowerCase());
}

function DeliveryCompaniesList() {
  const t = useT("delivery_companies");
  const auth = useT("auth");
  const common = useT("common");
  const identity = useIdentity();
  const [companies, setCompanies] = useState<DeliveryCompany[] | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [search, setSearch] = useState("");
  const [chosenTab, setChosenTab] = useState<TabKey | null>(null);

  async function load() {
    setLoadError(null);
    try {
      setCompanies(await listAllDeliveryCompanies());
    } catch (cause) {
      setLoadError(cause);
    }
  }

  useEffect(() => {
    if (canScope(identity, SCOPES.DELIVERY_READ)) void load();
  }, [identity?.role, identity?.scopes.join(",")]);

  if (!canScope(identity, SCOPES.DELIVERY_READ)) {
    return (
      <Alert role="alert" tone="critical">
        {auth("no_access")}
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

  if (companies === null) return <Loading />;

  const providers = Object.values(PROVIDER_CONFIGS);
  const companyOf = (provider: ProviderConfig) => companies.find((item) => item.code === provider.code) ?? null;
  const connectedAll = providers.filter((provider) => companyOf(provider)?.isConnected);
  const availableAll = providers.filter((provider) => !companyOf(provider)?.isConnected);
  const tab: TabKey = chosenTab ?? (connectedAll.length > 0 ? "connected" : "available");
  const connected = connectedAll.filter((provider) => matchesQuery(provider, search));
  const available = availableAll.filter((provider) => matchesQuery(provider, search));
  const canManage = canScope(identity, SCOPES.DELIVERY_MANAGE);
  const searching = search.trim() !== "";

  return (
    <Card flush>
      <div className="space-y-2 p-2">
        <Tabs
          label={t("page_title")}
          value={tab}
          onChange={setChosenTab}
          items={[
            { key: "connected", label: t("connected"), count: connectedAll.length },
            { key: "available", label: t("not_connected"), count: availableAll.length },
          ]}
        />
        <ListToolbar>
          <SearchInput value={search} onChange={setSearch} placeholder={t("search_placeholder")} className="basis-full sm:basis-80 sm:flex-none" />
        </ListToolbar>
      </div>

      {tab === "connected" ? (
        connected.length === 0 ? (
          searching ? (
            <EmptyState compact icon={<SearchX />} title={common("no_results_found")} />
          ) : (
            <EmptyState compact icon={<Truck />} title={t("yours_empty_title")} description={t("yours_empty_description")} />
          )
        ) : (
          <ul className="divide-y divide-border border-t border-border">
            {connected.map((provider) => {
              const webhook = webhookSetup(provider, companyOf(provider));
              return (
                <li key={provider.code}>
                  <a href={`/delivery/companies/${provider.code}`} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-subtle">
                    <CarrierMark name={provider.name} connected />
                    <span className="min-w-0 flex-1 space-y-0.5">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-foreground">{provider.name}</span>
                        <Badge tone="success" dot>{t("connected")}</Badge>
                      </span>
                      <Capabilities provider={provider} webhookReady={webhook.kind !== "none" && webhook.ready} />
                    </span>
                    <ChevronRight size={16} aria-hidden="true" className="shrink-0 text-muted-foreground rtl:rotate-180" />
                  </a>
                </li>
              );
            })}
          </ul>
        )
      ) : available.length === 0 ? (
        <EmptyState compact icon={<SearchX />} title={common("no_results_found")} />
      ) : (
        <ul className="grid border-t border-border sm:grid-cols-2">
          {available.map((provider) => (
            <li key={provider.code} className="border-b border-border sm:odd:border-e">
              <a href={`/delivery/companies/${provider.code}`} className="group flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-subtle">
                <CarrierMark name={provider.name} connected={false} />
                <span className="min-w-0 flex-1 space-y-0.5">
                  <span className="block truncate text-sm font-medium text-foreground">{provider.name}</span>
                  <Capabilities provider={provider} webhookReady={false} />
                </span>
                {canManage && (
                  <span className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-muted-foreground transition-colors group-hover:bg-card group-hover:text-foreground group-hover:shadow-button">
                    {t("connect")}
                  </span>
                )}
              </a>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Gated() {
  const t = useT("delivery_companies");
  return (
    <DashboardChrome currentPath="/delivery/companies">
      <PageHeader title={t("page_title")} />
      <DeliveryCompaniesList />
    </DashboardChrome>
  );
}

export default function DeliveryCompaniesPageApp() {
  return (
    <RequireAuth>
      <Gated />
    </RequireAuth>
  );
}
