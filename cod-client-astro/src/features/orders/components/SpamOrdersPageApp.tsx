import { useCallback, useEffect, useState } from "react";
import { Ban, Inbox, Trash2, Undo2 } from "lucide-react";
import { canScope, RequireAuth, useIdentity } from "@/features/auth/components/RequireAuth";
import { DashboardPage } from "@/components/layout/page";
import {
  Alert,
  Badge,
  Button,
  Card,
  CellEmpty,
  EmptyState,
  PageHeader,
  Pagination,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableSkeleton,
  showRowOnClick,
  useConfirmDialog,
} from "@/components/ui";
import { useLocale, useT } from "@/i18n/react";
import { notify } from "@/lib/notify";
import { relativeTime } from "@/lib/relative-time";
import { formatMoney } from "@/features/orders/model";
import { useOffsetPage } from "@/hooks/use-offset-page";
import { addToBlockList, deleteSpamOrder, listAttempts, rescueSpamOrder, type OrderAttempt } from "@/features/apps/order-protection/api";
import { AttemptCustomer, AttemptSheet, attemptPlace, useAttemptLines, useAttemptReasons } from "@/features/apps/order-protection/AttemptSheet";
import { rescueErrorKey } from "@/features/apps/order-protection/model";
import { listOf } from "@/features/apps/order-protection/words";
import { SCOPES } from "../../../../../cod-shared/rbac/scopes";

const PAGE_SIZE = 20;

interface RowProps {
  row: OrderAttempt;
  onOpen: () => void;
  pick?: { picked: boolean; onPick: () => void };
}

function PickBox({ row, pick }: Pick<RowProps, "row" | "pick">) {
  if (!pick) return null;
  return <input type="checkbox" checked={pick.picked} onChange={pick.onPick} aria-label={row.orderNumber ?? row.phone} className="size-4 cursor-pointer rounded accent-[var(--primary)] pointer-coarse:size-5" />;
}

/** The rule that sent it to Spam, and how many others did too. */
function Reason({ row }: { row: OrderAttempt }) {
  const t = useT("apps");
  const { deciding } = useAttemptReasons(row);
  if (deciding.length === 0) return <CellEmpty />;
  return (
    <Badge tone="critical" size="sm">
      <bdi className="max-w-44 truncate">{deciding.length > 1 ? t("order_protection.table.reason_more", { rule: deciding[0], more: deciding.length - 1 }) : deciding[0]}</bdi>
    </Badge>
  );
}

function SpamDesktopRow({ row, onOpen, pick }: RowProps) {
  const locale = useLocale();
  const lines = useAttemptLines(row);
  const place = attemptPlace(row, locale);
  return (
    <TableRow onClick={showRowOnClick(onOpen)} className="cursor-pointer">
      {pick && (
        <TableCell className="w-10">
          <PickBox row={row} pick={pick} />
        </TableCell>
      )}
      <TableCell className="max-w-56">
        <AttemptCustomer attempt={row} onOpen={onOpen} />
      </TableCell>
      <TableCell className="max-w-64 truncate text-muted-foreground">{lines.length > 0 ? <bdi>{listOf(lines, locale)}</bdi> : <CellEmpty />}</TableCell>
      <TableCell className="max-w-44 truncate text-muted-foreground">{place ? <bdi>{place}</bdi> : <CellEmpty />}</TableCell>
      <TableCell numeric>{row.total !== null ? formatMoney(row.total, locale) : <CellEmpty />}</TableCell>
      <TableCell>
        <Reason row={row} />
      </TableCell>
      <TableCell className="whitespace-nowrap text-end text-muted-foreground">
        <time dateTime={row.createdAt}>{relativeTime(row.createdAt, locale)}</time>
      </TableCell>
    </TableRow>
  );
}

function SpamMobileCard({ row, onOpen, pick }: RowProps) {
  const locale = useLocale();
  const lines = useAttemptLines(row);
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      {pick && (
        <span className="pt-0.5">
          <PickBox row={row} pick={pick} />
        </span>
      )}
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 space-y-1 text-start">
        <span className="flex items-baseline justify-between gap-3">
          <span className="truncate text-sm font-medium text-foreground"><bdi>{row.customerName ?? row.phone}</bdi></span>
          {row.total !== null && <span className="shrink-0 text-sm font-medium tabular-nums text-foreground">{formatMoney(row.total, locale)}</span>}
        </span>
        {lines.length > 0 && <span className="block truncate text-xs text-muted-foreground"><bdi>{listOf(lines, locale)}</bdi></span>}
        <span className="flex items-center justify-between gap-3">
          <Reason row={row} />
          <time className="shrink-0 text-xs text-muted-foreground" dateTime={row.createdAt}>{relativeTime(row.createdAt, locale)}</time>
        </span>
      </button>
    </div>
  );
}

function SpamOrders() {
  const t = useT("apps");
  const common = useT("common");
  const auth = useT("auth");
  const identity = useIdentity();
  const confirm = useConfirmDialog();
  const canRead = canScope(identity, SCOPES.ORDER_PROTECTION_READ);
  const canManage = canScope(identity, SCOPES.ORDER_PROTECTION_MANAGE);
  const fetchPage = useCallback((page: { limit: number; offset: number }) => (canRead ? listAttempts({ outcome: "spam", ...page }) : Promise.resolve({ data: [], total: 0 })), [canRead]);
  const { rows, total, page, setPage, pageCount, reload: load } = useOffsetPage(fetchPage, PAGE_SIZE, () => notify.error(t("order_protection.load_failed")));
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);

  // What was picked and is no longer listed (rescued, deleted, on another page) is no longer picked.
  useEffect(() => {
    setPicked((current) => new Set([...current].filter((id) => rows?.some((row) => row.id === id))));
  }, [rows]);

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
  const opened = list.find((row) => row.id === openId) ?? null;
  const chosen = list.filter((row) => picked.has(row.id));
  const toggle = (id: string) => setPicked((current) => {
    const next = new Set(current);
    if (!next.delete(id)) next.add(id);
    return next;
  });
  const allPicked = list.length > 0 && chosen.length === list.length;
  const rowProps = (row: OrderAttempt): RowProps => ({
    row,
    onOpen: () => setOpenId(row.id),
    ...(canManage ? { pick: { picked: picked.has(row.id), onPick: () => toggle(row.id) } } : {}),
  });

  return (
    <>
      <PageHeader title={t("order_protection.spam.title")} subtitle={t("order_protection.spam.subtitle")} />
      {rows !== null && rows.length === 0 ? (
        <EmptyState icon={<Inbox size={20} aria-hidden="true" />} title={t("order_protection.spam.empty")} description={t("order_protection.spam.empty_hint")} />
      ) : (
        <Card flush className="overflow-hidden">
          {canManage && list.length > 0 && (
            <div className="flex min-h-12 flex-wrap items-center gap-3 px-4 py-2">
              <label className="flex items-center gap-2 text-sm text-foreground">
                <input type="checkbox" checked={allPicked} onChange={() => setPicked(allPicked ? new Set() : new Set(list.map((row) => row.id)))} className="size-4 cursor-pointer rounded accent-[var(--primary)] pointer-coarse:size-5" />
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
          {rows === null ? (
            <TableSkeleton columns={6} />
          ) : (
            <>
              <div className="divide-y divide-border border-t border-border md:hidden">
                {list.map((row) => (
                  <SpamMobileCard key={row.id} {...rowProps(row)} />
                ))}
              </div>
              <div className="hidden overflow-x-auto md:block">
                <Table className="min-w-[860px]">
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      {canManage && (
                        <TableHead className="w-10">
                          <span className="sr-only">{t("order_protection.spam.pick_all")}</span>
                        </TableHead>
                      )}
                      <TableHead>{t("order_protection.table.customer")}</TableHead>
                      <TableHead>{t("order_protection.table.products")}</TableHead>
                      <TableHead>{t("order_protection.table.place")}</TableHead>
                      <TableHead numeric>{t("order_protection.table.total")}</TableHead>
                      <TableHead>{t("order_protection.table.reason")}</TableHead>
                      <TableHead className="text-end">{t("order_protection.table.when")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {list.map((row) => (
                      <SpamDesktopRow key={row.id} {...rowProps(row)} />
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </Card>
      )}
      {total > PAGE_SIZE && <Pagination className="mt-3" page={page} totalPages={pageCount} total={total} pageSize={PAGE_SIZE} onPageChange={setPage} />}
      {opened && (
        <AttemptSheet
          attempt={opened}
          onClose={() => setOpenId(null)}
          footer={
            canManage ? (
              <>
                <Button variant="ghost" className="sm:me-auto" disabled={busy} onClick={() => void remove([opened])}>
                  <Trash2 size={14} aria-hidden="true" />
                  {t("order_protection.spam.delete")}
                </Button>
                {!opened.phoneBlocked && (
                  <Button variant="secondary" disabled={busy} onClick={() => void block([opened])}>
                    <Ban size={14} aria-hidden="true" />
                    {t("order_protection.spam.block")}
                  </Button>
                )}
                <Button disabled={busy} onClick={() => void rescue(opened)}>
                  <Undo2 size={14} aria-hidden="true" />
                  {t("order_protection.spam.rescue")}
                </Button>
              </>
            ) : (
              <Button variant="secondary" onClick={() => setOpenId(null)}>{common("close")}</Button>
            )
          }
        />
      )}
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
