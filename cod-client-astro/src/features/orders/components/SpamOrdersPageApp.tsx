import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Ban, Inbox, Trash2 } from "lucide-react";
import { canScope, RequireAuth, useIdentity } from "@/features/auth/components/RequireAuth";
import { DashboardPage } from "@/components/layout/page";
import { Alert, Badge, Button, Card, EmptyState, IconButton, PageHeader, Pagination, useConfirmDialog } from "@/components/ui";
import { useLocale, useT } from "@/i18n/react";
import { notify } from "@/lib/notify";
import { relativeTime } from "@/lib/relative-time";
import { communeLabel, wilayaLabel } from "@/lib/places";
import { formatMoney } from "@/features/orders/model";
import { addToBlockList, deleteSpamOrder, listAttempts, rescueSpamOrder, type OrderAttempt } from "@/features/apps/order-protection/api";
import { AttemptSignalsLine } from "@/features/apps/order-protection/AttemptSignals";
import { rescueErrorKey } from "@/features/apps/order-protection/model";
import { decidingFirst, listOf, useMatchName } from "@/features/apps/order-protection/words";
import { SCOPES } from "../../../../../cod-shared/rbac/scopes";

const PAGE_SIZE = 20;

/** One Spam Order: who, what, where, and why it was kept out. */
function SpamRow({ row, picked, onPick, actions }: { row: OrderAttempt; picked?: boolean; onPick?: () => void; actions?: ReactNode }) {
  const t = useT("apps");
  const locale = useLocale();
  const matchName = useMatchName();
  const { deciding, also } = decidingFirst(row.matches, "spam");
  const wilaya = wilayaLabel(row.wilayaId, null, locale);
  const commune = communeLabel(row.communeId, null, locale);
  const place = [wilaya, commune && commune !== wilaya ? commune : null].filter(Boolean).join(" · ");
  const products = (row.lines ?? []).map((line) => t("order_protection.spam.line", { name: line.variantLabel ? `${line.name} (${line.variantLabel})` : line.name, quantity: line.quantity }));

  return (
    <li className="flex gap-3 p-4">
      {onPick && <input type="checkbox" checked={picked} onChange={onPick} aria-label={row.orderNumber ?? row.phone} className="mt-1 size-4 shrink-0 cursor-pointer rounded accent-[var(--primary)] pointer-coarse:size-5" />}
      <div className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-foreground">
            <bdi>{row.customerName}</bdi>
            <span aria-hidden="true">·</span>
            <span dir="ltr">{row.phone}</span>
            {row.phoneBlocked && <Badge tone="critical" size="sm">{t("order_protection.spam.number_blocked")}</Badge>}
            {row.ipBlocked && <Badge tone="critical" size="sm">{t("order_protection.spam.network_blocked")}</Badge>}
          </p>
          {products.length > 0 && <p className="text-sm text-foreground"><bdi>{listOf(products, locale)}</bdi></p>}
          <p className="text-sm text-muted-foreground">
            {[place || null, row.deliveryType ? t(`order_protection.options.delivery_type.${row.deliveryType}`) : null, row.total !== null ? formatMoney(row.total, locale) : null].filter(Boolean).join(" · ")}
          </p>
          <p className="text-xs text-muted-foreground">
            {row.orderNumber}
            {" · "}
            <time dateTime={row.createdAt}>{relativeTime(row.createdAt, locale)}</time>
          </p>
          {deciding.length > 0 && <p className="text-sm font-medium text-[var(--tone-critical-text)]">{t("order_protection.spam.because", { rules: listOf(deciding.map(matchName), locale) })}</p>}
          {also.length > 0 && <p className="text-xs text-muted-foreground">{t("order_protection.spam.also", { rules: listOf(also.map(matchName), locale) })}</p>}
          <AttemptSignalsLine signals={row.signals} />
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </li>
  );
}

function SpamOrders() {
  const t = useT("apps");
  const auth = useT("auth");
  const identity = useIdentity();
  const confirm = useConfirmDialog();
  const canRead = canScope(identity, SCOPES.ORDER_PROTECTION_READ);
  const canManage = canScope(identity, SCOPES.ORDER_PROTECTION_MANAGE);
  const [rows, setRows] = useState<OrderAttempt[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    const result = await listAttempts({ outcome: "spam", limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });
    setRows(result.data);
    setTotal(result.total);
    setPicked((current) => new Set([...current].filter((id) => result.data.some((row) => row.id === id))));
  }, [page]);

  useEffect(() => {
    if (canRead) void load().catch(() => notify.error(t("order_protection.load_failed")));
  }, [canRead, load]);

  if (!canRead) return <Alert tone="critical">{auth("no_access")}</Alert>;

  async function run(work: () => Promise<void>) {
    setBusy(true);
    try {
      await work();
    } finally {
      setBusy(false);
    }
  }

  const rescue = (row: OrderAttempt) =>
    run(async () => {
      try {
        const { orderNumber } = await rescueSpamOrder(row.id);
        notify.success(t("order_protection.spam.rescued", { number: orderNumber }));
        await load();
      } catch (cause) {
        notify.error(t(`order_protection.${rescueErrorKey(cause)}`));
      }
    });

  /** Blocks each number once; a number already on the Block List is left as it is. */
  const block = (targets: OrderAttempt[]) =>
    run(async () => {
      const phones = [...new Map(targets.filter((row) => !row.phoneBlocked).map((row) => [row.phone, row])).values()];
      let blocked = 0;
      for (const row of phones) {
        try {
          await addToBlockList({ kind: "phone", value: row.phone, ...(row.orderNumber ? { note: row.orderNumber } : {}) });
          blocked += 1;
        } catch {
          notify.error(t("order_protection.block.add_failed"));
        }
      }
      if (blocked > 0) notify.success(t("order_protection.spam.blocked_count", { count: blocked }));
      await load();
    });

  const remove = (targets: OrderAttempt[]) =>
    run(async () => {
      const sure = await confirm({ title: t("order_protection.spam.delete_title", { count: targets.length }), description: t("order_protection.spam.delete_body"), confirmLabel: t("order_protection.spam.delete"), tone: "danger" });
      if (!sure) return;
      for (const row of targets) {
        try {
          await deleteSpamOrder(row.id);
        } catch {
          notify.error(t("order_protection.save_failed"));
        }
      }
      await load();
    });

  const list = rows ?? [];
  const chosen = list.filter((row) => picked.has(row.id));
  const toggle = (id: string) => setPicked((current) => {
    const next = new Set(current);
    if (!next.delete(id)) next.add(id);
    return next;
  });
  const allPicked = list.length > 0 && chosen.length === list.length;

  return (
    <>
      <PageHeader title={t("order_protection.spam.title")} subtitle={t("order_protection.spam.subtitle")} />
      {rows !== null && rows.length === 0 ? (
        <EmptyState icon={<Inbox size={20} aria-hidden="true" />} title={t("order_protection.spam.empty")} description={t("order_protection.spam.empty_hint")} />
      ) : (
        <Card className="p-0">
          {canManage && list.length > 0 && (
            <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
              <label className="flex items-center gap-2 text-sm text-foreground">
                <input type="checkbox" checked={allPicked} onChange={() => setPicked(allPicked ? new Set() : new Set(list.map((row) => row.id)))} className="size-4 cursor-pointer rounded accent-[var(--primary)]" />
                {chosen.length > 0 ? t("order_protection.spam.picked", { count: chosen.length }) : t("order_protection.spam.pick_all")}
              </label>
              {chosen.length > 0 && (
                <div className="ms-auto flex flex-wrap gap-2">
                  <Button variant="secondary" size="sm" disabled={busy} onClick={() => void block(chosen)}>
                    <Ban size={14} aria-hidden="true" />
                    {t("order_protection.spam.block_picked")}
                  </Button>
                  <Button variant="secondary" size="sm" disabled={busy} onClick={() => void remove(chosen)}>
                    <Trash2 size={14} aria-hidden="true" />
                    {t("order_protection.spam.delete_picked")}
                  </Button>
                </div>
              )}
            </div>
          )}
          <ul className="divide-y divide-border">
            {list.map((row) => (
              <SpamRow
                key={row.id}
                row={row}
                {...(canManage
                  ? {
                      picked: picked.has(row.id),
                      onPick: () => toggle(row.id),
                      actions: (
                        <>
                          <Button onClick={() => void rescue(row)} disabled={busy}>{t("order_protection.spam.rescue")}</Button>
                          {!row.phoneBlocked && (
                            <Button variant="secondary" onClick={() => void block([row])} disabled={busy}>
                              <Ban size={14} aria-hidden="true" />
                              {t("order_protection.spam.block")}
                            </Button>
                          )}
                          <IconButton aria-label={t("order_protection.spam.delete")} onClick={() => void remove([row])} disabled={busy}>
                            <Trash2 size={15} aria-hidden="true" />
                          </IconButton>
                        </>
                      ),
                    }
                  : {})}
              />
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
