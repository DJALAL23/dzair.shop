import { useDeferredValue, useEffect, useState } from "react";
import { Package, Plus, X } from "lucide-react";
import { canScope, useIdentity } from "@/features/auth/components/RequireAuth";
import {
  Alert,
  Button,
  Card,
  EmptyState,
  LinkButton,
  Pagination,
  SearchInput,
  Select,
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
  SortHeader,
  useConfirmDialog,
} from "@/components/ui";
import { useT } from "@/i18n/react";
import { notify } from "@/lib/notify";
import { SCOPES } from "../../../../../cod-shared/rbac/scopes";
import {
  deleteProduct,
  listAllProducts,
  listProductGroups,
} from "@/features/products/api";
import {
  filterProducts,
  paginateProducts,
  productErrorMessage,
  sortProducts,
  type ProductFilters,
  type ProductSortKey,
} from "@/features/products/model";
import type {
  Product,
  ProductCategory,
  ProductStatus,
} from "@/features/products/types";
import { ProductDesktopRow, ProductMobileCard } from "@/features/products/components/ProductRow";

const EMPTY_FILTERS: ProductFilters = {
  query: "",
  category: "all",
  status: "all",
};
const STATUS_OPTIONS: ProductStatus[] = ["ACTIVE", "DRAFT", "ARCHIVED"];
const PAGE_SIZE = 10;

function ProductSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      className="overflow-hidden rounded-xl bg-card shadow-card"
    >
      <div className="h-14 border-b border-border bg-muted/35" />
      {Array.from({ length: 7 }).map((_, index) => (
        <div
          key={index}
          className="grid h-16 grid-cols-[1.5fr_0.8fr_0.8fr_0.6fr_0.6fr_0.6fr] items-center gap-4 border-b border-border px-4 last:border-0"
        >
          <div className="h-3 w-32 shimmer rounded" />
          <div className="h-3 w-20 shimmer rounded" />
          <div className="h-3 w-16 shimmer rounded" />
          <div className="h-3 w-14 shimmer rounded" />
          <div className="h-3 w-14 shimmer rounded" />
          <span className="h-6 w-20 justify-self-end shimmer rounded-lg" />
        </div>
      ))}
    </div>
  );
}

export function ProductsList() {
  const t = useT("products");
  const common = useT("common");
  const auth = useT("auth");
  const identity = useIdentity();
  const confirm = useConfirmDialog();
  const [products, setProducts] = useState<Product[] | null>(null);
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [filters, setFilters] = useState<ProductFilters>(EMPTY_FILTERS);
  const [sortKey, setSortKey] = useState<ProductSortKey>("createdAt");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const deferredFilters = useDeferredValue(filters);

  async function load() {
    setLoadError(null);
    try {
      const [nextProducts, nextCategories] = await Promise.all([
        listAllProducts(),
        listProductGroups().catch(() => []),
      ]);
      setProducts(nextProducts);
      setCategories(nextCategories);
    } catch (cause) {
      setLoadError(cause);
    }
  }

  useEffect(() => {
    if (canScope(identity, SCOPES.PRODUCTS_READ)) void load();
  }, [identity?.role, identity?.scopes.join(",")]);
  useEffect(() => {
    setPage(1);
  }, [deferredFilters, sortKey, sortDirection]);

  if (!canScope(identity, SCOPES.PRODUCTS_READ))
    return (
      <Alert role="alert" tone="critical">
        {auth("no_access")}
      </Alert>
    );
  if (loadError)
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
  if (products === null) return <ProductSkeleton />;

  const categoryMap = new Map(
    categories.map((category) => [category.id, category]),
  );
  const filtered = filterProducts(products, deferredFilters);
  const sorted = sortProducts(filtered, sortKey, sortDirection);
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const visible = paginateProducts(sorted, safePage, PAGE_SIZE);
  const hasFilters =
    filters.query.trim() !== "" ||
    filters.category !== "all" ||
    filters.status !== "all";
  const canManage = canScope(identity, SCOPES.PRODUCTS_MANAGE);
  const canCreate = canScope(identity, SCOPES.PRODUCTS_CREATE);

  function onSort(key: string) {
    const cast = key as ProductSortKey;
    if (sortKey === cast)
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
    else {
      setSortKey(cast);
      setSortDirection("asc");
    }
  }
  async function onDelete(product: Product) {
    if (
      !(await confirm({
        title: common("confirm_delete_title", { name: product.name }),
        description: common("delete_description"),
        confirmLabel: common("delete"),
        tone: "danger",
      }))
    )
      return;
    try {
      await deleteProduct(product.id);
      setProducts(
        (current) =>
          current?.filter((item) => item.id !== product.id) ?? current,
      );
      notify.success(t("success_deleted"));
    } catch (cause) {
      const message = productErrorMessage(cause, t);
      setActionError(message);
      notify.error(message);
    }
  }

  const rowProps = {
    categoryMap,
    canManage,
    onDelete,
  };

  return (
    <div className="space-y-3">
      {actionError && (
        <Alert role="alert" tone="critical">
          <span className="flex-1">{actionError}</span>
          <button
            type="button"
            onClick={() => setActionError(null)}
            aria-label={common("cancel")}
          >
            <X size={16} />
          </button>
        </Alert>
      )}
      <Card flush>
        <div className="flex flex-wrap items-center gap-2 p-2">
          <div className="contents">
            <SearchInput
              value={filters.query}
              onChange={(query) =>
                setFilters((current) => ({ ...current, query }))
              }
              placeholder={t("search_placeholder")}
              className="basis-full sm:basis-72"
            />
            <span className="order-last ms-auto shrink-0 px-1 text-xs tabular-nums text-muted-foreground">{t("count", { count: filtered.length })}</span>
          </div>
          <div className="contents">
            <Select
              aria-label={t("filters.group")}
              value={filters.category}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  category: event.currentTarget.value,
                }))
              }
              variant="pill"
              wrapperClassName="w-auto shrink-0"
              triggerClassName="w-auto max-w-56"
            >
              <option value="all">{t("filters.group")}</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </Select>
            <Select
              aria-label={t("filters.availability")}
              value={filters.status}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  status: event.currentTarget.value as ProductStatus | "all",
                }))
              }
              variant="pill"
              wrapperClassName="w-auto shrink-0"
              triggerClassName="w-auto max-w-56"
            >
              <option value="all">{t("filters.availability")}</option>
              {STATUS_OPTIONS.map((status) => (
                <option key={status} value={status}>
                  {t(`status_options.${status.toLocaleLowerCase()}`)}
                </option>
              ))}
            </Select>
            {hasFilters && (
              <Button
                type="button"
                variant="ghost" size="sm"
                onClick={() => setFilters(EMPTY_FILTERS)}
              >
                {common("clear_filters")}
              </Button>
            )}
          </div>
        </div>
        {sorted.length === 0 ? (
          <EmptyState
            icon={<Package />}
            title={
              hasFilters ? common("no_results_found") : t("empty_state.title")
            }
            description={hasFilters ? undefined : t("empty_state.description")}
            action={
              !hasFilters && canCreate ? (
                <LinkButton href="/products/new">
                  <Plus size={16} />
                  {t("empty_state.action")}
                </LinkButton>
              ) : undefined
            }
          />
        ) : (
          <>
            <div className="divide-y divide-border border-t border-border md:hidden">
              {visible.map((product) => (
                <ProductMobileCard key={product.id} product={product} {...rowProps} />
              ))}
            </div>
            <div className="hidden overflow-x-auto md:block">
              <Table className="min-w-[720px]">
                <TableHeader>
                  <TableRow>
                    <SortHeader
                      label={t("table.name")}
                      sortKey="name"
                      activeKey={sortKey}
                      direction={sortDirection}
                      onSort={onSort}
                    />
                    <TableHead>{t("table.status")}</TableHead>
                    <TableHead>{t("table.group")}</TableHead>
                    <SortHeader
                      label={t("table.stock")}
                      sortKey="totalInventory"
                      activeKey={sortKey}
                      direction={sortDirection}
                      onSort={onSort}
                      align="end"
                    />
                    <SortHeader
                      label={t("table.price")}
                      sortKey="price"
                      activeKey={sortKey}
                      direction={sortDirection}
                      onSort={onSort}
                      align="end"
                    />
                    <TableHead className="w-px">
                      <span className="sr-only">{common("table.actions")}</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((product) => (
                    <ProductDesktopRow key={product.id} product={product} {...rowProps} />
                  ))}
                </TableBody>
              </Table>
            </div>
            <Pagination
              page={safePage}
              totalPages={totalPages}
              total={sorted.length}
              pageSize={PAGE_SIZE}
              onPageChange={setPage}
            />
          </>
        )}
      </Card>
    </div>
  );
}
