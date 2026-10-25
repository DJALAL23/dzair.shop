import { useEffect, useState } from "react";
import {
  CheckCircle2,
  Inbox,
  PackageX,
  RefreshCw,
  Trash2,
  TrendingUp,
  Wallet,
  X,
} from "lucide-react";
import {
  canScope,
  RequireAuth,
  useIdentity,
} from "@/features/auth/components/RequireAuth";
import { DashboardPage } from "@/components/layout/page";
import {
  deleteAbandonedOrder,
  getAbandonedStats,
  listAbandonedOrders,
  updateAbandonedStatus,
} from "@/features/orders/api";
import {
  abandonedBasketView,
  abandonedStatusOptions,
  filterAbandonedOrders,
  formatMoney,
} from "@/features/orders/model";
import type {
  AbandonedOrder,
  AbandonedOrderStatus,
  AbandonedStats,
} from "@/features/orders/types";
import {
  Alert,
  Badge,
  Button,
  Card,
  CellEmpty,
  EmptyState,
  IconButton,
  PageHeader,
  RowActions,
  Pagination,
  SearchInput,
  FilterPill,
  ListToolbar,
  Select,
  StatCard,
  StatGroup,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  useConfirmDialog,
} from "@/components/ui";
import { useLocale, useT } from "@/i18n/react";
import { notify } from "@/lib/notify";

const STATUS_TONE: Record<
  AbandonedOrderStatus,
  "neutral" | "warning" | "info" | "success"
> = {
  pending: "neutral",
  abandoned: "warning",
  contacted: "info",
  converted: "success",
};

const STATUS_PILL: Record<AbandonedOrderStatus, string> = {
  pending:
    "bg-[var(--tone-neutral-bg)] text-[var(--tone-neutral-text)] border-[var(--tone-neutral-border)]",
  abandoned:
    "bg-[var(--tone-warning-bg)] text-[var(--tone-warning-text)] border-[var(--tone-warning-border)]",
  contacted:
    "bg-[var(--tone-info-bg)] text-[var(--tone-info-text)] border-[var(--tone-info-border)]",
  converted:
    "bg-[var(--tone-success-bg)] text-[var(--tone-success-text)] border-[var(--tone-success-border)]",
};

function formatDate(value: string, locale: "ar" | "en" | "fr"): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
    new Date(value),
  );
}

function StatusControl({
  row,
  busy,
  onChange,
}: {
  row: AbandonedOrder;
  busy: boolean;
  onChange: (status: AbandonedOrderStatus) => void;
}) {
  const t = useT("orders");
  const identity = useIdentity();
  const canManage = canScope(identity, "abandoned_orders:manage");
  const options = abandonedStatusOptions(row.status);

  if (!canManage || options.length === 1) {
    const badge = <Badge tone={STATUS_TONE[row.status]}>{t(`abandoned.status.${row.status}`)}</Badge>;
    if (!row.convertedOrderId || !row.convertedOrderNumber) return badge;
    const label = t("abandoned.recovered_order", { number: row.convertedOrderNumber });
    return (
      <a href={`/orders/${row.convertedOrderId}`} aria-label={label} title={label} className="rounded-full hover:opacity-80">
        {badge}
      </a>
    );
  }

  return (
    <Select
      aria-label={t(`abandoned.status.${row.status}`)}
      value={row.status}
      disabled={busy}
      onChange={(event) =>
        onChange(event.currentTarget.value as AbandonedOrderStatus)
      }
      variant="pill"
      wrapperClassName="inline-flex"
      triggerClassName={`max-w-40 ${STATUS_PILL[row.status]}`}
    >
      {options.map((status) => (
        <option key={status} value={status}>
          {t(`abandoned.status.${status}`)}
        </option>
      ))}
    </Select>
  );
}

/**
 * What the shopper was buying.
 *
 * The whole basket is listed, not a summary: this list exists so a merchant
 * can pick up the phone and say what the customer had, and "Hoodie and 2 more"
 * makes them open a row before they can have that conversation.
 *
 * A single-product record has no basket and renders exactly as it always did —
 * the flat product columns are still filled for basket rows too, so nothing
 * here depends on which shape a record is.
 */
function AbandonedBasket({ row }: { row: AbandonedOrder }) {
  const view = abandonedBasketView(row);
  if (view.kind === "unknown") return <CellEmpty />;
  const lines =
    view.kind === "product"
      ? [{ key: "product", quantity: null, productName: view.productName, variantLabel: view.variantLabel }]
      : view.lines;
  return (
    <ul className="min-w-0 space-y-0.5">
      {lines.map((line) => (
        <li key={line.key} className="flex min-w-0 items-baseline gap-1.5 text-sm">
          {line.quantity !== null && (
            <span className="shrink-0 tabular-nums text-muted-foreground">{line.quantity}×</span>
          )}
          <span className="truncate text-foreground">{line.productName}</span>
          {line.variantLabel && <span className="shrink-0 text-muted-foreground">· {line.variantLabel}</span>}
        </li>
      ))}
    </ul>
  );
}

function AbandonedDesktopRow({
  row,
  busy,
  onStatusChange,
  onDelete,
}: {
  row: AbandonedOrder;
  busy: boolean;
  onStatusChange: (row: AbandonedOrder, status: AbandonedOrderStatus) => void;
  onDelete: (row: AbandonedOrder) => void;
}) {
  const common = useT("common");
  const locale = useLocale();
  const identity = useIdentity();
  const canManage = canScope(identity, "abandoned_orders:manage");

  return (
    <TableRow>
      <TableCell className="max-w-56 truncate font-medium">{row.customerName}</TableCell>
      <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
        <span dir="ltr">{row.phone}</span>
      </TableCell>
      <TableCell className="max-w-[22rem]">
        <AbandonedBasket row={row} />
      </TableCell>
      <TableCell numeric>{formatMoney(row.price, locale)}</TableCell>
      <TableCell>
        <StatusControl row={row} busy={busy} onChange={(status) => onStatusChange(row, status)} />
      </TableCell>
      <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(row.createdAt, locale)}</TableCell>
      <TableCell className="w-px">
        {canManage && (
          <RowActions>
            <IconButton
              type="button"
              variant="danger"
              onClick={() => onDelete(row)}
              disabled={busy}
              aria-label={common("delete")}
              title={common("delete")}
            >
              <Trash2 size={15} />
            </IconButton>
          </RowActions>
        )}
      </TableCell>
    </TableRow>
  );
}

function AbandonedMobileCard({
  row,
  busy,
  onStatusChange,
  onDelete,
}: {
  row: AbandonedOrder;
  busy: boolean;
  onStatusChange: (row: AbandonedOrder, status: AbandonedOrderStatus) => void;
  onDelete: (row: AbandonedOrder) => void;
}) {
  const common = useT("common");
  const locale = useLocale();
  const identity = useIdentity();
  const canManage = canScope(identity, "abandoned_orders:manage");

  return (
    <article className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">
            {row.customerName}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground" dir="ltr">
            {row.phone}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <StatusControl row={row} busy={busy} onChange={(status) => onStatusChange(row, status)} />
          {canManage && (
            <IconButton
              type="button"
              variant="danger"
              onClick={() => onDelete(row)}
              disabled={busy}
              aria-label={common("delete")}
              title={common("delete")}
            >
              <Trash2 size={16} />
            </IconButton>
          )}
        </div>
      </div>

      <div className="mt-3 flex items-end justify-between gap-3">
        <AbandonedBasket row={row} />
        <span className="shrink-0 text-sm font-medium tabular-nums text-foreground">
          {formatMoney(row.price, locale)}
        </span>
      </div>

      <p className="mt-2 text-xs text-muted-foreground">{formatDate(row.createdAt, locale)}</p>
    </article>
  );
}

function AbandonedSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      className="overflow-hidden rounded-xl bg-card shadow-card"
    >
      <div className="h-14 border-b border-border bg-muted/35" />
      {Array.from({ length: 6 }).map((_, index) => (
        <div
          key={index}
          className="grid h-14 grid-cols-[1.2fr_1fr_1fr_0.6fr_0.8fr] items-center gap-4 border-b border-border px-4 last:border-0"
        >
          <div className="h-3 w-28 shimmer rounded" />
          <div className="h-3 w-24 shimmer rounded" />
          <div className="h-3 w-32 shimmer rounded" />
          <div className="h-3 w-16 justify-self-end shimmer rounded" />
          <span className="h-6 w-20 justify-self-end shimmer rounded-full" />
        </div>
      ))}
    </div>
  );
}

function AbandonedOrdersView() {
  const identity = useIdentity();
  const t = useT("orders");
  const common = useT("common");
  const auth = useT("auth");
  const locale = useLocale();
  const confirm = useConfirmDialog();
  const [stats, setStats] = useState<AbandonedStats | null>(null);
  const [rows, setRows] = useState<AbandonedOrder[] | null>(null);
  const [loadError, setLoadError] = useState<Error | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const pageSize = 10;

  async function load() {
    if (!canScope(identity, "abandoned_orders:read")) return;
    setLoadError(null);
    try {
      const [nextStats, listResponse] = await Promise.all([
        getAbandonedStats(),
        listAbandonedOrders({ limit: 100, offset: 0 }),
      ]);
      setStats(nextStats);
      setRows(listResponse.data ?? []);
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause : new Error(String(cause)));
    }
  }

  useEffect(() => {
    void load();
  }, [identity?.role, identity?.scopes.join(",")]);

  useEffect(() => {
    setPage(1);
  }, [query, status]);

  async function changeStatus(row: AbandonedOrder, next: AbandonedOrderStatus) {
    if (next === row.status) return;
    setBusyId(row.id);
    setActionError(null);
    try {
      await updateAbandonedStatus(row.id, next);
    } catch (cause) {
      setActionError(
        cause instanceof Error ? cause.message : String(cause),
      );
      notify.error(common("feedback.action_failed"));
      setBusyId(null);
      return;
    }
    notify.success(common("feedback.updated"));
    try {
      await load();
    } catch (cause) {
      setActionError(
        cause instanceof Error ? cause.message : String(cause),
      );
    } finally {
      setBusyId(null);
    }
  }

  async function remove(row: AbandonedOrder) {
    const accepted = await confirm({
      title: common("confirm_delete_title"),
      description: common("delete_description"),
      confirmLabel: common("delete"),
      tone: "danger",
    });
    if (!accepted) return;
    setBusyId(row.id);
    setActionError(null);
    try {
      await deleteAbandonedOrder(row.id);
    } catch (cause) {
      setActionError(
        cause instanceof Error ? cause.message : String(cause),
      );
      notify.error(common("feedback.action_failed"));
      setBusyId(null);
      return;
    }
    notify.success(common("feedback.deleted"));
    try {
      await load();
    } catch (cause) {
      setActionError(
        cause instanceof Error ? cause.message : String(cause),
      );
    } finally {
      setBusyId(null);
    }
  }

  const header = (
    <PageHeader
      title={t("abandoned.title")}
      subtitle={t("abandoned.subtitle")}
    />
  );

  if (!canScope(identity, "abandoned_orders:read")) {
    return (
      <div>
        {header}
        <Alert role="alert" tone="critical">
          {auth("no_access")}
        </Alert>
      </div>
    );
  }

  if (loadError) {
    return (
      <div>
        {header}
        <Alert role="alert" tone="critical">
          <div>
            <p className="font-semibold">{t("abandoned.load_error")}</p>
            <p className="mt-1 text-xs opacity-80">{loadError.message}</p>
            <button
              type="button"
              onClick={() => void load()}
              className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold underline underline-offset-4"
            >
              <RefreshCw size={13} />
              {common("retry")}
            </button>
          </div>
        </Alert>
      </div>
    );
  }

  if (stats === null || rows === null) {
    return (
      <div>
        {header}
        <div role="status" aria-busy="true" className="space-y-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <div
                key={index}
                className="h-[88px] shimmer rounded-xl shadow-card"
              />
            ))}
          </div>
          <AbandonedSkeleton />
        </div>
      </div>
    );
  }

  const filtered = filterAbandonedOrders(rows, { query, status });
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  const hasFilters = query.trim() !== "" || status !== "all";

  return (
    <div className="space-y-5">
      {header}

      {actionError && (
        <Alert role="alert" tone="critical">
          <div className="flex-1">{actionError}</div>
          <button
            type="button"
            onClick={() => setActionError(null)}
            aria-label={common("cancel")}
          >
            <X size={16} />
          </button>
        </Alert>
      )}

      <StatGroup columns={4}>
        <StatCard
          label={t("abandoned.stats.abandoned")}
          value={stats.totalAbandoned.toLocaleString(locale)}
          tone="warning"
          icon={<PackageX size={20} />}
        />
        <StatCard
          label={t("abandoned.stats.recovered")}
          value={stats.totalConverted.toLocaleString(locale)}
          tone="success"
          icon={<CheckCircle2 size={20} />}
        />
        <StatCard
          label={t("abandoned.stats.conversion_rate")}
          value={`${stats.conversionRate}%`}
          icon={<TrendingUp size={20} />}
        />
        <StatCard
          label={t("abandoned.stats.lost_revenue")}
          value={formatMoney(stats.estimatedLostRevenue, locale)}
          tone="critical"
          icon={<Wallet size={20} />}
        />
      </StatGroup>

      <Card flush>
        <ListToolbar count={t("abandoned.count_label", { count: filtered.length })}>
          <SearchInput value={query} onChange={setQuery} placeholder={t("abandoned.search_placeholder")} className="basis-full sm:basis-72" />
          <FilterPill label={t("abandoned.status_label")} value={status} onChange={setStatus}>
            <option value="all">{t("abandoned.status_label")}</option>
            {(["pending", "abandoned", "contacted", "converted"] as const).map((value) => (
              <option key={value} value={value}>
                {t(`abandoned.status.${value}`)}
              </option>
            ))}
          </FilterPill>
          {hasFilters && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setQuery("");
                setStatus("all");
              }}
            >
              {common("clear_filters")}
            </Button>
          )}
        </ListToolbar>

        {filtered.length === 0 ? (
          <EmptyState
            icon={<Inbox size={22} />}
            title={
              hasFilters
                ? common("no_results_found")
                : t("abandoned.empty.title")
            }
            description={hasFilters ? undefined : t("abandoned.empty.description")}
          />
        ) : (
          <>
            <div className="divide-y divide-border md:hidden">
              {visible.map((row) => (
                <AbandonedMobileCard
                  key={row.id}
                  row={row}
                  busy={busyId === row.id}
                  onStatusChange={changeStatus}
                  onDelete={remove}
                />
              ))}
            </div>

            <div className="hidden overflow-x-auto md:block">
              <Table className="min-w-[880px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("table.customer")}</TableHead>
                    <TableHead>{t("table.phone")}</TableHead>
                    <TableHead>{t("abandoned.table.product")}</TableHead>
                    <TableHead numeric>{t("abandoned.table.basket")}</TableHead>
                    <TableHead>{t("table.status")}</TableHead>
                    <TableHead>{t("table.date")}</TableHead>
                    <TableHead className="w-px">
                      <span className="sr-only">{common("table.actions")}</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((row) => (
                    <AbandonedDesktopRow
                      key={row.id}
                      row={row}
                      busy={busyId === row.id}
                      onStatusChange={changeStatus}
                      onDelete={remove}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>

            <Pagination
              page={safePage}
              totalPages={totalPages}
              total={filtered.length}
              pageSize={pageSize}
              onPageChange={setPage}
            />
          </>
        )}
      </Card>
    </div>
  );
}

export default function AbandonedOrdersPageApp() {
  return (
    <RequireAuth>
      <DashboardPage>
        <AbandonedOrdersView />
      </DashboardPage>
    </RequireAuth>
  );
}
