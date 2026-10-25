import { useDeferredValue, useEffect, useState } from "react";
import { AlertTriangle, History, Package, Pencil, SearchX, Wallet, X, XCircle } from "lucide-react";
import { canScope, RequireAuth, useIdentity } from "@/features/auth/components/RequireAuth";
import { DashboardPage } from "@/components/layout/page";
import {
  Alert,
  Badge,
  Card,
  CellEmpty,
  EmptyState,
  IconButton,
  PageHeader,
  Pagination,
  RowActions,
  RowTitle,
  SearchInput,
  SortHeader,
  StatCard,
  StatGroup,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  openRowOnClick,
} from "@/components/ui";
import { useLocale, useT } from "@/i18n/react";
import { SCOPES } from "../../../../../cod-shared/rbac/scopes";
import { getStockOverview } from "@/features/products/api";
import { filterStockItems, formatMoneyValue, formatStockDate, sortStockItems, stockAlertTone, type StockSortKey } from "@/features/products/model";
import type { StockAlertItem, StockOverview } from "@/features/products/types";
import { StockHistoryDrawer } from "@/features/products/components/StockHistoryDrawer";
import { StockAdjustmentDialog } from "@/features/products/components/StockAdjustmentDialog";

type TabKey = "out" | "low" | "all";

const PAGE_SIZE = 20;

function Loading() {
  return (
    <div role="status" aria-busy="true" className="space-y-4">
      <div className="h-24 shimmer rounded-xl" />
      <div className="overflow-hidden rounded-xl bg-card shadow-card">
        {Array.from({ length: 7 }).map((_, index) => (
          <div key={index} className="h-14 border-b border-border px-4 py-4 last:border-0"><div className="h-3 w-40 shimmer rounded" /></div>
        ))}
      </div>
    </div>
  );
}

function StockStatus({ item }: { item: StockAlertItem }) {
  const t = useT("products");
  const tone = stockAlertTone(item);
  if (tone === "out") return <Badge tone="critical">{t("stock_overview.out_of_stock")}</Badge>;
  if (tone === "low") return <Badge tone="warning">{t("stock_overview.low_stock")}</Badge>;
  return <Badge tone="success">{t("stock.in_stock")}</Badge>;
}

function productHref(item: StockAlertItem) {
  return `/products/${encodeURIComponent(item.productId)}`;
}

interface RowProps {
  item: StockAlertItem;
  onAdjust: (item: StockAlertItem) => void;
  onHistory: (item: StockAlertItem) => void;
}

function StockActions({ item, onAdjust, onHistory }: RowProps) {
  const t = useT("products");
  return (
    <RowActions>
      <IconButton type="button" aria-label={t("actions.stock_history")} title={t("actions.stock_history")} onClick={() => onHistory(item)}>
        <History size={15} aria-hidden="true" />
      </IconButton>
      <IconButton type="button" aria-label={t("actions.adjust_stock")} title={t("actions.adjust_stock")} onClick={() => onAdjust(item)}>
        <Pencil size={15} aria-hidden="true" />
      </IconButton>
    </RowActions>
  );
}

function StockDesktopRow({ item, onAdjust, onHistory }: RowProps) {
  const locale = useLocale();
  const updated = formatStockDate(item.updatedAt, locale);
  return (
    <TableRow onClick={openRowOnClick(productHref(item))} className="cursor-pointer">
      <TableCell className="max-w-80">
        <RowTitle href={productHref(item)}>{item.productName}</RowTitle>
        {item.variantLabel && <span className="block truncate text-xs text-muted-foreground">{item.variantLabel}</span>}
      </TableCell>
      <TableCell className="font-mono text-xs text-muted-foreground" dir="ltr">{item.sku ?? <CellEmpty />}</TableCell>
      <TableCell><StockStatus item={item} /></TableCell>
      <TableCell numeric>{item.lowStockThreshold}</TableCell>
      <TableCell numeric className="font-medium">{item.inventory}</TableCell>
      <TableCell className="whitespace-nowrap text-muted-foreground">{updated ?? <CellEmpty />}</TableCell>
      <TableCell className="w-px"><StockActions item={item} onAdjust={onAdjust} onHistory={onHistory} /></TableCell>
    </TableRow>
  );
}

function StockMobileRow({ item, onAdjust, onHistory }: RowProps) {
  const detail = [item.variantLabel, item.sku].filter(Boolean).join(" · ");
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <a href={productHref(item)} className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">{item.productName}</span>
        {detail && <span className="block truncate text-xs text-muted-foreground">{detail}</span>}
        <span className="mt-1 block"><StockStatus item={item} /></span>
      </a>
      <span className="shrink-0 text-lg font-semibold tabular-nums text-foreground">{item.inventory}</span>
      <StockActions item={item} onAdjust={onAdjust} onHistory={onHistory} />
    </div>
  );
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
  const [page, setPage] = useState(1);
  const [adjustItem, setAdjustItem] = useState<StockAlertItem | null>(null);
  const [historyItem, setHistoryItem] = useState<StockAlertItem | null>(null);
  const deferredQuery = useDeferredValue(query);

  async function load() {
    setLoadError(null);
    try { setOverview(await getStockOverview()); } catch (cause) { setLoadError(cause); }
  }
  useEffect(() => { if (canScope(identity, SCOPES.PRODUCTS_READ)) void load(); }, [identity?.role, identity?.scopes.join(",")]);
  useEffect(() => { setPage(1); }, [tab, deferredQuery, sortKey, sortDirection]);

  if (!canScope(identity, SCOPES.PRODUCTS_READ)) return <Alert role="alert" tone="critical">{auth("no_access")}</Alert>;
  if (loadError) return <Alert role="alert" tone="critical"><div className="flex-1"><p className="font-semibold">{t("error_load")}</p><button type="button" onClick={() => void load()} className="mt-3 text-xs font-semibold underline underline-offset-4">{common("retry")}</button></div></Alert>;
  if (overview === null) return <Loading />;

  const number = (value: number) => value.toLocaleString(locale === "ar" ? "ar-DZ" : "en");
  const tabs = [
    { key: "all" as TabKey, label: t("stock_overview.tab_all"), count: undefined as number | undefined },
    { key: "low" as TabKey, label: t("stock_overview.tab_low"), count: overview.lowStockCount },
    { key: "out" as TabKey, label: t("stock_overview.tab_out"), count: overview.outOfStockCount },
  ];
  const rawRows = tab === "out" ? overview.outOfStockItems : tab === "low" ? overview.lowStockItems : overview.allItems ?? [];
  const matched = filterStockItems(rawRows, deferredQuery);
  const sorted = sortStockItems(matched, sortKey, sortDirection);
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const visible = sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const searching = deferredQuery.trim() !== "";
  const emptyConfig = searching
    ? { title: common("no_results_found"), desc: t("stock_overview.empty_search_desc"), icon: <SearchX size={22} /> }
    : tab === "out"
      ? { title: t("stock_overview.empty_out"), desc: t("stock_overview.empty_out_desc"), icon: <XCircle size={22} /> }
      : tab === "low"
        ? { title: t("stock_overview.empty_low"), desc: t("stock_overview.empty_low_desc"), icon: <AlertTriangle size={22} /> }
        : { title: t("stock_overview.empty_all"), desc: t("stock_overview.empty_all_desc"), icon: <Package size={22} /> };

  function onSort(key: string) {
    const next = key as StockSortKey;
    if (sortKey === next) setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
    else { setSortKey(next); setSortDirection("asc"); }
  }

  return (
    <div className="space-y-5">
      {actionError && <Alert role="alert" tone="critical"><span className="flex-1">{actionError}</span><button type="button" onClick={() => setActionError(null)} aria-label={common("cancel")}><X size={16} /></button></Alert>}
      <StatGroup columns={4}>
        <StatCard label={t("stock_overview.total_skus")} value={number(overview.totalSkus)} icon={<Package size={20} />} />
        <StatCard label={t("stock_overview.out_of_stock")} value={number(overview.outOfStockCount)} icon={<XCircle size={20} />} tone={overview.outOfStockCount > 0 ? "critical" : "neutral"} />
        <StatCard label={t("stock_overview.low_stock")} value={number(overview.lowStockCount)} icon={<AlertTriangle size={20} />} tone={overview.lowStockCount > 0 ? "warning" : "neutral"} />
        <StatCard label={t("stock_overview.stock_value")} value={formatMoneyValue(overview.totalInventoryValue, locale)} icon={<Wallet size={20} />} />
      </StatGroup>
      <Card flush>
        <div className="space-y-2 p-2">
          <Tabs label={t("stock_overview.page_title")} value={tab} onChange={setTab} items={tabs.map((item) => ({ key: item.key, label: item.label, count: item.count }))} />
          <div className="flex flex-wrap items-center gap-2">
            <SearchInput value={query} onChange={setQuery} placeholder={t("stock_overview.search_placeholder")} className="basis-full sm:basis-72" />
            <span className="ms-auto shrink-0 px-1 text-xs tabular-nums text-muted-foreground" aria-live="polite">{number(matched.length)} {t("stock_overview.results_count")}</span>
          </div>
        </div>
        {sorted.length === 0 ? (
          <EmptyState icon={emptyConfig.icon} title={emptyConfig.title} description={emptyConfig.desc} />
        ) : (
          <>
            <div className="divide-y divide-border border-t border-border md:hidden">
              {visible.map((item) => <StockMobileRow key={`${item.productId}__${item.variantId ?? ""}`} item={item} onAdjust={setAdjustItem} onHistory={setHistoryItem} />)}
            </div>
            <div className="hidden overflow-x-auto md:block">
              <Table className="min-w-[760px]">
                <TableHeader>
                  <TableRow>
                    <SortHeader label={t("stock_overview.col_product")} sortKey="name" activeKey={sortKey} direction={sortDirection} onSort={onSort} />
                    <TableHead>{t("form.variant_sku")}</TableHead>
                    <TableHead>{t("table.status")}</TableHead>
                    <TableHead numeric>{t("stock_overview.col_threshold")}</TableHead>
                    <SortHeader label={t("stock_overview.col_stock")} sortKey="inventory" activeKey={sortKey} direction={sortDirection} onSort={onSort} align="end" />
                    <SortHeader label={t("stock_overview.updated_label")} sortKey="updatedAt" activeKey={sortKey} direction={sortDirection} onSort={onSort} />
                    <TableHead className="w-px"><span className="sr-only">{common("table.actions")}</span></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((item) => <StockDesktopRow key={`${item.productId}__${item.variantId ?? ""}`} item={item} onAdjust={setAdjustItem} onHistory={setHistoryItem} />)}
                </TableBody>
              </Table>
            </div>
            <Pagination page={safePage} totalPages={totalPages} total={sorted.length} pageSize={PAGE_SIZE} onPageChange={setPage} />
          </>
        )}
      </Card>
      {adjustItem && <StockAdjustmentDialog productId={adjustItem.productId} variantId={adjustItem.variantId} variantDisplayLabel={adjustItem.variantLabel} simpleInventory={adjustItem.inventory} onClose={() => setAdjustItem(null)} onSuccess={() => { setAdjustItem(null); void load(); }} />}
      {historyItem && <StockHistoryDrawer productId={historyItem.productId} variantId={historyItem.variantId ?? undefined} productName={historyItem.productName} variantLabel={historyItem.variantLabel} open onClose={() => setHistoryItem(null)} />}
    </div>
  );
}

function Gated() {
  const t = useT("products");
  return <DashboardPage><PageHeader title={t("stock_overview.page_title")} /><StockOverviewList /></DashboardPage>;
}

export default function StockOverviewPageApp() { return <RequireAuth><Gated /></RequireAuth>; }
