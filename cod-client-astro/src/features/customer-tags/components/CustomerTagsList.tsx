import { useDeferredValue, useEffect, useState } from "react";
import { Plus, Tag, X } from "lucide-react";
import {
  canScope,
  useIdentity,
} from "@/features/auth/components/RequireAuth";
import { useT } from "@/i18n/react";
import { notify } from "@/lib/notify";
import { SCOPES } from "../../../../../cod-shared/rbac/scopes";
import {
  deleteCustomerTag,
  listAllCustomerTags,
} from "@/features/customer-tags/api";
import {
  customerTagErrorMessage,
  filterTags,
  paginateTags,
  sortTags,
  tagCanDelete,
  type CustomerTagSortKey,
} from "@/features/customer-tags/model";
import type { CustomerTag } from "@/features/customer-tags/types";
import {
  Button,
  EmptyState,
  LinkButton,
  Alert,
  Card,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  Skeleton,
  useConfirmDialog,
  SortHeader,
  Pagination,
  SearchInput,
} from "@/components/ui";
import {
  TagDesktopRow,
  TagMobileCard,
} from "@/features/customer-tags/components/CustomerTagRow";

const PAGE_SIZE = 10;

function TagSkeleton() {
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
          className="grid h-16 grid-cols-[1fr_0.6fr_0.8fr] items-center gap-4 border-b border-border px-4 last:border-0"
        >
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-3 w-16" />
          <span className="h-6 w-20 justify-self-end shimmer rounded-lg" />
        </div>
      ))}
    </div>
  );
}

export function CustomerTagsList() {
  const t = useT("customer-tags");
  const common = useT("common");
  const auth = useT("auth");
  const identity = useIdentity();
  const confirm = useConfirmDialog();
  const [tags, setTags] = useState<CustomerTag[] | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<CustomerTagSortKey>("createdAt");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const deferredQuery = useDeferredValue(query);

  async function load() {
    setLoadError(null);
    try {
      setTags(await listAllCustomerTags());
    } catch (cause) {
      setLoadError(cause);
    }
  }

  useEffect(() => {
    if (canScope(identity, SCOPES.CUSTOMER_TAGS_READ)) void load();
  }, [identity?.role, identity?.scopes.join(",")]);

  useEffect(() => {
    setPage(1);
  }, [deferredQuery, sortKey, sortDirection]);

  if (!canScope(identity, SCOPES.CUSTOMER_TAGS_READ))
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
  if (tags === null) return <TagSkeleton />;

  const filtered = filterTags(tags, deferredQuery);
  const sorted = sortTags(filtered, sortKey, sortDirection);
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const visible = paginateTags(sorted, safePage, PAGE_SIZE);
  const hasQuery = query.trim() !== "";
  const canManage = canScope(identity, SCOPES.CUSTOMER_TAGS_MANAGE);

  function onSort(key: CustomerTagSortKey) {
    if (sortKey === key)
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDirection("asc");
    }
  }
  async function onDelete(tag: CustomerTag) {
    if (!tagCanDelete(tag)) {
      const message = t("error_tag_has_assignments");
      setActionError(message);
      notify.error(message);
      return;
    }
    if (
      !(await confirm({
        title: common("confirm_delete_title", { name: tag.name }),
        description: common("delete_description"),
        confirmLabel: common("delete"),
        tone: "danger",
      }))
    )
      return;
    try {
      await deleteCustomerTag(tag.id);
      setTags(
        (current) => current?.filter((item) => item.id !== tag.id) ?? current,
      );
      notify.success(t("success_deleted"));
    } catch (cause) {
      const message = customerTagErrorMessage(cause, t);
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
        <div className="flex flex-wrap items-center gap-2 p-2">
          <div className="contents">
            <SearchInput
              value={query}
              onChange={setQuery}
              placeholder={t("search_placeholder")}
              className="basis-full sm:basis-72"
            />
            <span className="order-last ms-auto shrink-0 px-1 text-xs tabular-nums text-muted-foreground">{t("count", { count: filtered.length })}</span>
          </div>
          {hasQuery && (
            <Button type="button" variant="ghost" size="sm" onClick={() => setQuery("")}>
              {common("clear_filters")}
            </Button>
          )}
        </div>
        {sorted.length === 0 ? (
          <EmptyState
            icon={<Tag />}
            title={
              hasQuery ? common("no_results_found") : t("empty_state.title")
            }
            description={hasQuery ? undefined : t("empty_state.description")}
            action={
              !hasQuery && canManage ? (
                <LinkButton href="/customer-tags/new">
                  <Plus size={16} />
                  {t("empty_state.action")}
                </LinkButton>
              ) : undefined
            }
          />
        ) : (
          <>
            <div className="divide-y divide-border border-t border-border md:hidden">
              {visible.map((tag) => (
                <TagMobileCard
                  key={tag.id}
                  tag={tag}
                  canManage={canManage}
                  onDelete={onDelete}
                />
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
                      onSort={(key) => onSort(key as CustomerTagSortKey)}
                    />
                    <SortHeader
                      label={t("table.customers")}
                      sortKey="assignmentCount"
                      activeKey={sortKey}
                      direction={sortDirection}
                      onSort={(key) => onSort(key as CustomerTagSortKey)}
                      align="end"
                    />
                    <SortHeader
                      label={t("table.created")}
                      sortKey="createdAt"
                      activeKey={sortKey}
                      direction={sortDirection}
                      onSort={(key) => onSort(key as CustomerTagSortKey)}
                    />
                    <TableHead className="w-px">
                      <span className="sr-only">{common("table.actions")}</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((tag) => (
                    <TagDesktopRow
                      key={tag.id}
                      tag={tag}
                      canManage={canManage}
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
