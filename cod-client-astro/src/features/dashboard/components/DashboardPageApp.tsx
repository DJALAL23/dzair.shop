import { useEffect, useState } from "react";
import { AlertCircle, AlertTriangle, BarChart3, CheckCircle2, Plus, RefreshCw, Send, Truck } from "lucide-react";
import { canScope, RequireAuth, useIdentity } from "@/features/auth/components/RequireAuth";
import { DashboardChrome } from "@/components/layout/chrome";
import { StageBadge } from "@/features/orders/components/StageBadge";
import { Button, EmptyState, LinkButton, Alert, PageHeader, StatCard, Card } from "@/components/ui";
import { useLocale, useT } from "@/i18n/react";
import { relativeTime } from "@/lib/relative-time";
import { deliverySuccessRate, queueBreakdown } from "@/features/dashboard/model";
import { getOrderStageCounts, listOrders } from "@/features/orders/api";
import { formatMoney, orderTotal, viewCounts } from "@/features/orders/model";
import type { OrderListItem, OrderStageCounts } from "@/features/orders/types";

function DashboardOverview() {
  const identity = useIdentity();
  const t = useT("dashboard");
  const common = useT("common");
  const auth = useT("auth");
  const locale = useLocale();
  const ordersT = useT("orders");
  const [stats, setStats] = useState<OrderStageCounts | null>(null);
  const [recent, setRecent] = useState<OrderListItem[] | null>(null);
  const [error, setError] = useState<Error | null>(null);

  async function load() {
    setError(null);
    try {
      const [nextStats, nextRecent] = await Promise.all([
        getOrderStageCounts(),
        canScope(identity, "orders:read")
          ? listOrders({ limit: 5 })
          : Promise.resolve(null),
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

  const header = (
    <PageHeader
      title={t("header.title")}
      subtitle={t("header.subtitle")}
      actions={
        canScope(identity, "orders:create") ? (
          <LinkButton href="/orders/new">
            <Plus size={16} />
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
          <AlertCircle size={18} className="mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold">{common("error_occurred")}</p>
            <p className="mt-1 text-xs opacity-80">{error.message}</p>
            <Button
              type="button"
              variant="ghost"
              onClick={() => void load()}
              className="mt-3 min-h-9 px-0 text-xs underline underline-offset-4"
            >
              <RefreshCw size={13} />
              {common("retry")}
            </Button>
          </div>
        </Alert>
      </div>
    );
  }

  if (!stats || recent === null) {
    return (
      <div>
        {header}
        <div role="status" aria-busy="true" className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <div
                key={index}
                className="h-[88px] animate-pulse rounded-xl border border-border bg-card"
              />
            ))}
          </div>
          <div className="h-72 animate-pulse rounded-xl border border-border bg-card" />
        </div>
      </div>
    );
  }

  const views = viewCounts(stats);
  const queues = queueBreakdown(stats);
  const successRate = deliverySuccessRate(stats);

  return (
    <div className="space-y-5">
      {header}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <a href="/orders?view=attention" className="block rounded-xl focus-visible:outline-2">
          <StatCard
            label={t("stats.needs_attention")}
            value={views.attention.toLocaleString(locale)}
            tone={views.attention > 0 ? "critical" : "neutral"}
            icon={<AlertTriangle size={20} />}
            hint={t("stats.needs_attention_hint")}
          />
        </a>
        <a href="/orders?view=to_ship" className="block rounded-xl focus-visible:outline-2">
          <StatCard label={t("stats.to_ship")} value={views.to_ship.toLocaleString(locale)} tone="warning" icon={<Send size={20} />} hint={t("stats.to_ship_hint")} />
        </a>
        <a href="/orders?view=on_the_way" className="block rounded-xl focus-visible:outline-2">
          <StatCard label={t("stats.on_the_way")} value={views.on_the_way.toLocaleString(locale)} tone="brand" icon={<Truck size={20} />} />
        </a>
        <StatCard
          label={t("stats.delivery_success")}
          value={successRate === null ? "—" : `${successRate}%`}
          tone="success"
          icon={<CheckCircle2 size={20} />}
          hint={t("stats.delivery_success_hint", { delivered: views.delivered, refused: views.returns })}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card
          flush
          title={t("recent_orders.title")}
          action={
            <a
              href="/orders"
              className="text-xs font-semibold text-link hover:underline"
            >
              {t("recent_orders.view_all")}
            </a>
          }
        >
          {recent.length === 0 ? (
            <EmptyState
              compact
              icon={<BarChart3 size={20} />}
              title={t("recent_orders.empty")}
            />
          ) : (
            <ul className="divide-y divide-border">
              {recent.map((order) => (
                <li key={order.id}>
                  <a
                    href={`/orders/${order.id}`}
                    className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50 sm:px-5"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-link">
                        {order.orderNumber}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {order.customerName}
                      </span>
                    </span>
                    <StageBadge stage={order.stage} needsAttention={order.needsAttention} />
                    <span className="w-24 shrink-0 text-end text-sm font-bold tabular-nums text-foreground">
                      {formatMoney(orderTotal(order), locale)}
                    </span>
                    <span className="hidden w-24 shrink-0 text-end text-xs text-muted-foreground sm:block">
                      {relativeTime(order.createdAt, locale)}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card flush title={t("queues.title")}>
          <p className="border-b border-border px-4 py-3 text-sm text-muted-foreground sm:px-5">{t("queues.subtitle")}</p>
          {views.all === 0 ? (
            <EmptyState compact icon={<BarChart3 size={20} />} title={t("recent_orders.empty")} />
          ) : (
            <div className="divide-y divide-border">
              {queues.map(({ key, count, share }) => (
                <a
                  key={key}
                  href={`/orders?view=${key}`}
                  className="grid gap-3 px-4 py-3 transition-colors hover:bg-muted/50 sm:grid-cols-[150px_minmax(0,1fr)_56px] sm:items-center sm:px-5"
                >
                  <div className="flex items-center justify-between gap-3 sm:justify-start">
                    <span className="text-sm font-semibold">{ordersT(`queues.${key}`)}</span>
                    <span className="text-sm font-bold tabular-nums sm:hidden">{count.toLocaleString(locale)}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div
                      className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-muted"
                      role="progressbar"
                      aria-label={ordersT(`queues.${key}`)}
                      aria-valuemin={0}
                      aria-valuemax={views.all}
                      aria-valuenow={count}
                    >
                      <div className="h-full rounded-full bg-primary" style={{ width: `${share}%` }} />
                    </div>
                    <span className="w-10 text-end text-xs font-semibold tabular-nums text-muted-foreground">{share}%</span>
                  </div>
                  <span className="hidden text-end text-sm font-bold tabular-nums sm:block">{count.toLocaleString(locale)}</span>
                </a>
              ))}
            </div>
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
