import { useCallback, useEffect, useState } from "react";
import { Ban, Inbox, Trash2 } from "lucide-react";
import { canScope, RequireAuth, useIdentity } from "@/features/auth/components/RequireAuth";
import { DashboardPage } from "@/components/layout/page";
import { Alert, Button, Card, EmptyState, IconButton, PageHeader, Pagination, useConfirmDialog } from "@/components/ui";
import { useLocale, useT } from "@/i18n/react";
import { notify } from "@/lib/notify";
import { relativeTime } from "@/lib/relative-time";
import { formatMoney } from "@/features/orders/model";
import { addToBlockList, deleteSpamOrder, listAttempts, rescueSpamOrder, type OrderAttempt } from "@/features/apps/order-protection/api";
import { AttemptSignalsLine } from "@/features/apps/order-protection/AttemptSignals";
import { rescueErrorKey } from "@/features/apps/order-protection/model";
import { SCOPES } from "../../../../../cod-shared/rbac/scopes";

const PAGE_SIZE = 20;

function SpamOrders() {
  const t = useT("apps");
  const auth = useT("auth");
  const locale = useLocale();
  const identity = useIdentity();
  const confirm = useConfirmDialog();
  const canRead = canScope(identity, SCOPES.ORDER_PROTECTION_READ);
  const canManage = canScope(identity, SCOPES.ORDER_PROTECTION_MANAGE);
  const [rows, setRows] = useState<OrderAttempt[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await listAttempts({ outcome: "spam", limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });
    setRows(result.data);
    setTotal(result.total);
  }, [page]);

  useEffect(() => {
    if (canRead) void load().catch(() => notify.error(t("order_protection.load_failed")));
  }, [canRead, load]);

  if (!canRead) return <Alert tone="critical">{auth("no_access")}</Alert>;

  async function rescue(row: OrderAttempt) {
    setBusyId(row.id);
    try {
      const { orderNumber } = await rescueSpamOrder(row.id);
      notify.success(t("order_protection.spam.rescued", { number: orderNumber }));
      await load();
    } catch (cause) {
      notify.error(t(`order_protection.${rescueErrorKey(cause)}`));
    } finally {
      setBusyId(null);
    }
  }

  async function block(row: OrderAttempt) {
    setBusyId(row.id);
    try {
      await addToBlockList({ kind: "phone", value: row.phone });
      notify.success(t("order_protection.spam.blocked", { phone: row.phone }));
    } catch {
      notify.error(t("order_protection.block.add_failed"));
    } finally {
      setBusyId(null);
    }
  }

  async function remove(row: OrderAttempt) {
    const sure = await confirm({ title: t("order_protection.spam.delete_title"), description: t("order_protection.spam.delete_body"), confirmLabel: t("order_protection.spam.delete") });
    if (!sure) return;
    setBusyId(row.id);
    try {
      await deleteSpamOrder(row.id);
      await load();
    } catch {
      notify.error(t("order_protection.save_failed"));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <PageHeader title={t("order_protection.spam.title")} subtitle={t("order_protection.spam.subtitle")} />
      {rows !== null && rows.length === 0 ? (
        <EmptyState icon={<Inbox size={20} aria-hidden="true" />} title={t("order_protection.spam.empty")} description={t("order_protection.spam.empty_hint")} />
      ) : (
        <Card className="p-0">
          <ul className="divide-y divide-border">
            {(rows ?? []).map((row) => (
              <li key={row.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 space-y-0.5">
                  <p className="truncate text-sm font-semibold text-foreground">
                    {row.customerName} · <span dir="ltr">{row.phone}</span>
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {row.orderNumber}
                    {row.total !== null ? ` · ${formatMoney(row.total, locale)}` : ""}
                    {" · "}
                    <time dateTime={row.createdAt}>{relativeTime(row.createdAt, locale)}</time>
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{t("order_protection.spam.because", { rules: row.matches.filter((match) => match.mode === "active").map((match) => match.name).join("، ") })}</p>
                  <AttemptSignalsLine signals={row.signals} />
                </div>
                {canManage && (
                  <div className="flex shrink-0 items-center gap-2">
                    <Button onClick={() => void rescue(row)} disabled={busyId === row.id}>{t("order_protection.spam.rescue")}</Button>
                    <Button variant="secondary" onClick={() => void block(row)} disabled={busyId === row.id}>
                      <Ban size={14} aria-hidden="true" />
                      {t("order_protection.spam.block")}
                    </Button>
                    <IconButton aria-label={t("order_protection.spam.delete")} onClick={() => void remove(row)} disabled={busyId === row.id}>
                      <Trash2 size={15} aria-hidden="true" />
                    </IconButton>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
      {total > PAGE_SIZE && <Pagination className="mt-3" page={page} totalPages={Math.ceil(total / PAGE_SIZE)} total={total} pageSize={PAGE_SIZE} onPageChange={setPage} />}
    </>
  );
}

export default function SpamOrdersPageApp() {
  return (
    <RequireAuth>
      <DashboardPage>
        <SpamOrders />
      </DashboardPage>
    </RequireAuth>
  );
}
