import { useDeferredValue, useEffect, useRef, useState } from "react";
import { AlertCircle, AlertTriangle, Filter, PackageOpen, Send } from "lucide-react";
import { canScope, useIdentity } from "@/features/auth/components/RequireAuth";
import { useT } from "@/i18n/react";
import { getOrderStageCounts, listDeliveryCompanies, listDrivers, listOrders, listWilayas, type OrderQuery } from "@/features/orders/api";
import { handoffKinds, ORDER_QUEUES, viewCounts, viewQuery, type OrderView } from "@/features/orders/model";
import type { DeliveryCompany, Driver, OrderListItem, Wilaya } from "@/features/orders/types";
import {
  Alert,
  Button,
  Card,
  EmptyState,
  LinkButton,
  SearchInput,
  Select,
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui";
import { OrderDesktopRow, OrderMobileCard } from "@/features/orders/components/OrderRow";
import { BulkHandoffDialog } from "@/features/orders/components/BulkHandoffDialog";

const PAGE_SIZE = 25;
const VIEWS: OrderView[] = ["all", ...ORDER_QUEUES.map((queue) => queue.key)];

interface Filters {
  search: string;
  kind: "" | "carrier" | "driver";
  orderType: "" | "online" | "offline";
  wilayaId: string;
}

const NO_FILTERS: Filters = { search: "", kind: "", orderType: "", wilayaId: "" };

function initialView(): OrderView {
  const view = new URLSearchParams(window.location.search).get("view");
  return view === "attention" || VIEWS.includes(view as OrderView) ? (view as OrderView) : "all";
}

function rememberView(view: OrderView) {
  const url = new URL(window.location.href);
  if (view === "all") url.searchParams.delete("view");
  else url.searchParams.set("view", view);
  window.history.replaceState(null, "", url);
}

function OrderSkeleton() {
  return (
    <div role="status" aria-busy="true" className="divide-y divide-border">
      {Array.from({ length: 6 }).map((_, index) => (
        <div key={index} className="grid h-14 grid-cols-[1fr_1.2fr_0.8fr] items-center gap-4 px-4">
          <div className="h-3 w-24 animate-pulse rounded bg-muted" />
          <div className="h-3 w-32 animate-pulse rounded bg-muted" />
          <span className="h-6 w-20 justify-self-end animate-pulse rounded-full bg-muted" />
        </div>
      ))}
    </div>
  );
}

function FilterSelect({ label, value, onChange, children }: { label: string; value: string; onChange: (value: string) => void; children: React.ReactNode }) {
  return (
    <label className="relative flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-input bg-background px-3 sm:flex-none">
      <Filter size={14} aria-hidden="true" className="shrink-0 text-muted-foreground" />
      <Select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        variant="bare"
        size="sm"
        wrapperClassName="min-w-0 flex-1"
        triggerClassName="min-w-0 flex-1"
      >
        {children}
      </Select>
    </label>
  );
}

/**
 * The orders as the merchant works through them: one queue per step of the
 * day, each with its count, the orders whose delivery needs them, and a
 * search that also finds a parcel by its tracking number. The server
 * filters and pages, so every order is reachable.
 */
export function OrdersList() {
  const t = useT("orders");
  const common = useT("common");
  const identity = useIdentity();
  const may = (scope: string) => canScope(identity, scope);
  const [view, setView] = useState<OrderView>(initialView);
  const [filters, setFilters] = useState<Filters>(() => ({ ...NO_FILTERS, search: new URLSearchParams(window.location.search).get("search") ?? "" }));
  const deferredFilters = useDeferredValue(filters);
  const [orders, setOrders] = useState<OrderListItem[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [counts, setCounts] = useState<Record<OrderView, number> | null>(null);
  const [wilayas, setWilayas] = useState<Wilaya[]>([]);
  const [companies, setCompanies] = useState<DeliveryCompany[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [error, setError] = useState<Error | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const request = useRef(0);

  const kinds = may("delivery:read") ? handoffKinds(may) : [];
  const selectable = view === "to_ship" && kinds.length > 0;

  function query(cursor: string | null = null): OrderQuery {
    return {
      ...viewQuery(view),
      search: deferredFilters.search,
      kind: deferredFilters.kind || undefined,
      orderType: deferredFilters.orderType || undefined,
      wilayaId: deferredFilters.wilayaId ? Number(deferredFilters.wilayaId) : undefined,
      limit: PAGE_SIZE,
      cursor,
    };
  }

  async function load() {
    const ticket = ++request.current;
    setError(null);
    setSelected(new Set());
    try {
      const [page, stageCounts] = await Promise.all([listOrders(query()), getOrderStageCounts()]);
      if (ticket !== request.current) return;
      setOrders(page.orders);
      setNextCursor(page.nextCursor);
      setCounts(viewCounts(stageCounts));
    } catch (cause) {
      if (ticket === request.current) setError(cause instanceof Error ? cause : new Error(String(cause)));
    }
  }

  async function loadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const page = await listOrders(query(nextCursor));
      setOrders((current) => [...(current ?? []), ...page.orders]);
      setNextCursor(page.nextCursor);
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error(String(cause)));
    } finally {
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    setOrders(null);
    void load();
  }, [view, deferredFilters, identity?.role, identity?.scopes.join(",")]);

  useEffect(() => {
    listWilayas().then(setWilayas).catch(() => setWilayas([]));
    if (!may("delivery:read")) return;
    if (kinds.includes("carrier")) listDeliveryCompanies(true).then(setCompanies).catch(() => setCompanies([]));
    if (kinds.includes("driver")) listDrivers().then(setDrivers).catch(() => setDrivers([]));
  }, [identity?.role, identity?.scopes.join(",")]);

  function choose(next: OrderView) {
    setView(next);
    rememberView(next);
  }

  function setFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const hasFilters = Object.values(filters).some(Boolean);
  const rowProps = { companies, drivers, onChanged: load, onError: (message: string) => setError(new Error(message)) };
  const selection = (order: OrderListItem) =>
    selectable && order.stage === "ready_to_ship" ? { selected: selected.has(order.id), onToggle: () => toggle(order.id) } : undefined;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label={t("queues.label")} className="-mx-1 flex min-w-0 flex-1 gap-1 overflow-x-auto px-1 pb-1">
          {VIEWS.map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={view === key}
              onClick={() => choose(key)}
              className={`inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold transition-colors ${
                view === key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {t(`queues.${key}`)}
              {counts && <span className={`rounded-md px-1.5 text-xs tabular-nums ${view === key ? "bg-primary-foreground/20" : "bg-muted"}`}>{counts[key]}</span>}
            </button>
          ))}
        </div>
        {counts && counts.attention > 0 && (
          <button
            type="button"
            onClick={() => choose(view === "attention" ? "all" : "attention")}
            aria-pressed={view === "attention"}
            className={`inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-sm font-semibold ${
              view === "attention"
                ? "border-[var(--status-returned-border)] bg-[var(--status-returned-bg)] text-[var(--status-returned-text)]"
                : "border-[var(--status-returned-border)] text-[var(--status-returned-text)] hover:bg-[var(--status-returned-bg)]"
            }`}
          >
            <AlertTriangle size={14} />
            {t("queues.attention_count", { count: counts.attention })}
          </button>
        )}
      </div>

      {error && (
        <Alert role="alert" tone="critical">
          <AlertCircle size={18} className="mt-0.5 shrink-0" />
          <div className="flex-1">
            <p className="font-semibold">{t("load_error")}</p>
            <p className="mt-1 text-xs opacity-80">{error.message}</p>
          </div>
          <button type="button" onClick={() => void load()} className="text-xs font-semibold underline underline-offset-4">
            {common("retry")}
          </button>
        </Alert>
      )}

      <Card flush>
        <div className="space-y-3 border-b border-border p-3">
          <SearchInput value={filters.search} onChange={(search) => setFilter("search", search)} placeholder={t("search_placeholder")} />
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <FilterSelect label={t("filters.delivered_by")} value={filters.kind} onChange={(value) => setFilter("kind", value as Filters["kind"])}>
              <option value="">{t("filters.any_delivery")}</option>
              <option value="carrier">{t("filters.by_carrier")}</option>
              <option value="driver">{t("filters.by_driver")}</option>
            </FilterSelect>
            <FilterSelect label={t("filters.type")} value={filters.orderType} onChange={(value) => setFilter("orderType", value as Filters["orderType"])}>
              <option value="">{t("filters.any_type")}</option>
              <option value="online">{t("type.online")}</option>
              <option value="offline">{t("type.offline")}</option>
            </FilterSelect>
            {wilayas.length > 0 && (
              <FilterSelect label={t("filters.wilaya")} value={filters.wilayaId} onChange={(value) => setFilter("wilayaId", value)}>
                <option value="">{t("filters.all_wilayas")}</option>
                {wilayas.map((wilaya) => (
                  <option key={wilaya.id} value={String(wilaya.id)}>
                    {wilaya.id} · {wilaya.nameAr}
                  </option>
                ))}
              </FilterSelect>
            )}
            {hasFilters && (
              <button type="button" onClick={() => setFilters(NO_FILTERS)} className="h-10 rounded-lg px-3 text-sm font-semibold text-muted-foreground hover:bg-muted hover:text-foreground">
                {t("filters.clear")}
              </button>
            )}
            {selectable && (
              <Button type="button" className="sm:ms-auto" disabled={selected.size === 0} onClick={() => setBulkOpen(true)}>
                <Send size={15} />
                {selected.size > 0 ? t("bulk.ship_selected", { count: selected.size }) : t("bulk.select_hint")}
              </Button>
            )}
          </div>
        </div>

        {orders === null ? (
          <OrderSkeleton />
        ) : orders.length === 0 ? (
          <EmptyState
            icon={<PackageOpen size={22} />}
            title={hasFilters ? common("no_results_found") : t(`empty.${view}`)}
            description={!hasFilters && view === "all" ? t("empty_state.description") : undefined}
            action={
              !hasFilters && view === "all" && may("orders:create") ? <LinkButton href="/orders/new">{t("empty_state.action")}</LinkButton> : undefined
            }
          />
        ) : (
          <>
            <div className="divide-y divide-border md:hidden">
              {orders.map((order) => (
                <OrderMobileCard key={order.id} order={order} selection={selection(order)} {...rowProps} />
              ))}
            </div>
            <div className="hidden overflow-x-auto md:block">
              <Table className="min-w-[900px]">
                <TableHeader>
                  <TableRow className="text-xs font-semibold text-muted-foreground">
                    {selectable && (
                      <TableHead className="w-10">
                        <span className="sr-only">{t("bulk.select")}</span>
                      </TableHead>
                    )}
                    <TableHead className="text-start">{t("table.order_number")}</TableHead>
                    <TableHead className="text-start">{t("table.customer")}</TableHead>
                    <TableHead className="text-start">{t("table.stage")}</TableHead>
                    <TableHead className="text-start">{t("table.wilaya")}</TableHead>
                    <TableHead className="text-start">{t("table.delivery")}</TableHead>
                    <TableHead className="text-end">{t("table.total")}</TableHead>
                    <TableHead className="w-12">
                      <span className="sr-only">{common("table.actions")}</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orders.map((order) => (
                    <OrderDesktopRow key={order.id} order={order} selection={selection(order)} selectable={selectable} {...rowProps} />
                  ))}
                </TableBody>
              </Table>
            </div>
            {nextCursor && (
              <div className="border-t border-border p-3 text-center">
                <Button type="button" variant="secondary" disabled={loadingMore} onClick={() => void loadMore()}>
                  {loadingMore ? t("loading_more") : t("load_more")}
                </Button>
              </div>
            )}
          </>
        )}
      </Card>

      {bulkOpen && (
        <BulkHandoffDialog
          orders={(orders ?? []).filter((order) => selected.has(order.id))}
          kinds={kinds}
          companies={companies}
          drivers={drivers}
          onClose={() => setBulkOpen(false)}
          onDone={() => void load()}
        />
      )}
    </div>
  );
}
