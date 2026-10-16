import { useDeferredValue, useEffect, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Pencil, X, XCircle, AlertTriangle, Wallet, Package, History, SearchX } from "lucide-react";
import { canScope, RequireAuth, useIdentity } from "@/features/auth/components/RequireAuth";
import { DashboardChrome } from "@/components/layout/chrome";
import { Button, EmptyState, IconButton, Alert, PageHeader, SearchInput, Select, StatCard, StatGroup, Tabs } from "@/components/ui";
import { useLocale, useT } from "@/i18n/react";
import { SCOPES } from "../../../../../cod-shared/rbac/scopes";
import { getStockOverview } from "@/features/products/api";
import { filterStockItems, formatMoneyValue, formatStockDate, groupStockByProduct, sortStockGroups, stockAlertTone, stockGroupInventory, type StockGroup, type StockSortKey } from "@/features/products/model";
import type { StockAlertItem, StockOverview } from "@/features/products/types";
import { StockHistoryDrawer } from "@/features/products/components/StockHistoryDrawer";
import { StockAdjustmentDialog } from "@/features/products/components/StockAdjustmentDialog";

function Loading() { return <div role="status" aria-busy="true" className="space-y-4"><div className="h-24 shimmer rounded-xl" /><div className="h-64 shimmer rounded-xl" /></div>; }

type TabKey = "out" | "low" | "all";

const SORT_KEYS: StockSortKey[] = ["inventory", "name", "updatedAt"];
const SORT_LABEL_KEYS: Record<StockSortKey, string> = { inventory: "stock_overview.sort_quantity", name: "stock_overview.sort_name", updatedAt: "stock_overview.sort_updated" };

function StockChip({ item }: { item: StockAlertItem }) {
  const tone = stockAlertTone(item);
  const classes = tone === "out" ? "bg-destructive/10 text-destructive ring-destructive/20" : tone === "low" ? "bg-amber-500/10 text-amber-600 ring-amber-500/20" : "bg-muted text-foreground ring-border/60";
  return <span className={`inline-flex h-9 min-w-12 items-center justify-center rounded-xl px-2.5 text-base font-semibold tabular-nums ring-1 ring-inset ${classes}`}>{item.inventory}</span>;
}

/** Status, SKU and last update — the three things a stock row is searched and sorted on. */
function StockMeta({ item }: { item: StockAlertItem }) {
  const t = useT("products");
  const locale = useLocale();
  const tone = stockAlertTone(item);
  const updated = formatStockDate(item.updatedAt, locale);
  return <p className="mt-0.5 flex items-center gap-1.5 truncate text-[11px] text-muted-foreground">
    <span className="truncate">{tone === "out" ? t("stock_overview.out_of_stock") : `${t("stock_overview.threshold_label")} ${item.lowStockThreshold}`}</span>
    {item.sku && <><span aria-hidden className="text-border">·</span><span className="truncate font-mono" dir="ltr">{item.sku}</span></>}
    {updated && <><span aria-hidden className="hidden text-border sm:inline">·</span><span className="hidden shrink-0 sm:inline">{t("stock_overview.updated_label")} {updated}</span></>}
  </p>;
}

function StockRow({ item, isVariant, onAdjust, onHistory }: { item: StockAlertItem; isVariant: boolean; onAdjust: (item: StockAlertItem) => void; onHistory: (item: StockAlertItem) => void }) {
  const t = useT("products");
  const tone = stockAlertTone(item);
  const stripeColor = tone === "out" ? "bg-destructive" : tone === "low" ? "bg-amber-500" : "bg-transparent";
  return <div className={`group relative flex min-h-16 items-center gap-3 overflow-hidden rounded-xl border bg-card px-3 py-2 ${tone === "out" ? "border-destructive/20" : tone === "low" ? "border-amber-500/20" : "border-border/60"} ${isVariant ? "min-h-14 bg-muted/20" : ""}`}>
    <span aria-hidden className={`absolute inset-y-2 start-0 w-[3px] rounded-full ${stripeColor}`} />
    <button type="button" onClick={() => onHistory(item)} className="flex min-w-0 flex-1 items-center gap-2.5 py-3 text-start">
      <div className="min-w-0 flex-1">
        <p className={`truncate font-semibold text-foreground ${isVariant ? "text-sm" : "text-sm"}`}>{isVariant ? item.variantLabel ?? item.productName : item.productName}</p>
        <StockMeta item={item} />
      </div>
    </button>
    <StockChip item={item} />
    <div className="flex shrink-0 items-center gap-1">
      <IconButton type="button" aria-label={t("actions.stock_history")} title={t("actions.stock_history")} onClick={() => onHistory(item)} className="hidden sm:grid"><History size={15} /></IconButton>
      <Button type="button" variant="secondary" onClick={() => onAdjust(item)} className="h-9 px-3 text-xs"><Pencil size={14} />{t("actions.adjust_stock")}</Button>
    </div>
  </div>;
}

function ProductGroupBlock({ group, onAdjust, onHistory }: { group: StockGroup; onAdjust: (item: StockAlertItem) => void; onHistory: (item: StockAlertItem) => void }) {
  const [open, setOpen] = useState(true);
  const hasMultiple = group.items.length > 1;
  if (!hasMultiple && !group.items[0].variantLabel) {
    return <StockRow item={group.items[0]} isVariant={false} onAdjust={onAdjust} onHistory={onHistory} />;
  }
  const totalInventory = stockGroupInventory(group);
  const groupTone = group.items.some((item) => item.isOutOfStock) ? "out" : group.items.some((item) => item.inventory <= item.lowStockThreshold) ? "low" : "ok";
  const stripeColor = groupTone === "out" ? "bg-destructive" : groupTone === "low" ? "bg-amber-500" : "bg-transparent";
  return <div className={`overflow-hidden rounded-xl border ${groupTone === "out" ? "border-destructive/20" : groupTone === "low" ? "border-amber-500/20" : "border-border/60"}`}>
    <button type="button" onClick={() => setOpen((current) => !current)} className={`relative flex w-full min-h-14 items-center gap-3 px-4 py-3 text-start transition-colors ${open ? "bg-muted/50" : "bg-muted/30 hover:bg-muted/50"}`}>
      <span aria-hidden className={`absolute inset-y-2 start-0 w-[3px] rounded-full ${stripeColor}`} />
      <div className="flex min-w-0 flex-1 flex-col"><span className="truncate text-sm font-semibold text-foreground">{group.productName}</span><span className="text-[11px] text-muted-foreground">{group.items.length} SKU</span></div>
      <span className="shrink-0 text-sm font-medium tabular-nums text-foreground">{totalInventory}</span>
      <span className={`shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} aria-hidden>▾</span>
    </button>
    {open && <div className="space-y-1.5 p-2">{group.items.map((item) => <StockRow key={`${item.productId}__${item.variantId ?? ""}`} item={item} isVariant onAdjust={onAdjust} onHistory={onHistory} />)}</div>}
  </div>;
}

function StockOverviewList() {
  const t = useT("products");
  const common = useT("common");
  const auth = useT("auth");
  const locale = useLocale();
  const identity = useIdentity();
  const [overview, setOverview] = useState<StockOverview | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("all");
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<StockSortKey>("inventory");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [adjustItem, setAdjustItem] = useState<StockAlertItem | null>(null);
  const [historyItem, setHistoryItem] = useState<StockAlertItem | null>(null);
  const deferredQuery = useDeferredValue(query);

  async function load() {
    setLoadError(null);
    try { setOverview(await getStockOverview()); } catch (cause) { setLoadError(cause); }
  }
  useEffect(() => { if (canScope(identity, SCOPES.PRODUCTS_READ)) void load(); }, [identity?.role, identity?.scopes.join(",")]);

  if (!canScope(identity, SCOPES.PRODUCTS_READ)) return <Alert role="alert" tone="critical">{auth("no_access")}</Alert>;
  if (loadError) return <Alert role="alert" tone="critical"><div className="flex-1"><p className="font-semibold">{t("error_load")}</p><button type="button" onClick={() => void load()} className="mt-3 text-xs font-semibold underline underline-offset-4">{common("retry")}</button></div></Alert>;
  if (overview === null) return <Loading />;

  const tabs = [
    { key: "all" as TabKey, label: t("stock_overview.tab_all"), count: undefined as number | undefined },
    { key: "low" as TabKey, label: t("stock_overview.tab_low"), count: overview.lowStockCount },
    { key: "out" as TabKey, label: t("stock_overview.tab_out"), count: overview.outOfStockCount },
  ];
  const rawRows = tab === "out" ? overview.outOfStockItems : tab === "low" ? overview.lowStockItems : overview.allItems ?? [];
  const matched = filterStockItems(rawRows, deferredQuery);
  const groups = sortStockGroups(groupStockByProduct(matched), sortKey, sortDirection);
  const searching = deferredQuery.trim() !== "";
  const emptyConfig = searching
    ? { title: common("no_results_found"), desc: t("stock_overview.empty_search_desc"), icon: <SearchX size={22} /> }
    : tab === "out"
      ? { title: t("stock_overview.empty_out"), desc: t("stock_overview.empty_out_desc"), icon: <XCircle size={22} /> }
      : tab === "low"
        ? { title: t("stock_overview.empty_low"), desc: t("stock_overview.empty_low_desc"), icon: <AlertTriangle size={22} /> }
        : { title: t("stock_overview.empty_all"), desc: t("stock_overview.empty_all_desc"), icon: <Package size={22} /> };
  const DirectionIcon = sortDirection === "asc" ? ArrowUp : ArrowDown;
  const directionLabel = sortDirection === "asc" ? t("stock_overview.sort_asc") : t("stock_overview.sort_desc");

  return <div className="space-y-5">
    {actionError && <Alert role="alert" tone="critical"><span className="flex-1">{actionError}</span><button type="button" onClick={() => setActionError(null)} aria-label={common("cancel")}><X size={16} /></button></Alert>}
    <StatGroup columns={4}><StatCard label={t("stock_overview.total_skus")} value={overview.totalSkus.toLocaleString(locale === "ar" ? "ar-DZ" : "en")} icon={<Package size={20} />} /><StatCard label={t("stock_overview.out_of_stock")} value={overview.outOfStockCount.toLocaleString(locale === "ar" ? "ar-DZ" : "en")} icon={<XCircle size={20} />} tone={overview.outOfStockCount > 0 ? "critical" : "neutral"} /><StatCard label={t("stock_overview.low_stock")} value={overview.lowStockCount.toLocaleString(locale === "ar" ? "ar-DZ" : "en")} icon={<AlertTriangle size={20} />} tone={overview.lowStockCount > 0 ? "warning" : "neutral"} /><StatCard label={t("stock_overview.stock_value")} value={formatMoneyValue(overview.totalInventoryValue, locale)} icon={<Wallet size={20} />} /></StatGroup>
    <Tabs label={t("stock_overview.page_title")} value={tab} onChange={setTab} items={tabs.map((item) => ({ key: item.key, label: item.label, count: item.count }))} />
    <div className="flex flex-wrap items-center gap-2">
      <SearchInput value={query} onChange={setQuery} placeholder={t("stock_overview.search_placeholder")} className="basis-full sm:basis-72" />
      <div className="flex shrink-0 items-center gap-1">
        <Select aria-label={t("stock_overview.sort_label")} value={sortKey} onChange={(event) => setSortKey(event.currentTarget.value as StockSortKey)} variant="pill" wrapperClassName="w-auto shrink-0" triggerClassName="w-auto max-w-56" prefix={<ArrowUpDown size={13} className="text-muted-foreground" />}>
          {SORT_KEYS.map((key) => <option key={key} value={key}>{t(SORT_LABEL_KEYS[key])}</option>)}
        </Select>
        <IconButton type="button" variant="ghost" size="sm" onClick={() => setSortDirection((current) => (current === "asc" ? "desc" : "asc"))} aria-label={directionLabel} title={directionLabel}><DirectionIcon size={15} /></IconButton>
      </div>
      <span className="shrink-0 text-xs font-medium text-muted-foreground" aria-live="polite">{matched.length.toLocaleString(locale === "ar" ? "ar-DZ" : "en")} {t("stock_overview.results_count")}</span>
    </div>
    {groups.length === 0 ? <EmptyState icon={emptyConfig.icon} title={emptyConfig.title} description={emptyConfig.desc} /> : <div className="space-y-2.5">{groups.map((group) => <ProductGroupBlock key={group.productId} group={group} onAdjust={setAdjustItem} onHistory={setHistoryItem} />)}</div>}
    {adjustItem && <StockAdjustmentDialog productId={adjustItem.productId} variantId={adjustItem.variantId} variantDisplayLabel={adjustItem.variantLabel} simpleInventory={adjustItem.inventory} onClose={() => setAdjustItem(null)} onSuccess={() => { setAdjustItem(null); void load(); }} />}
    {historyItem && <StockHistoryDrawer productId={historyItem.productId} variantId={historyItem.variantId ?? undefined} productName={historyItem.productName} variantLabel={historyItem.variantLabel} open onClose={() => setHistoryItem(null)} />}
  </div>;
}

function Gated() {
  const t = useT("products");
  return <DashboardChrome currentPath="/products/stock"><PageHeader title={t("stock_overview.page_title")} /><StockOverviewList /></DashboardChrome>;
}

export default function StockOverviewPageApp() { return <RequireAuth><Gated /></RequireAuth>; }
