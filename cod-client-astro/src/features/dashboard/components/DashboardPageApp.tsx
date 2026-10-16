import { useEffect, useState } from "react";
import { AlertTriangle, ArrowDownRight, ArrowRight, ArrowUpRight, BarChart3, Plus, RefreshCw } from "lucide-react";
import { canScope, RequireAuth, useIdentity } from "@/features/auth/components/RequireAuth";
import { DashboardChrome } from "@/components/layout/chrome";
import { StageBadge } from "@/features/orders/components/StageBadge";
import { EmptyState, LinkButton, Alert, PageHeader, Card, Select } from "@/components/ui";
import { useLocale, useT } from "@/i18n/react";
import {
  ACTIVITY_WINDOWS,
  deliverySuccessRate,
  queueBreakdown,
  summarizeActivity,
  type ActivityWindow,
  type OrderActivity,
} from "@/features/dashboard/model";
import { getOrderActivity } from "@/features/dashboard/api";
import { TrendChart } from "@/features/dashboard/components/TrendChart";
import { getOrderStageCounts, listOrders } from "@/features/orders/api";
import { formatMoney, orderTotal, viewCounts } from "@/features/orders/model";
import type { OrderListItem, OrderStageCounts } from "@/features/orders/types";

type Metric = "sales" | "orders";

function Change({ value }: { value: number | null }) {
  const t = useT("dashboard");
  if (value === null) return null;
  if (value === 0) return <span className="text-xs text-muted-foreground">{t("performance.flat")}</span>;
  const up = value > 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-xs font-medium tabular-nums ${up ? "text-[var(--tone-success-text)]" : "text-[var(--tone-critical-text)]"}`}
      aria-label={t(up ? "performance.up" : "performance.down", { value: Math.abs(value) })}
    >
      <Icon size={14} aria-hidden="true" />
      {Math.abs(value)}%
    </span>
  );
}

function Performance({ activity, range }: { activity: OrderActivity; range: ActivityWindow }) {
  const t = useT("dashboard");
  const locale = useLocale();
  const [metric, setMetric] = useState<Metric>("sales");
  const summary = summarizeActivity(activity);
  const tag = locale === "ar" ? "ar-DZ" : `${locale}-DZ`;
  const compact = new Intl.NumberFormat(tag, { notation: "compact", maximumFractionDigits: 1 });
  const formatDay = (date: string, style: "short" | "long") =>
    new Intl.DateTimeFormat(tag, style === "short" ? { day: "numeric", month: "short", timeZone: "UTC" } : { weekday: "short", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
  const cells: { key: Metric | "average"; label: string; value: string; change: number | null }[] = [
    { key: "sales", label: t("performance.sales"), value: formatMoney(summary.sales, locale), change: summary.change.sales },
    { key: "orders", label: t("performance.orders"), value: summary.orders.toLocaleString(tag), change: summary.change.orders },
    { key: "average", label: t("performance.average"), value: summary.average === null ? "—" : formatMoney(summary.average, locale), change: summary.change.average },
  ];
  const label = metric === "sales" ? t("performance.sales") : t("performance.orders");

  return (
    <section className="overflow-hidden rounded-xl bg-card shadow-card">
      <div className="grid grid-cols-2 gap-px border-b border-border bg-border sm:grid-cols-3">
        {cells.map((cell) => {
          const selectable = cell.key !== "average";
          const selected = cell.key === metric;
          const body = (
            <>
              <span className={`text-sm ${selected ? "text-foreground" : "text-muted-foreground"}`}>{cell.label}</span>
              <span className="mt-1.5 block truncate text-xl font-semibold leading-tight tracking-tight tabular-nums text-foreground sm:text-2xl">{cell.value}</span>
              {cell.change !== null && (
                <span className="mt-1 block">
                  <Change value={cell.change} />
                </span>
              )}
            </>
          );
          return selectable ? (
            <button
              key={cell.key}
              type="button"
              aria-pressed={selected}
              onClick={() => setMetric(cell.key as Metric)}
              className={`relative min-w-0 px-4 py-3.5 text-start transition-colors focus-visible:z-10 ${selected ? "bg-card" : "bg-subtle hover:bg-muted"}`}
            >
              {selected && <span aria-hidden="true" className="absolute inset-x-0 top-0 h-0.5 bg-[var(--chart-trend)]" />}
              {body}
            </button>
          ) : (
            <div key={cell.key} className="col-span-2 flex min-w-0 items-baseline justify-between gap-3 bg-subtle px-4 py-3 sm:col-span-1 sm:block sm:py-3.5">
              {body}
            </div>
          );
        })}
      </div>
      <div className="px-2 pb-2 pt-4 sm:px-4">
        {summary.orders === 0 ? (
          <div className="grid h-[220px] place-items-center text-sm text-muted-foreground">{t("performance.empty")}</div>
        ) : (
          <TrendChart
            days={summary.days}
            value={(day) => (metric === "sales" ? day.sales : day.orders)}
            formatValue={(amount) => (metric === "sales" ? formatMoney(amount, locale) : amount.toLocaleString(tag))}
            formatTick={(amount) => compact.format(amount)}
            formatDay={formatDay}
            caption={t("performance.caption", { metric: label, range: t("performance.range", { count: range }) })}
          />
        )}
      </div>
    </section>
  );
}

function DashboardOverview() {
  const identity = useIdentity();
  const t = useT("dashboard");
  const common = useT("common");
  const auth = useT("auth");
  const locale = useLocale();
  const ordersT = useT("orders");
  const [range, setRange] = useState<ActivityWindow>(30);
  const [stats, setStats] = useState<OrderStageCounts | null>(null);
  const [activity, setActivity] = useState<OrderActivity | null>(null);
  const [recent, setRecent] = useState<OrderListItem[] | null>(null);
  const [error, setError] = useState<Error | null>(null);

  async function load() {
    setError(null);
    try {
      const [nextStats, nextRecent] = await Promise.all([
        getOrderStageCounts(),
        canScope(identity, "orders:read") ? listOrders({ limit: 5 }) : Promise.resolve(null),
      ]);
      setStats(nextStats);
      setRecent(nextRecent ? nextRecent.orders : []);
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error(String(cause)));
    }
  }

  useEffect(() => {
    if (canScope(identity, "dashboard:view")) void load();
  }, [identity?.role, identity?.scopes.join(",")]);

  useEffect(() => {
    if (!canScope(identity, "dashboard:view")) return;
    let alive = true;
    getOrderActivity(range)
      .then((next) => alive && setActivity(next))
      .catch((cause) => alive && setError(cause instanceof Error ? cause : new Error(String(cause))));
    return () => {
      alive = false;
    };
  }, [range, identity?.role, identity?.scopes.join(",")]);

  const views = stats ? viewCounts(stats) : null;
  const next = !views
    ? undefined
    : views.attention > 0
      ? t("next.attention", { count: views.attention })
      : views.to_confirm > 0
        ? t("next.to_confirm", { count: views.to_confirm })
        : views.to_ship > 0
          ? t("next.to_ship", { count: views.to_ship })
          : t("next.clear");

  const header = (
    <PageHeader
      title={t("header.title")}
      subtitle={next}
      actions={
        canScope(identity, "orders:create") ? (
          <LinkButton href="/orders/new">
            <Plus size={15} aria-hidden="true" />
            {t("recent_orders.new_order")}
          </LinkButton>
        ) : undefined
      }
    />
  );

  if (!canScope(identity, "dashboard:view")) {
    return (
      <div>
        {header}
        <Alert role="alert" tone="critical">
          {auth("no_access")}
        </Alert>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        {header}
        <Alert role="alert" tone="critical">
          <div className="flex-1">
            <p className="font-semibold">{common("error_occurred")}</p>
            <p className="mt-0.5 text-xs opacity-80">{error.message}</p>
          </div>
          <button type="button" onClick={() => void load()} className="inline-flex items-center gap-1 text-xs font-semibold underline underline-offset-4">
            <RefreshCw size={12} aria-hidden="true" />
            {common("retry")}
          </button>
        </Alert>
      </div>
    );
  }

  if (!stats || !views || recent === null || activity === null) {
    return (
      <div>
        {header}
        <div role="status" aria-busy="true" className="space-y-4">
          <div className="h-8 w-40 shimmer rounded-lg" />
          <div className="overflow-hidden rounded-xl bg-card shadow-card">
            <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-3">
              {Array.from({ length: 3 }).map((_, index) => (
                <div key={index} className="space-y-2.5 bg-card px-4 py-3.5">
                  <div className="h-3 w-16 shimmer" />
                  <div className="h-6 w-28 shimmer" />
                  <div className="h-3 w-10 shimmer" />
                </div>
              ))}
            </div>
            <div className="h-[244px]" />
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
            <div className="h-80 rounded-xl bg-card shadow-card" />
            <div className="h-80 rounded-xl bg-card shadow-card" />
          </div>
        </div>
      </div>
    );
  }

  const queues = queueBreakdown(stats);
  const successRate = deliverySuccessRate(stats);

  return (
    <div className="space-y-4">
      {header}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Select
          aria-label={t("performance.period")}
          value={String(range)}
          onChange={(event) => setRange(Number(event.currentTarget.value) as ActivityWindow)}
          variant="pill"
          wrapperClassName="inline-flex"
        >
          {ACTIVITY_WINDOWS.map((days) => (
            <option key={days} value={days}>
              {t("performance.range", { count: days })}
            </option>
          ))}
        </Select>
        {activity.previous.orders > 0 && <span className="text-xs text-muted-foreground">{t("performance.compared", { count: range })}</span>}
      </div>

      <Performance activity={activity} range={range} />

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <Card title={t("queues.title")} subtitle={t("queues.total", { count: views.all })}>
          {views.attention > 0 && (
            <a
              href="/orders?view=attention"
              className="mb-4 flex items-start gap-2.5 rounded-lg border border-[var(--tone-critical-border)] bg-[var(--tone-critical-bg)] p-3 text-[var(--tone-critical-text)] transition-opacity hover:opacity-90"
            >
              <AlertTriangle size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{t("next.attention", { count: views.attention })}</span>
                <span className="block text-xs opacity-80">{t("stats.needs_attention_hint")}</span>
              </span>
              <ArrowRight size={16} aria-hidden="true" className="mt-0.5 shrink-0 rtl:rotate-180" />
            </a>
          )}
          {views.all === 0 ? (
            <EmptyState compact icon={<BarChart3 />} title={t("recent_orders.empty")} />
          ) : (
            <>
              <div className="flex h-2 gap-0.5 overflow-hidden rounded-full" role="img" aria-label={t("queues.subtitle")}>
                {queues.filter(({ count }) => count > 0).map(({ key, count }) => (
                  <span
                    key={key}
                    className="h-full origin-left animate-[cf-grow_600ms_var(--ease-out-quint)_both] first:rounded-s-full last:rounded-e-full rtl:origin-right"
                    style={{ flexGrow: count, flexBasis: 0, minWidth: 4, backgroundColor: `var(--chart-${key})` }}
                  />
                ))}
              </div>
              <ul className="-mx-2 mt-4 space-y-px">
                {queues.map(({ key, count, share }) => (
                  <li key={key}>
                    <a href={`/orders?view=${key}`} className="flex h-9 items-center gap-2.5 rounded-lg px-2 text-sm transition-colors hover:bg-subtle">
                      <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ backgroundColor: `var(--chart-${key})` }} />
                      <span className={`min-w-0 flex-1 truncate ${count > 0 ? "text-foreground" : "text-muted-foreground"}`}>{ordersT(`queues.${key}`)}</span>
                      <span className="w-10 text-end text-xs tabular-nums text-muted-foreground">{share}%</span>
                      <span className={`w-12 text-end tabular-nums ${count > 0 ? "font-medium text-foreground" : "text-muted-foreground"}`}>{count.toLocaleString(locale)}</span>
                    </a>
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex items-baseline justify-between gap-3 border-t border-border pt-3">
                <span className="text-sm text-muted-foreground">{t("stats.delivery_success")}</span>
                <span className="text-end">
                  <span className="block text-sm font-medium tabular-nums text-foreground">{successRate === null ? "—" : `${successRate}%`}</span>
                  <span className="block text-xs text-muted-foreground">
                    {t("stats.delivered_count", { count: views.delivered })}, {t("stats.refused_count", { count: views.returns })}
                  </span>
                </span>
              </div>
            </>
          )}
        </Card>

        <Card
          flush
          title={t("recent_orders.title")}
          action={
            <LinkButton href="/orders" variant="ghost" size="sm" className="text-link">
              {t("recent_orders.view_all")}
            </LinkButton>
          }
        >
          {recent.length === 0 ? (
            <EmptyState
              compact
              icon={<BarChart3 />}
              title={t("recent_orders.empty")}
              action={canScope(identity, "orders:create") ? <LinkButton href="/orders/new">{t("recent_orders.new_order")}</LinkButton> : undefined}
            />
          ) : (
            <ul className="divide-y divide-border border-t border-border">
              {recent.map((order) => (
                <li key={order.id}>
                  <a href={`/orders/${order.id}`} className="flex min-h-[60px] items-center gap-3 px-4 py-2.5 transition-colors hover:bg-subtle">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground">{order.orderNumber}</span>
                      <span className="block truncate text-xs text-muted-foreground">{order.customerName}</span>
                    </span>
                    <span className="hidden sm:block">
                      <StageBadge stage={order.stage} needsAttention={order.needsAttention} />
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1 sm:w-24">
                      <span className="text-sm tabular-nums text-foreground">{formatMoney(orderTotal(order), locale)}</span>
                      <span className="sm:hidden">
                        <StageBadge stage={order.stage} needsAttention={order.needsAttention} />
                      </span>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

export default function DashboardPageApp() {
  return (
    <RequireAuth>
      <DashboardChrome currentPath="/dashboard">
        <DashboardOverview />
      </DashboardChrome>
    </RequireAuth>
  );
}
