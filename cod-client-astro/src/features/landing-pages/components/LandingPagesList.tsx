import { useDeferredValue, useEffect, useState } from "react";
import {
  Copy,
  CopyPlus,
  ExternalLink,
  Megaphone,
  MegaphoneOff,
  MoreHorizontal,
  Trash2,
} from "lucide-react";
import {
  canScope,
  useIdentity,
} from "@/features/auth/components/RequireAuth";
import { useLocale, useT } from "@/i18n/react";
import { notify } from "@/lib/notify";
import { SCOPES } from "../../../../../cod-shared/rbac/scopes";
import {
  deleteLandingPage,
  duplicateLandingPage,
  listLandingPages,
  publishLandingPage,
  unpublishLandingPage,
} from "@/features/landing-pages/api";
import {
  filterLandingPages,
  landingPageCvr,
  landingPageErrorMessage,
  landingPagePublicUrl,
} from "@/features/landing-pages/model";
import type { LandingPageListItem } from "@/features/landing-pages/types";
import { formatMoneyValue } from "@/features/products/model";
import {
  Alert,
  Badge,
  Card,
  CellEmpty,
  DropdownItem,
  DropdownMenu,
  EmptyState,
  SearchInput,
  FilterPill,
  LinkButton,
  ListToolbar,
  RowActions,
  RowTitle,
  openRowOnClick,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  useConfirmDialog,
} from "@/components/ui";

function studioHref(page: LandingPageListItem) {
  return `/landing-pages/${encodeURIComponent(page.id)}/studio`;
}

function statusTone(status: LandingPageListItem["status"]) {
  if (status === "published") return "success" as const;
  if (status === "archived") return "neutral" as const;
  return "warning" as const;
}

function ListSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      className="overflow-hidden rounded-xl bg-card shadow-card"
    >
      <div className="flex items-center gap-3 border-b border-border p-3">
        <Skeleton className="h-9 flex-1" />
        <Skeleton className="h-9 w-44" />
        <Skeleton className="h-3 w-16" />
      </div>
      <div className="h-12 border-b border-border bg-muted/35" />
      {Array.from({ length: 5 }).map((_, index) => (
        <div
          key={index}
          className="grid h-16 grid-cols-[1.6fr_1.1fr_0.9fr_0.6fr_0.6fr_0.6fr_1fr_1.2fr] items-center gap-4 border-b border-border px-4 last:border-0"
        >
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-5 w-20 justify-self-center" />
          <Skeleton className="h-3 w-12 justify-self-end" />
          <Skeleton className="h-3 w-12 justify-self-end" />
          <Skeleton className="h-3 w-12 justify-self-end" />
          <Skeleton className="h-3 w-20 justify-self-end" />
          <Skeleton className="h-9 w-9 justify-self-end" />
        </div>
      ))}
    </div>
  );
}

export function LandingPagesList() {
  const t = useT("landing-pages");
  const common = useT("common");
  const auth = useT("auth");
  const locale = useLocale();
  const identity = useIdentity();
  const confirm = useConfirmDialog();
  const [pages, setPages] = useState<LandingPageListItem[] | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<string>("all");
  const deferredQuery = useDeferredValue(query);

  const canManage = canScope(identity, SCOPES.LANDING_PAGES_MANAGE);

  async function load() {
    setLoadError(null);
    try {
      setPages(await listLandingPages());
    } catch (cause) {
      setLoadError(cause);
    }
  }

  useEffect(() => {
    if (canScope(identity, SCOPES.LANDING_PAGES_READ)) void load();
  }, [identity?.role, identity?.scopes.join(",")]);

  if (!canScope(identity, SCOPES.LANDING_PAGES_READ))
    return (
      <Alert role="alert" tone="critical">
        {auth("no_access")}
      </Alert>
    );

  if (loadError)
    return (
      <Alert role="alert" tone="critical">
        <div className="flex-1">
          <p className="font-semibold">{t("error_generic")}</p>
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

  if (pages === null) return <ListSkeleton />;

  const filtered = filterLandingPages(pages, {
    query: deferredQuery,
    productId: "",
    status: status as LandingPageListItem["status"] | "all",
  });

  const statusLabels = {
    draft: t("status_draft"),
    published: t("status_published"),
    archived: t("status_archived"),
  } as const;

  async function onTogglePublish(page: LandingPageListItem) {
    try {
      if (page.status === "published") {
        await unpublishLandingPage(page.id);
        setPages(
          (current) =>
            current?.map((item) =>
              item.id === page.id ? { ...item, status: "draft" as const } : item,
            ) ?? current,
        );
      } else {
        await publishLandingPage(page.id);
        setPages(
          (current) =>
            current?.map((item) =>
              item.id === page.id ? { ...item, status: "published" as const } : item,
            ) ?? current,
        );
      }
      notify.success(common("feedback.updated"));
    } catch (cause) {
      const message = landingPageErrorMessage(cause, t);
      setActionError(message);
      notify.error(message);
    }
  }

  async function onDuplicate(page: LandingPageListItem) {
    try {
      const dup = await duplicateLandingPage(page.id);
      // The duplicate endpoint returns the full detail — map it to the
      // list-item shape so the row renders without a reload.
      const entry: LandingPageListItem = {
        id: dup.data.id,
        slug: dup.data.slug,
        name: dup.data.name,
        status: dup.data.status,
        productId: dup.data.productId,
        productName: dup.data.product?.name ?? null,
        productHandle: dup.data.product?.handle ?? null,
        imageCount: dup.data.images.length,
        views: dup.data.views,
        orders: dup.data.stats.orders,
        revenue: dup.data.stats.revenue,
        publicUrl: dup.data.publicUrl,
        publishedAt: dup.data.publishedAt,
        createdAt: dup.data.createdAt,
        updatedAt: dup.data.updatedAt,
        // The copy inherits the source's pixel — see duplicateLandingPage.
        tracking: page.tracking,
      };
      setPages((current) => [entry, ...(current ?? [])]);
      notify.success(t("actions.duplicated"));
    } catch (cause) {
      const message = landingPageErrorMessage(cause, t);
      setActionError(message);
      notify.error(message);
    }
  }

  async function onDelete(page: LandingPageListItem) {
    if (
      !(await confirm({
        title: common("confirm_delete_title", { name: page.name }),
        description: t("actions.confirm_delete"),
        confirmLabel: common("delete"),
        tone: "danger",
      }))
    )
      return;
    try {
      await deleteLandingPage(page.id);
      setPages((current) => current?.filter((item) => item.id !== page.id) ?? current);
      notify.success(common("feedback.deleted"));
    } catch (cause) {
      const message = landingPageErrorMessage(cause, t);
      setActionError(message);
      notify.error(message);
    }
  }

  function onCopyLink(page: LandingPageListItem) {
    // The STOREFRONT URL — the thing the merchant pastes into an ad set.
    // Never the dashboard origin: that would send shoppers to a sign-in wall.
    const url = landingPagePublicUrl(page);
    void navigator.clipboard?.writeText(url).then(
      () => notify.success(t("list.link_copied")),
      () => notify.error(t("error_generic")),
    );
  }

  const actionsMenu = (page: LandingPageListItem) => (
    <DropdownMenu trigger={<MoreHorizontal size={16} />} triggerLabel={`${common("table.actions")}: ${page.name}`}>
      <DropdownItem
        onClick={() => window.open(landingPagePublicUrl(page), "_blank", "noopener")}
        disabled={page.status !== "published"}
      >
        <ExternalLink size={14} />
        {t("list.view")}
      </DropdownItem>
      <DropdownItem onClick={() => onCopyLink(page)}>
        <Copy size={14} />
        {t("list.copy_link")}
      </DropdownItem>
      {canManage && (
        <DropdownItem onClick={() => void onTogglePublish(page)}>
          {page.status === "published" ? <MegaphoneOff size={14} /> : <Megaphone size={14} />}
          {page.status === "published" ? t("actions.unpublish") : t("actions.publish")}
        </DropdownItem>
      )}
      {canManage && (
        <DropdownItem onClick={() => void onDuplicate(page)}>
          <CopyPlus size={14} />
          {t("actions.duplicate")}
        </DropdownItem>
      )}
      {canManage && (
        <DropdownItem danger onClick={() => void onDelete(page)}>
          <Trash2 size={14} />
          {common("delete")}
        </DropdownItem>
      )}
    </DropdownMenu>
  );

  const rows = filtered.map((page) => ({ page, cvr: landingPageCvr(page) }));
  const hasFilters = deferredQuery.trim() !== "" || status !== "all";

  return (
    <div className="space-y-3">
      {actionError && (
        <Alert role="alert" tone="critical">
          <span className="flex-1">{actionError}</span>
        </Alert>
      )}

      <Card flush>
        <ListToolbar count={t("count", { count: filtered.length })}>
          <SearchInput value={query} onChange={(value) => setQuery(value)} placeholder={t("search_placeholder")} className="basis-full sm:basis-72" />
          <FilterPill label={t("list.status")} value={status} onChange={setStatus}>
            <option value="all">{t("list.status")}</option>
            <option value="draft">{t("status_draft")}</option>
            <option value="published">{t("status_published")}</option>
            <option value="archived">{t("status_archived")}</option>
          </FilterPill>
        </ListToolbar>

        {rows.length === 0 ? (
          <EmptyState
            icon={<Megaphone size={28} />}
            title={hasFilters ? common("no_results_found") : t("list.empty")}
            description={hasFilters ? undefined : t("list.empty_hint")}
            action={
              !hasFilters && canManage ? (
                <LinkButton href="/landing-pages/new">{t("create_landing_page")}</LinkButton>
              ) : undefined
            }
          />
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden overflow-x-auto md:block">
              <Table className="min-w-[760px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("list.name")}</TableHead>
                    <TableHead>{t("list.status")}</TableHead>
                    <TableHead numeric>{t("list.views")}</TableHead>
                    <TableHead numeric>{t("list.orders")}</TableHead>
                    <TableHead numeric>{t("list.cvr")}</TableHead>
                    <TableHead numeric>{t("list.revenue")}</TableHead>
                    <TableHead className="w-px">
                      <span className="sr-only">{common("table.actions")}</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map(({ page, cvr }) => (
                    <TableRow key={page.id} onClick={openRowOnClick(studioHref(page))} className="cursor-pointer">
                      <TableCell className="max-w-72">
                        <RowTitle href={studioHref(page)}>{page.name}</RowTitle>
                      </TableCell>
                      <TableCell>
                        <Badge tone={statusTone(page.status)}>{statusLabels[page.status]}</Badge>
                      </TableCell>
                      <TableCell numeric>{page.views.toLocaleString(locale)}</TableCell>
                      <TableCell numeric>{page.orders.toLocaleString(locale)}</TableCell>
                      <TableCell numeric className="text-muted-foreground">
                        {cvr === null ? <CellEmpty /> : `${cvr.toFixed(1)}%`}
                      </TableCell>
                      <TableCell numeric>{formatMoneyValue(page.revenue, locale)}</TableCell>
                      <TableCell className="w-px">
                        <RowActions>{actionsMenu(page)}</RowActions>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="divide-y divide-border md:hidden">
              {rows.map(({ page }) => (
                <article
                  key={page.id}
                  onClick={openRowOnClick(studioHref(page))}
                  className="flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors active:bg-subtle"
                >
                  <div className="min-w-0 flex-1">
                    <a href={studioHref(page)} className="block truncate text-sm font-medium text-foreground">
                      {page.name}
                    </a>
                    <p className="truncate text-xs text-muted-foreground">{page.productName ?? "—"}</p>
                  </div>
                  <span className="shrink-0 text-end">
                    <span className="block text-sm font-medium tabular-nums text-foreground">
                      {formatMoneyValue(page.revenue, locale)}
                    </span>
                    <span className="block text-xs text-muted-foreground">{t("orders_count", { count: page.orders })}</span>
                  </span>
                  {actionsMenu(page)}
                </article>
              ))}
          </div>
          </>
        )}
      </Card>
    </div>
  );
}
