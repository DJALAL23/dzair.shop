import { useEffect, useState } from "react";
import { AlertTriangle, Megaphone, Package, Pencil, Plus, Receipt, Store, Wallet } from "lucide-react";
import { canScope, RequireAuth, useIdentity } from "@/features/auth/components/RequireAuth";
import { DashboardPage } from "@/components/layout/page";
import { MonthSwitcher } from "@/components/period/MonthSwitcher";
import {
  Alert,
  Button,
  Card,
  CellEmpty,
  EmptyState,
  IconButton,
  PageHeader,
  RowActions,
  StatStrip,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableSkeleton,
  showRowOnClick,
} from "@/components/ui";
import { useLocale, useT } from "@/i18n/react";
import { formatMoney } from "@/features/orders/model";
import { formatMonth, formatStoreDay, monthDays, storeDay, storeMonth } from "@/lib/store-time";
import { FOREIGN_CURRENCIES } from "../../../../../cod-shared/finance/model";
import { getCostsSummary, listCosts, listRates } from "@/features/finance/api";
import { costStatus, formatAmount, formatDinars, PRESETS, rateOn, touches, versionOn, type CostPreset, type CostVersionView } from "@/features/finance/model";
import type { Cost, CostLine, CostsSummary, ExchangeRate, ForeignCurrency } from "@/features/finance/types";
import { CostSheet } from "@/features/finance/components/CostSheet";
import { RateSheet } from "@/features/finance/components/RateSheet";

type Editing = { cost: Cost } | { preset: CostPreset | null };

/**
 * The store's costs for a month: what they come to (ads, costs that run on
 * their own, costs that follow orders), what is left out for want of a rate
 * with the one button that fixes it, what a dollar and a euro cost the
 * merchant, and every cost that counts in the month; a row opens it. The
 * current month counts up to today.
 */
function Gated() {
  const t = useT("finance");
  const common = useT("common");
  const locale = useLocale();
  const identity = useIdentity();
  const canRead = canScope(identity, "finance:read");
  const canManage = canScope(identity, "finance:manage");
  const today = storeDay();
  const thisMonth = storeMonth();
  const [month, setMonth] = useState(thisMonth);
  const [costs, setCosts] = useState<Cost[] | null>(null);
  const [rates, setRates] = useState<ExchangeRate[] | null>(null);
  const [summary, setSummary] = useState<CostsSummary | null>(null);
  const [failed, setFailed] = useState(false);
  const [version, setVersion] = useState(0);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [rateFor, setRateFor] = useState<{ currency: ForeignCurrency; from?: string } | null>(null);
  const [showOthers, setShowOthers] = useState(false);
  const days = monthDays(month);
  const countedTo = month === thisMonth ? today : days.to;

  useEffect(() => {
    if (!canRead) return;
    let current = true;
    setFailed(false);
    Promise.all([listCosts(), listRates()])
      .then(([loadedCosts, loadedRates]) => {
        if (!current) return;
        setCosts(loadedCosts);
        setRates(loadedRates);
      })
      .catch(() => current && setFailed(true));
    return () => {
      current = false;
    };
  }, [canRead, version]);

  useEffect(() => {
    if (!canRead) return;
    let current = true;
    setSummary(null);
    getCostsSummary(days.from, countedTo)
      .then((loaded) => current && setSummary(loaded))
      .catch(() => current && setFailed(true));
    return () => {
      current = false;
    };
  }, [canRead, month, version]);

  if (!canRead) {
    return (
      <DashboardPage>
        <Alert tone="critical">{t("no_access")}</Alert>
      </DashboardPage>
    );
  }

  const changed = () => setVersion((value) => value + 1);
  const lines = new Map((summary?.costs ?? []).map((line) => [line.id, line]));
  const inMonth = (costs ?? []).filter((cost) => touches(cost, days.from, days.to));
  const others = (costs ?? []).filter((cost) => !touches(cost, days.from, days.to));
  const shown = [...inMonth, ...(showOthers ? others : [])].sort((a, b) => (lines.get(b.id)?.amount ?? 0) - (lines.get(a.id)?.amount ?? 0) || a.name.localeCompare(b.name));
  const leftOut = summary?.missing.reduce((count, gap) => count + gap.costIds.length, 0) ?? 0;
  const loading = !costs || !rates || !summary;

  return (
    <DashboardPage>
      <PageHeader
        title={t("page_title")}
        subtitle={t("page_subtitle")}
        actions={
          canManage && (
            <Button type="button" onClick={() => setEditing({ preset: null })}>
              <Plus size={16} aria-hidden="true" />
              {t("add")}
            </Button>
          )
        }
        className="mb-4"
      />

      <div className="@container space-y-4">
        <MonthSwitcher
          month={month}
          onChange={(next) => {
            setMonth(next);
            setShowOthers(false);
          }}
        />

        {failed ? (
          <Alert role="alert" tone="critical">
            <p className="flex-1 font-semibold">{t("load_error")}</p>
            <button type="button" onClick={changed} className="text-xs font-semibold underline underline-offset-4">
              {common("retry")}
            </button>
          </Alert>
        ) : loading ? (
          <div className="space-y-4" role="status" aria-busy="true">
            <div className="h-24 shimmer rounded-xl" />
            <Card flush className="overflow-hidden">
              <TableSkeleton rows={4} columns={4} />
            </Card>
          </div>
        ) : costs.length === 0 ? (
          <Card>
            <EmptyState icon={<Receipt />} title={t("empty.title")} description={canManage ? t("empty.body") : t("empty.body_read")} />
            {canManage && (
              <div className="-mt-6 flex flex-wrap justify-center gap-2 px-4 pb-8">
                {PRESETS.map((preset) => (
                  <Button key={preset.key} type="button" size="sm" variant="secondary" onClick={() => setEditing({ preset })}>
                    {t(`presets.${preset.key}`)}
                  </Button>
                ))}
              </div>
            )}
          </Card>
        ) : (
          <>
            {summary.missing.map((gap) => (
              <Alert key={gap.currency} tone="warning" role="status">
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                  <span>{t(`missing.${gap.currency}`, { date: formatStoreDay(gap.from, locale) })}</span>
                  {canManage && (
                    <Button type="button" size="sm" variant="secondary" onClick={() => setRateFor({ currency: gap.currency, from: gap.from })}>
                      {t(`missing.set_${gap.currency}`)}
                    </Button>
                  )}
                </div>
              </Alert>
            ))}

            <StatStrip
              items={[
                {
                  label: month === thisMonth ? t("totals.all_so_far") : t("totals.all"),
                  value: formatDinars(summary.total, locale),
                  hint: leftOut > 0 ? t("totals.left_out", { count: leftOut }) : undefined,
                  icon: Wallet,
                  tone: leftOut > 0 ? "warning" : "neutral",
                },
                { label: t("totals.ads"), value: formatDinars(summary.ads, locale), hint: t("totals.ads_hint"), icon: Megaphone },
                { label: t("totals.running"), value: formatDinars(summary.running, locale), hint: t("totals.running_hint"), icon: Store },
                { label: t("totals.per_order"), value: formatDinars(summary.perOrder, locale), hint: t("totals.per_order_hint"), icon: Package },
              ]}
            />

            <Card title={t("rates.title")} help={t("rates.help")}>
              <div className="grid gap-3 @lg:grid-cols-2">
                {FOREIGN_CURRENCIES.map((currency) => {
                  const rate = rateOn(rates, currency, today);
                  const used = costs.some((cost) => cost.currency === currency);
                  return (
                    <div key={currency} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-foreground">
                          {t(`rates.one_${currency}`)}
                          {rate && <span className="tabular-nums"> = {formatMoney(rate.dzdPerUnit, locale)}</span>}
                        </p>
                        <p className={`text-xs ${!rate && used ? "text-tone-warning-text" : "text-muted-foreground"}`}>
                          {rate ? t("rates.since", { date: formatStoreDay(rate.validFrom, locale) }) : used ? t("rates.not_set") : t("rates.not_set_unused")}
                        </p>
                      </div>
                      {canManage && (
                        <Button type="button" size="sm" variant="secondary" onClick={() => setRateFor({ currency })}>
                          {rate ? t("rates.change") : t("rates.set")}
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>

            <CostsList
              costs={shown}
              lines={lines}
              month={month}
              day={countedTo}
              today={today}
              canManage={canManage}
              hidden={showOthers ? 0 : others.length}
              onShowOthers={() => setShowOthers(true)}
              onOpen={(cost) => setEditing({ cost })}
            />
          </>
        )}
      </div>

      {editing && rates && (
        <CostSheet
          cost={"cost" in editing ? editing.cost : null}
          preset={"preset" in editing ? editing.preset : null}
          rates={rates}
          canManage={canManage}
          onClose={() => setEditing(null)}
          onChanged={changed}
        />
      )}
      {rateFor && rates && <RateSheet currency={rateFor.currency} from={rateFor.from} rates={rates} onClose={() => setRateFor(null)} onChanged={changed} />}
    </DashboardPage>
  );
}

/** When the amount shown counts, in a few words: since a day, until a day, from a day to a day, or the day it was paid. */
function useWhen() {
  const t = useT("finance");
  const locale = useLocale();
  return (cost: Cost, version: CostVersionView, today: string) => {
    const day = (value: string) => formatStoreDay(value, locale);
    const status = costStatus(cost, today);
    if (status === "scheduled") return t("when.starts", { date: day(cost.startsOn) });
    if (status === "paid") return t("when.on", { date: day(cost.startsOn) });
    if (version.validFrom !== cost.since) return t("when.between", { from: day(version.validFrom), to: day(version.validTo!) });
    if (status === "stopped") return t("when.stopped", { date: day(cost.stopsOn!) });
    return cost.stopsOn ? t("when.until", { date: day(cost.stopsOn) }) : t("when.since", { date: day(cost.since) });
  };
}

/** What a cost counted in the month: dinars, and under them its orders, its own currency, or why some of it is left out. */
function MonthCell({ line }: { line: CostLine | undefined }) {
  const t = useT("finance");
  const locale = useLocale();
  if (!line || (line.amount === 0 && line.missingFrom === null && !line.orders)) return <CellEmpty />;
  return (
    <span className="flex flex-col items-end">
      <span className="tabular-nums text-foreground">{formatDinars(line.amount, locale)}</span>
      {line.missingFrom !== null ? (
        <span className="flex items-center gap-1 text-xs text-tone-warning-text">
          <AlertTriangle size={12} aria-hidden="true" />
          {t("list.left_out")}
        </span>
      ) : line.orders !== null ? (
        <span className="text-xs text-muted-foreground">{t("list.orders", { count: line.orders })}</span>
      ) : line.ownAmount !== null && line.ownCurrency !== null && line.ownCurrency !== "DZD" ? (
        <span className="text-xs text-muted-foreground">{formatAmount(line.ownAmount, line.ownCurrency, locale)}</span>
      ) : null}
    </span>
  );
}

function CostsList({
  costs,
  lines,
  month,
  day,
  today,
  canManage,
  hidden,
  onShowOthers,
  onOpen,
}: {
  costs: Cost[];
  lines: Map<string, CostLine>;
  month: string;
  /** The day whose amount each cost shows: today in this month, a past month's last day. */
  day: string;
  today: string;
  canManage: boolean;
  hidden: number;
  onShowOthers: () => void;
  onOpen: (cost: Cost) => void;
}) {
  const t = useT("finance");
  const locale = useLocale();
  const when = useWhen();
  const monthLabel = month === storeMonth() ? t("list.this_month") : formatMonth(month, locale);
  const what = (cost: Cost, version: CostVersionView) =>
    [t(`category.${cost.category}`), version.product && (version.product.id === null ? t("list.product_gone", { name: version.product.name }) : version.product.name)].filter(Boolean).join(" · ");
  const openLabel = (cost: Cost) => (canManage ? t("list.edit_for", { name: cost.name }) : t("list.see_for", { name: cost.name }));

  return (
    <Card flush className="overflow-hidden">
      {costs.length === 0 ? (
        <EmptyState compact icon={<Receipt />} title={t("empty.month_title")} description={t("empty.month_body", { month: formatMonth(month, locale) })} />
      ) : (
        <>
          <ul className="divide-y divide-border @3xl:hidden">
            {costs.map((cost) => {
              const version = versionOn(cost, day);
              return (
                <li key={cost.id}>
                  <button type="button" onClick={() => onOpen(cost)} aria-label={openLabel(cost)} className="flex w-full items-start gap-3 px-4 py-3 text-start transition-colors active:bg-subtle">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground">{cost.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">{what(cost, version)}</span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {formatAmount(version.amount, version.currency, locale)} · {t(`charge.${version.charge}`)} · {when(cost, version, today)}
                      </span>
                    </span>
                    <span className="shrink-0 text-sm">
                      <MonthCell line={lines.get(cost.id)} />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="relative hidden overflow-x-auto @3xl:block">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>{t("list.cost")}</TableHead>
                  <TableHead>{t("list.charged")}</TableHead>
                  <TableHead numeric>{t("list.amount")}</TableHead>
                  <TableHead numeric>{monthLabel}</TableHead>
                  <TableHead className="w-px">
                    <span className="sr-only">{t("list.open")}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {costs.map((cost) => {
                  const version = versionOn(cost, day);
                  return (
                    <TableRow key={cost.id} onClick={showRowOnClick(() => onOpen(cost))} className="cursor-pointer">
                      <TableCell className="w-full max-w-80">
                        <span className="block truncate font-medium text-foreground">{cost.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">{what(cost, version)}</span>
                      </TableCell>
                      <TableCell>
                        <span className="block whitespace-nowrap text-foreground">{t(`charge.${version.charge}`)}</span>
                        <span className="block whitespace-nowrap text-xs text-muted-foreground">{when(cost, version, today)}</span>
                      </TableCell>
                      <TableCell numeric>{formatAmount(version.amount, version.currency, locale)}</TableCell>
                      <TableCell numeric>
                        <MonthCell line={lines.get(cost.id)} />
                      </TableCell>
                      <TableCell className="w-px">
                        <RowActions>
                          <IconButton type="button" onClick={() => onOpen(cost)} aria-label={openLabel(cost)} title={openLabel(cost)}>
                            <Pencil size={15} aria-hidden="true" />
                          </IconButton>
                        </RowActions>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </>
      )}
      {hidden > 0 && (
        <div className="border-t border-border px-4 py-3">
          <button type="button" onClick={onShowOthers} className="text-xs font-semibold text-foreground underline-offset-4 hover:underline">
            {t("list.show_others", { count: hidden })}
          </button>
        </div>
      )}
    </Card>
  );
}

export default function CostsPageApp() {
  return (
    <RequireAuth>
      <Gated />
    </RequireAuth>
  );
}
