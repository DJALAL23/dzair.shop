import { useDeferredValue, useEffect, useRef, useState } from "react";
import { AlarmClock, AlertTriangle, Archive, PackageOpen, Send, UserRoundPlus } from "lucide-react";
import { canScope, useIdentity } from "@/features/auth/components/RequireAuth";
import { useLocale, useT } from "@/i18n/react";
import { placeLabel } from "@/lib/places";
import { getOrderStageCounts, listDeliveryCompanies, listDrivers, listOrders, type OrderQuery } from "@/features/orders/api";
import { listWilayas } from "@/features/geography/api";
import { BULK_HANDOFF_LIMIT, bulkSelection, handoffKinds, ORDER_QUEUES, viewCounts, viewQuery, SOURCE_FILTERS, type OrderView, type SourceFilter } from "@/features/orders/model";
import type { DeliveryCompany, Driver, OrderListItem, Wilaya } from "@/features/orders/types";
import {
  Alert,
  Button,
  Card,
  EmptyState,
  LinkButton,
  FilterPill,
  SearchInput,
  Table,
  TableSkeleton,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui";
import { OrderDesktopRow, OrderMobileCard } from "@/features/orders/components/OrderRow";
import { BulkHandoffDialog } from "@/features/orders/components/BulkHandoffDialog";
import { GiveOrdersDialog } from "@/features/confirmation/components/GiveOrdersDialog";
import { getTeam } from "@/features/confirmation/api";
import { TEAM_QUEUES, type TeamOverview, type TeamQueue } from "@/features/confirmation/types";

const PAGE_SIZE = 25;
const VIEWS: OrderView[] = ["all", ...ORDER_QUEUES.map((queue) => queue.key)];

interface Filters {
  search: string;
  kind: "" | "carrier" | "driver";
  orderType: "" | "online" | "offline";
  wilayaId: string;
  flagged: "" | "true";
  source: "" | SourceFilter;
  /** Who the order is with: anyone (""), nobody ("none"), or a member's id. */
  assignee: string;
  /** One of the confirmation team's queues, opened from the team page. */
  queue: "" | TeamQueue;
}

const NO_FILTERS: Filters = { search: "", kind: "", orderType: "", wilayaId: "", flagged: "", source: "", assignee: "", queue: "" };

function initialFilters(): Filters {
  const url = new URLSearchParams(window.location.search);
  const queue = url.get("team");
  return {
    ...NO_FILTERS,
    search: url.get("search") ?? "",
    assignee: url.get("assignee") ?? "",
    queue: TEAM_QUEUES.includes(queue as TeamQueue) ? (queue as TeamQueue) : "",
  };
}

function initialView(): OrderView {
  const view = new URLSearchParams(window.location.search).get("view");
  return view === "attention" || view === "archived" || view === "callbacks" || VIEWS.includes(view as OrderView) ? (view as OrderView) : "all";
}

const isWaiting = (order: OrderListItem) => order.status === "new" || order.status === "unreachable";

function rememberView(view: OrderView) {
  const url = new URL(window.location.href);
  if (view === "all") url.searchParams.delete("view");
  else url.searchParams.set("view", view);
  window.history.replaceState(null, "", url);
}

/**
 * The orders as the merchant works through them: one queue per step of the
 * day, each with its count, the orders whose delivery needs them, the
 * customers to call back, and a search that also finds a parcel by its
 * tracking number. With a confirmation team, who has each order, a filter
 * by member, and — for a manager — giving waiting orders out. The server
 * filters and pages, so every order is reachable.
 */
export function OrdersList() {
  const t = useT("orders");
  const team$ = useT("confirmation");
  const locale = useLocale();
  const common = useT("common");
  const identity = useIdentity();
  const may = (scope: string) => canScope(identity, scope);
  const [view, setView] = useState<OrderView>(initialView);
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const deferredFilters = useDeferredValue(filters);
  const [orders, setOrders] = useState<OrderListItem[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [counts, setCounts] = useState<Record<OrderView, number> | null>(null);
  const [callbacksDue, setCallbacksDue] = useState(0);
  const [team, setTeam] = useState<TeamOverview | null>(null);
  const [giveOpen, setGiveOpen] = useState(false);
  const [wilayas, setWilayas] = useState<Wilaya[]>([]);
  const [companies, setCompanies] = useState<DeliveryCompany[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [error, setError] = useState<Error | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const request = useRef(0);

  const kinds = may("delivery:read") ? handoffKinds(may) : [];
  const meId = identity?.user?.id;
  const showTeam = may("orders:read") && (team?.members.length ?? 0) > 0;
  const canGive = showTeam && may("team:manage") && (view === "to_confirm" || view === "callbacks");
  const canShipMany = !canGive && kinds.length > 0 && view !== "archived";
  const shippable = canShipMany ? (orders ?? []).filter((order) => order.stage === "ready_to_ship").map((order) => order.id) : [];
  const givable = canGive ? (orders ?? []).filter(isWaiting).map((order) => order.id) : [];
  const pickable = canGive ? givable : shippable;
  const selectable = canGive ? givable.length > 0 : canShipMany && (view === "to_ship" || shippable.length > 0);
  const selectionState = bulkSelection(selected, pickable);
  const selectAllLabel = canGive ? team$("list.select_all") : t("bulk.select_all");

  function query(cursor: string | null = null): OrderQuery {
    return {
      ...viewQuery(view),
      search: deferredFilters.search,
      kind: deferredFilters.kind || undefined,
      orderType: deferredFilters.orderType || undefined,
      wilayaId: deferredFilters.wilayaId ? Number(deferredFilters.wilayaId) : undefined,
      flagged: deferredFilters.flagged === "true" || undefined,
      channels: deferredFilters.source ? SOURCE_FILTERS[deferredFilters.source] : undefined,
      assignee: deferredFilters.assignee || undefined,
      team: deferredFilters.queue || undefined,
      limit: PAGE_SIZE,
      cursor,
    };
  }

  async function load() {
    const ticket = ++request.current;
    setError(null);
    setSelected(new Set());
    try {
      const [page, stageCounts] = await Promise.all([listOrders(query()), getOrderStageCounts({ working: true })]);
      if (ticket !== request.current) return;
      setOrders(page.orders);
      setNextCursor(page.nextCursor);
      setCounts(viewCounts(stageCounts));
      setCallbacksDue(stageCounts.callbacksDue);
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
    if (may("team:read")) getTeam().then(setTeam).catch(() => setTeam(null));
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

  function clearFilters() {
    setFilters(NO_FILTERS);
    const url = new URL(window.location.href);
    for (const key of ["search", "assignee", "team"]) url.searchParams.delete(key);
    window.history.replaceState(null, "", url);
  }

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else if (next.size < BULK_HANDOFF_LIMIT) next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(selectionState === "all" ? new Set() : new Set(pickable.slice(0, BULK_HANDOFF_LIMIT)));
  }

  const hasFilters = Object.values(filters).some(Boolean);
  const rowProps = { companies, drivers, onChanged: load, onError: (message: string) => setError(new Error(message)) };
  const selection = (order: OrderListItem) =>
    selectable && (canGive ? isWaiting(order) : order.stage === "ready_to_ship") ? { selected: selected.has(order.id), onToggle: () => toggle(order.id) } : undefined;
  const tabClass = (active: boolean) =>
    `inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-sm transition-colors pointer-coarse:h-9 ${
      active ? "bg-foreground/[0.08] font-semibold text-foreground" : "font-medium text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground"
    }`;

  return (
    <div className="space-y-3">
      {error && (
        <Alert role="alert" tone="critical">
          <div className="flex-1">
            <p className="font-semibold">{t("load_error")}</p>
            <p className="mt-0.5 text-xs opacity-80">{error.message}</p>
          </div>
          <button type="button" onClick={() => void load()} className="text-xs font-semibold underline underline-offset-4">
            {common("retry")}
          </button>
        </Alert>
      )}

      <Card flush className="overflow-hidden">
        <div role="tablist" aria-label={t("queues.label")} className="no-scrollbar flex items-center gap-0.5 overflow-x-auto px-2 pt-2">
          {VIEWS.map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={view === key}
              onClick={() => choose(key)}
              className={tabClass(view === key)}
            >
              {t(`queues.${key}`)}
              {counts && <span className="text-xs font-medium tabular-nums text-muted-foreground">{counts[key]}</span>}
            </button>
          ))}
          {counts && (counts.callbacks > 0 || view === "callbacks") && (
            <button type="button" role="tab" aria-selected={view === "callbacks"} onClick={() => choose("callbacks")} className={tabClass(view === "callbacks")}>
              <AlarmClock size={14} aria-hidden="true" />
              {t("queues.callbacks")}
              <span className="text-xs font-medium tabular-nums text-muted-foreground">{counts.callbacks}</span>
              {callbacksDue > 0 && (
                <span className="rounded-full bg-[var(--tone-critical-bg)] px-1.5 text-[11px] font-semibold tabular-nums text-[var(--tone-critical-text)]">
                  {t("queues.callbacks_due", { count: callbacksDue })}
                </span>
              )}
            </button>
          )}
          {counts && (counts.archived > 0 || view === "archived") && (
            <button
              type="button"
              role="tab"
              aria-selected={view === "archived"}
              onClick={() => choose("archived")}
              className={tabClass(view === "archived")}
            >
              <Archive size={14} aria-hidden="true" />
              {t("queues.archived")}
              <span className="text-xs font-medium tabular-nums text-muted-foreground">{counts.archived}</span>
            </button>
          )}
          {counts && counts.attention > 0 && (
            <button
              type="button"
              role="tab"
              aria-selected={view === "attention"}
              onClick={() => choose(view === "attention" ? "all" : "attention")}
              className={`ms-auto inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-[var(--tone-critical-text)] transition-colors pointer-coarse:h-9 ${
                view === "attention" ? "bg-[var(--tone-critical-bg)] font-semibold" : "hover:bg-[var(--tone-critical-bg)]"
              }`}
            >
              <AlertTriangle size={14} aria-hidden="true" />
              {t("queues.attention_count", { count: counts.attention })}
            </button>
          )}
        </div>
        {filters.queue && (
          <div className="mx-2 mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[var(--tone-info-bg)] px-3 py-2 text-sm font-medium text-[var(--tone-info-text)]">
            <span className="flex items-center gap-2">
              <UserRoundPlus size={15} aria-hidden="true" />
              {team$(`list.queue_filters.${filters.queue}`)}
            </span>
            <button type="button" onClick={clearFilters} className="text-xs font-semibold underline underline-offset-4">
              {team$("list.queue_clear")}
            </button>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2 p-2">
          <SearchInput
            value={filters.search}
            onChange={(search) => setFilter("search", search)}
            placeholder={t("search_placeholder")}
            className="basis-full sm:basis-72"
          />
          <FilterPill label={t("filters.delivered_by")} value={filters.kind} onChange={(value) => setFilter("kind", value as Filters["kind"])}>
            <option value="">{t("filters.any_delivery")}</option>
            <option value="carrier">{t("filters.by_carrier")}</option>
            <option value="driver">{t("filters.by_driver")}</option>
          </FilterPill>
          <FilterPill label={t("filters.type")} value={filters.orderType} onChange={(value) => setFilter("orderType", value as Filters["orderType"])}>
            <option value="">{t("filters.any_type")}</option>
            <option value="online">{t("type.online")}</option>
            <option value="offline">{t("type.offline")}</option>
          </FilterPill>
          <FilterPill label={t("filters.protection")} value={filters.flagged} onChange={(value) => setFilter("flagged", value as Filters["flagged"])}>
            <option value="">{t("filters.any_protection")}</option>
            <option value="true">{t("filters.flagged")}</option>
          </FilterPill>
          <FilterPill label={t("source.column")} value={filters.source} onChange={(value) => setFilter("source", value as Filters["source"])}>
            <option value="">{t("source.filter.any")}</option>
            {(Object.keys(SOURCE_FILTERS) as SourceFilter[]).map((key) => (
              <option key={key} value={key}>
                {t(`source.filter.${key}`)}
              </option>
            ))}
          </FilterPill>
          {showTeam && team && (
            <FilterPill label={team$("list.filter")} value={filters.assignee} onChange={(value) => setFilter("assignee", value)}>
              <option value="">{team$("list.anyone")}</option>
              <option value="none">{team$("list.nobody")}</option>
              {team.members.map((member) => (
                <option key={member.userId} value={member.userId}>
                  {member.userId === meId ? team$("list.me_name", { name: member.name }) : member.name}
                </option>
              ))}
            </FilterPill>
          )}
          {wilayas.length > 0 && (
            <FilterPill label={t("filters.wilaya")} value={filters.wilayaId} onChange={(value) => setFilter("wilayaId", value)}>
              <option value="">{t("filters.all_wilayas")}</option>
              {wilayas.map((wilaya) => (
                <option key={wilaya.id} value={String(wilaya.id)}>
                  {wilaya.id} · {placeLabel(wilaya, locale)}
                </option>
              ))}
            </FilterPill>
          )}
          {hasFilters && (
            <Button type="button" variant="ghost" size="sm" onClick={clearFilters}>
              {t("filters.clear")}
            </Button>
          )}
          {selectable && pickable.length > 1 && (
            <label className="flex items-center gap-2 px-1 text-xs font-semibold text-muted-foreground md:hidden">
              <SelectAllBox state={selectionState} onToggle={toggleAll} label={selectAllLabel} />
              {selectAllLabel}
            </label>
          )}
          {selectable && selected.size >= BULK_HANDOFF_LIMIT && pickable.length > BULK_HANDOFF_LIMIT && (
            <p className="text-xs font-medium text-muted-foreground">{t("bulk.limit", { count: BULK_HANDOFF_LIMIT })}</p>
          )}
          {selectable && canGive && (
            <Button type="button" className="ms-auto" disabled={selected.size === 0} onClick={() => setGiveOpen(true)}>
              <UserRoundPlus size={14} aria-hidden="true" />
              {selected.size > 0 ? team$("list.give", { count: selected.size }) : team$("list.select_hint")}
            </Button>
          )}
          {selectable && !canGive && (
            <Button type="button" className="ms-auto" disabled={selected.size === 0} onClick={() => setBulkOpen(true)}>
              <Send size={14} aria-hidden="true" />
              {selected.size > 0 ? t("bulk.ship_selected", { count: selected.size }) : t("bulk.select_hint")}
            </Button>
          )}
        </div>

        {orders === null ? (
          <TableSkeleton columns={7} />
        ) : orders.length === 0 ? (
          <EmptyState
            icon={<PackageOpen />}
            title={hasFilters ? common("no_results_found") : t(`empty.${view}`)}
            description={!hasFilters && view === "all" ? t("empty_state.description") : undefined}
            action={
              !hasFilters && view === "all" && may("orders:create") ? <LinkButton href="/orders/new">{t("empty_state.action")}</LinkButton> : undefined
            }
          />
        ) : (
          <>
            <div className="divide-y divide-border border-t border-border md:hidden">
              {orders.map((order) => (
                <OrderMobileCard key={order.id} order={order} selection={selection(order)} showAssignee={showTeam} />
              ))}
            </div>
            <div className="relative hidden overflow-x-auto md:block">
              <Table className="min-w-[1080px]">
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    {selectable && (
                      <TableHead className="w-10">
                        {pickable.length > 0 ? (
                          <SelectAllBox state={selectionState} onToggle={toggleAll} label={selectAllLabel} />
                        ) : (
                          <span className="sr-only">{t("bulk.select")}</span>
                        )}
                      </TableHead>
                    )}
                    <TableHead>{t("table.order_number")}</TableHead>
                    <TableHead>{t("table.date")}</TableHead>
                    <TableHead>{t("table.customer")}</TableHead>
                    <TableHead>{t("table.phone")}</TableHead>
                    <TableHead>{t("table.stage")}</TableHead>
                    <TableHead>{t("source.column")}</TableHead>
                    <TableHead>{t("table.delivery")}</TableHead>
                    <TableHead numeric>{t("table.total")}</TableHead>
                    <TableHead className="w-px">
                      <span className="sr-only">{common("table.actions")}</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orders.map((order) => (
                    <OrderDesktopRow key={order.id} order={order} selection={selection(order)} selectable={selectable} showAssignee={showTeam} {...rowProps} />
                  ))}
                </TableBody>
              </Table>
            </div>
            {nextCursor && (
              <div className="border-t border-border p-2.5 text-center">
                <Button type="button" variant="secondary" disabled={loadingMore} onClick={() => void loadMore()}>
                  {loadingMore ? t("loading_more") : t("load_more")}
                </Button>
              </div>
            )}
          </>
        )}
      </Card>

      {giveOpen && <GiveOrdersDialog orderIds={[...selected]} onClose={() => setGiveOpen(false)} onDone={() => void load()} />}

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

/** Selects every order on the list that can be shipped; shows "some" as indeterminate. */
function SelectAllBox({ state, onToggle, label }: { state: "none" | "some" | "all"; onToggle: () => void; label: string }) {
  const box = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (box.current) box.current.indeterminate = state === "some";
  }, [state]);
  return (
    <input
      ref={box}
      type="checkbox"
      checked={state === "all"}
      onChange={onToggle}
      aria-label={label}
      className="size-4 cursor-pointer rounded accent-[var(--primary)] pointer-coarse:size-5"
    />
  );
}
