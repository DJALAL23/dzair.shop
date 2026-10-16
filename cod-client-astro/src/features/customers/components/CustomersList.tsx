import { useDeferredValue, useEffect, useState } from "react";
import { Plus, Users, X } from "lucide-react";
import {
  canScope,
  useIdentity,
} from "@/features/auth/components/RequireAuth";
import { useT } from "@/i18n/react";
import { notify } from "@/lib/notify";
import { SCOPES } from "../../../../../cod-shared/rbac/scopes";
import { deleteCustomer, listAllCustomers } from "@/features/customers/api";
import {
  customerCanDelete,
  customerErrorMessage,
  filterCustomers,
  paginateCustomers,
  sortCustomers,
  type CustomerFilters,
  type CustomerSortKey,
} from "@/features/customers/model";
import type { Customer } from "@/features/customers/types";
import {
  Button,
  EmptyState,
  LinkButton,
  Alert,
  Card,
  FilterPill,
  ListToolbar,
  TableSkeleton,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  useConfirmDialog,
  SortHeader,
  Pagination,
  SearchInput,
} from "@/components/ui";
import {
  CustomerDesktopRow,
  CustomerMobileCard,
} from "@/features/customers/components/CustomerRow";

const EMPTY_FILTERS: CustomerFilters = { query: "", wilaya: "all" };
const PAGE_SIZE = 10;

export function CustomersList() {
  const t = useT("customers");
  const common = useT("common");
  const auth = useT("auth");
  const identity = useIdentity();
  const confirm = useConfirmDialog();
  const [customers, setCustomers] = useState<Customer[] | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [filters, setFilters] = useState<CustomerFilters>(EMPTY_FILTERS);
  const [sortKey, setSortKey] = useState<CustomerSortKey>("createdAt");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const deferredFilters = useDeferredValue(filters);

  async function load() {
    setLoadError(null);
    try {
      setCustomers(await listAllCustomers());
    } catch (cause) {
      setLoadError(cause);
    }
  }

  useEffect(() => {
    if (canScope(identity, SCOPES.CUSTOMERS_READ)) void load();
  }, [identity?.role, identity?.scopes.join(",")]);

  useEffect(() => {
    setPage(1);
  }, [deferredFilters, sortKey, sortDirection]);

  if (!canScope(identity, SCOPES.CUSTOMERS_READ))
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
  if (customers === null) return <div className="overflow-hidden rounded-xl shadow-card"><TableSkeleton columns={5} /></div>;

  const filtered = filterCustomers(customers, deferredFilters);
  const sorted = sortCustomers(filtered, sortKey, sortDirection);
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const visible = paginateCustomers(sorted, safePage, PAGE_SIZE);
  const wilayas = [
    ...new Map(
      customers
        .filter((customer) => customer.wilayaId != null)
        .map((customer) => [customer.wilayaId, customer.wilaya]),
    ).entries(),
  ].sort((a, b) => Number(a[0]) - Number(b[0]));
  const hasFilters = filters.query.trim() !== "" || filters.wilaya !== "all";
  const canEdit = canScope(identity, SCOPES.CUSTOMERS_UPDATE);
  const canDelete = canScope(identity, SCOPES.CUSTOMERS_DELETE);

  function onSort(key: CustomerSortKey) {
    if (sortKey === key)
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDirection("asc");
    }
  }
  async function onDelete(customer: Customer) {
    if (!customerCanDelete(customer)) {
      const message = t("error_cannot_delete_with_orders");
      setActionError(message);
      notify.error(message);
      return;
    }
    if (
      !(await confirm({
        title: common("confirm_delete_title", { name: customer.name }),
        description: common("delete_description"),
        confirmLabel: common("delete"),
        tone: "danger",
      }))
    )
      return;
    try {
      await deleteCustomer(customer.id);
      setCustomers(
        (current) =>
          current?.filter((item) => item.id !== customer.id) ?? current,
      );
      notify.success(t("success_deleted"));
    } catch (cause) {
      const message = customerErrorMessage(cause, t);
      setActionError(message);
      notify.error(message);
    }
  }

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
        <ListToolbar count={t("count", { count: filtered.length })}>
          <SearchInput
            value={filters.query}
            onChange={(value) => setFilters((current) => ({ ...current, query: value }))}
            placeholder={t("search_placeholder")}
            className="basis-full sm:basis-72"
          />
          <FilterPill
            label={t("filters.wilaya")}
            value={filters.wilaya}
            onChange={(wilaya) => setFilters((current) => ({ ...current, wilaya }))}
          >
            <option value="all">{t("filters.all_wilayas")}</option>
            {wilayas.map(([id, name]) => (
              <option key={id} value={id ?? ""}>
                {name || id}
              </option>
            ))}
          </FilterPill>
          {hasFilters && (
            <Button type="button" variant="ghost" size="sm" onClick={() => setFilters(EMPTY_FILTERS)}>
              {common("clear_filters")}
            </Button>
          )}
        </ListToolbar>
        {sorted.length === 0 ? (
          <EmptyState
            icon={<Users />}
            title={
              hasFilters ? common("no_results_found") : t("empty_state.title")
            }
            description={hasFilters ? undefined : t("empty_state.description")}
            action={
              !hasFilters && canScope(identity, SCOPES.CUSTOMERS_CREATE) ? (
                <LinkButton href="/customers/new">
                  <Plus size={16} />
                  {t("empty_state.action")}
                </LinkButton>
              ) : undefined
            }
          />
        ) : (
          <>
            <div className="divide-y divide-border border-t border-border md:hidden">
              {visible.map((customer) => (
                <CustomerMobileCard key={customer.id} customer={customer} />
              ))}
            </div>
            <div className="hidden overflow-x-auto md:block">
              <Table className="min-w-[760px]">
                <TableHeader>
                  <TableRow>
                    <SortHeader
                      label={t("table.customer")}
                      sortKey="name"
                      activeKey={sortKey}
                      direction={sortDirection}
                      onSort={(key) => onSort(key as CustomerSortKey)}
                    />
                    <TableHead>{t("table.phone")}</TableHead>
                    <TableHead>{t("table.wilaya")}</TableHead>
                    <SortHeader
                      label={t("table.orders")}
                      sortKey="totalOrders"
                      activeKey={sortKey}
                      direction={sortDirection}
                      onSort={(key) => onSort(key as CustomerSortKey)}
                      align="end"
                    />
                    <SortHeader
                      label={t("table.total_spent")}
                      sortKey="totalSpent"
                      activeKey={sortKey}
                      direction={sortDirection}
                      onSort={(key) => onSort(key as CustomerSortKey)}
                      align="end"
                    />
                    <TableHead className="w-20">
                      <span className="sr-only">{common("table.actions")}</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((customer) => (
                    <CustomerDesktopRow
                      key={customer.id}
                      customer={customer}
                      canEdit={canEdit}
                      canDelete={canDelete}
                      onDelete={onDelete}
                    />
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
