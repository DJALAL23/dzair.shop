import { useEffect, useState } from "react";
import { MoreHorizontal, Pencil, Plus, Ticket, ToggleLeft, ToggleRight, Trash2 } from "lucide-react";
import { canScope, RequireAuth, useIdentity } from "@/features/auth/components/RequireAuth";
import { DashboardChrome } from "@/components/layout/chrome";
import {
  Alert,
  Badge,
  Card,
  DropdownItem,
  DropdownLink,
  DropdownMenu,
  EmptyState,
  LinkButton,
  PageHeader,
  RowActions,
  RowTitle,
  SearchInput,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  openRowOnClick,
  useConfirmDialog,
} from "@/components/ui";
import { useLocale, useT } from "@/i18n/react";
import { notify } from "@/lib/notify";
import { formatMoney } from "@/features/orders/model";
import { SCOPES } from "../../../../../cod-shared/rbac/scopes";
import { deleteCoupon, listCoupons, updateCoupon } from "@/features/coupons/api";
import { COUPON_STATE_TONE, couponErrorMessage, couponScopeLabel, couponUsesLabel, couponValueLabel, searchCoupons } from "@/features/coupons/model";
import type { CouponSummary } from "@/features/coupons/types";

const couponHref = (coupon: CouponSummary) => `/coupons/${encodeURIComponent(coupon.id)}`;

function CouponActions({ coupon, canManage, onToggle, onDelete }: { coupon: CouponSummary; canManage: boolean; onToggle: () => void; onDelete: () => void }) {
  const t = useT("coupons");
  const common = useT("common");
  return (
    <DropdownMenu trigger={<MoreHorizontal size={16} />} triggerLabel={`${common("table.actions")}: ${coupon.code}`}>
      <DropdownLink href={couponHref(coupon)}>
        <Pencil size={14} />
        {t("actions.edit")}
      </DropdownLink>
      {canManage && (
        <DropdownItem onClick={onToggle}>
          {coupon.status === "active" ? <ToggleLeft size={14} /> : <ToggleRight size={14} />}
          {coupon.status === "active" ? t("actions.deactivate") : t("actions.activate")}
        </DropdownItem>
      )}
      {canManage && (
        <DropdownItem danger onClick={onDelete}>
          <Trash2 size={14} />
          {t("actions.delete")}
        </DropdownItem>
      )}
    </DropdownMenu>
  );
}

function CouponsList() {
  const t = useT("coupons");
  const common = useT("common");
  const auth = useT("auth");
  const locale = useLocale();
  const identity = useIdentity();
  const confirm = useConfirmDialog();
  const [coupons, setCoupons] = useState<CouponSummary[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [query, setQuery] = useState("");
  const canRead = canScope(identity, SCOPES.COUPONS_READ);
  const canManage = canScope(identity, SCOPES.COUPONS_MANAGE);

  async function load() {
    setLoadError(false);
    try {
      setCoupons(await listCoupons());
    } catch {
      setLoadError(true);
    }
  }

  useEffect(() => {
    if (canRead) void load();
  }, [canRead]);

  if (!canRead)
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
          <button type="button" onClick={() => void load()} className="mt-3 text-xs font-semibold underline underline-offset-4">
            {common("retry")}
          </button>
        </div>
      </Alert>
    );
  if (coupons === null)
    return (
      <div role="status" aria-busy="true" className="space-y-2 rounded-xl bg-card p-4 shadow-card">
        {Array.from({ length: 5 }).map((_, index) => (
          <Skeleton key={index} className="h-10 w-full" />
        ))}
      </div>
    );

  async function toggle(coupon: CouponSummary) {
    try {
      const saved = await updateCoupon(coupon.id, { status: coupon.status === "active" ? "inactive" : "active" });
      setCoupons((current) => current?.map((entry) => (entry.id === coupon.id ? { ...entry, status: saved.status, state: saved.state } : entry)) ?? current);
      notify.success(common("feedback.updated"));
    } catch (cause) {
      notify.error(couponErrorMessage(cause, t));
    }
  }

  async function remove(coupon: CouponSummary) {
    if (!(await confirm({ title: common("confirm_delete_title", { name: coupon.code }), description: t("form.delete_confirm"), confirmLabel: common("delete"), tone: "danger" }))) return;
    try {
      await deleteCoupon(coupon.id);
      setCoupons((current) => current?.filter((entry) => entry.id !== coupon.id) ?? current);
      notify.success(common("feedback.deleted"));
    } catch (cause) {
      notify.error(couponErrorMessage(cause, t));
    }
  }

  const shown = searchCoupons(coupons, query);
  const badge = (coupon: CouponSummary) => <Badge tone={COUPON_STATE_TONE[coupon.state]}>{t(`state.${coupon.state}`)}</Badge>;

  if (coupons.length === 0)
    return (
      <Card>
        <EmptyState
          icon={<Ticket size={22} />}
          title={t("empty_state.title")}
          description={t("empty_state.description")}
          action={
            canManage ? (
              <LinkButton href="/coupons/new">
                <Plus size={16} />
                {t("empty_state.action")}
              </LinkButton>
            ) : undefined
          }
        />
      </Card>
    );

  return (
    <Card flush>
      <div className="border-b border-border p-3">
        <SearchInput value={query} onChange={setQuery} placeholder={t("search_placeholder")} className="max-w-sm" />
      </div>
      {shown.length === 0 ? (
        <EmptyState icon={<Ticket size={22} />} title={common("no_results_found")} />
      ) : (
        <>
          <div className="divide-y divide-border md:hidden">
            {shown.map((coupon) => (
              <article key={coupon.id} onClick={openRowOnClick(couponHref(coupon))} className="flex cursor-pointer items-center gap-3 px-4 py-3 active:bg-subtle">
                <div className="min-w-0 flex-1">
                  <a href={couponHref(coupon)} className="block truncate font-mono text-sm font-semibold text-foreground" dir="ltr">
                    {coupon.code}
                  </a>
                  <p className="truncate text-xs text-muted-foreground">
                    {couponValueLabel(coupon, t, locale)} · {couponUsesLabel(coupon, t)}
                  </p>
                </div>
                {badge(coupon)}
                <CouponActions coupon={coupon} canManage={canManage} onToggle={() => void toggle(coupon)} onDelete={() => void remove(coupon)} />
              </article>
            ))}
          </div>
          <div className="hidden overflow-x-auto md:block">
            <Table className="min-w-[760px]">
              <TableHeader>
                <TableRow>
                  <TableHead>{t("table.code")}</TableHead>
                  <TableHead>{t("table.value")}</TableHead>
                  <TableHead>{t("table.scope")}</TableHead>
                  <TableHead>{t("table.uses")}</TableHead>
                  <TableHead>{t("table.discount_given")}</TableHead>
                  <TableHead>{t("table.state")}</TableHead>
                  <TableHead className="w-px">
                    <span className="sr-only">{common("table.actions")}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((coupon) => (
                  <TableRow key={coupon.id} onClick={openRowOnClick(couponHref(coupon))} className="cursor-pointer">
                    <TableCell>
                      <RowTitle href={couponHref(coupon)}>
                        <span className="font-mono" dir="ltr">
                          {coupon.code}
                        </span>
                      </RowTitle>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{couponValueLabel(coupon, t, locale)}</TableCell>
                    <TableCell className="text-muted-foreground">{couponScopeLabel(coupon, t)}</TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">{couponUsesLabel(coupon, t)}</TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">{formatMoney(coupon.discountGiven, locale)}</TableCell>
                    <TableCell>{badge(coupon)}</TableCell>
                    <TableCell className="w-px">
                      <RowActions>
                        <CouponActions coupon={coupon} canManage={canManage} onToggle={() => void toggle(coupon)} onDelete={() => void remove(coupon)} />
                      </RowActions>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </Card>
  );
}

function Gated() {
  const t = useT("coupons");
  const identity = useIdentity();
  return (
    <DashboardChrome currentPath="/coupons">
      <PageHeader
        title={t("page_title")}
        actions={
          canScope(identity, SCOPES.COUPONS_MANAGE) ? (
            <LinkButton href="/coupons/new">
              <Plus size={16} />
              {t("add_coupon")}
            </LinkButton>
          ) : undefined
        }
      />
      <CouponsList />
    </DashboardChrome>
  );
}

export default function CouponsPageApp() {
  return (
    <RequireAuth>
      <Gated />
    </RequireAuth>
  );
}
