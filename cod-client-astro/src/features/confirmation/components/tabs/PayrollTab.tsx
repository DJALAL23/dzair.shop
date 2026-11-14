import { useEffect, useState } from "react";
import { AlertTriangle, Banknote, Coins, Pencil, Wallet } from "lucide-react";
import { useLocale, useT } from "@/i18n/react";
import {
  Card,
  CellEmpty,
  EmptyState,
  IconButton,
  InfoTip,
  Initial,
  Pagination,
  RowActions,
  StatStrip,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableSkeleton,
  showRowOnClick,
} from "@/components/ui";
import { formatMoney } from "@/features/orders/model";
import { getPayroll } from "@/features/confirmation/api";
import { formatStoreDayShort, storeMonth } from "@/lib/store-time";
import { MonthSwitcher } from "@/components/period/MonthSwitcher";
import { orderPayroll, pageOf, PAGE_SIZE, payrollTotals } from "@/features/confirmation/views";
import { MemberPayDialog } from "@/features/confirmation/components/MemberPayDialog";
import type { Commission, PayrollLine } from "@/features/confirmation/types";

/**
 * A month's payroll: what the team is owed, salaries and commissions apart,
 * then each person with how their pay is made up; a row opens their pay.
 * Pay is set from a date, so a past month never changes.
 */
export function PayrollTab({ version, canManage, onChanged }: { version: number; canManage: boolean; onChanged: () => void }) {
  const t = useT("confirmation");
  const locale = useLocale();
  const thisMonth = storeMonth();
  const [month, setMonth] = useState(thisMonth);
  const [lines, setLines] = useState<PayrollLine[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<PayrollLine | null>(null);

  useEffect(() => {
    let current = true;
    setLines(null);
    setFailed(false);
    getPayroll(month)
      .then((rows) => current && setLines(orderPayroll(rows)))
      .catch(() => current && setFailed(true));
    return () => {
      current = false;
    };
  }, [month, version]);

  const money = (amount: number) => formatMoney(amount, locale);
  const totals = lines ? payrollTotals(lines) : null;
  const shown = lines ? pageOf(lines, page) : null;
  const go = (next: string) => {
    setMonth(next);
    setPage(1);
  };
  const openLabel = (line: PayrollLine) => (canManage ? t("pay.edit_for", { name: line.name }) : t("pay.see_for", { name: line.name }));

  return (
    <div className="@container space-y-4">
      <MonthSwitcher month={month} onChange={go} />

      {failed ? (
        <Card>
          <p className="text-sm text-muted-foreground">{t("pay.load_error")}</p>
        </Card>
      ) : !lines || !totals || !shown ? (
        <div className="space-y-4">
          <div className="h-24 shimmer rounded-xl" />
          <Card flush className="overflow-hidden">
            <TableSkeleton rows={4} columns={5} />
          </Card>
        </div>
      ) : lines.length === 0 ? (
        <Card>
          <EmptyState icon={<Wallet />} title={t("pay.payroll_empty")} description={t("pay.payroll_empty_body")} />
        </Card>
      ) : (
        <>
          <StatStrip
            items={[
              {
                label: month === thisMonth ? t("pay.stat_total_so_far") : t("pay.stat_total"),
                value: money(totals.total),
                hint: totals.incomplete > 0 ? t("pay.incomplete_title", { count: totals.incomplete }) : undefined,
                icon: Wallet,
                tone: totals.incomplete > 0 ? "warning" : "neutral",
              },
              { label: t("pay.salaries"), value: money(totals.salaries), icon: Banknote },
              { label: t("pay.commissions"), value: money(totals.commissions), icon: Coins },
            ]}
          />

          <Card flush className="overflow-hidden">
            <ul className="divide-y divide-border @3xl:hidden">
              {shown.rows.map((line) => (
                <li key={line.userId}>
                  <button type="button" onClick={() => setEditing(line)} aria-label={openLabel(line)} className="flex w-full items-start gap-3 px-4 py-3 text-start transition-colors active:bg-subtle">
                    <Initial name={line.name} className="size-9" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground">{line.name}</span>
                      <PersonMeta line={line} month={month} />
                      <span className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                        <span>
                          {t("pay.salary")}: <span className="tabular-nums text-foreground">{line.salary === null ? "—" : money(line.salary)}</span>
                        </span>
                        {line.confirmed.orders > 0 && (
                          <span>
                            {t("pay.per_confirmed")}: <span className="tabular-nums text-foreground">{money(line.confirmed.amount)}</span>
                          </span>
                        )}
                        {line.delivered.orders > 0 && (
                          <span>
                            {t("pay.per_delivered")}: <span className="tabular-nums text-foreground">{money(line.delivered.amount)}</span>
                          </span>
                        )}
                      </span>
                    </span>
                    <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">{money(line.total)}</span>
                  </button>
                </li>
              ))}
              <li className="flex items-center justify-between gap-3 bg-subtle px-4 py-3 text-sm font-semibold text-foreground">
                <span>{lines.length > PAGE_SIZE ? t("pay.total_everyone", { count: lines.length }) : t("pay.total")}</span>
                <span className="tabular-nums">{money(totals.total)}</span>
              </li>
            </ul>
            <div className="relative hidden overflow-x-auto @3xl:block">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>{t("results.member")}</TableHead>
                    <TableHead numeric>
                      <Head label={t("pay.salary")} help={t("pay.salary_help")} />
                    </TableHead>
                    <TableHead numeric>
                      <Head label={t("pay.per_confirmed")} help={t("pay.per_confirmed_help")} />
                    </TableHead>
                    <TableHead numeric>
                      <Head label={t("pay.per_delivered")} help={t("pay.per_delivered_help")} />
                    </TableHead>
                    <TableHead numeric>{t("pay.total")}</TableHead>
                    <TableHead className="w-px">
                      <span className="sr-only">{t("pay.edit")}</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shown.rows.map((line) => (
                    <TableRow key={line.userId} onClick={showRowOnClick(() => setEditing(line))} className="cursor-pointer">
                      <TableCell className="w-full max-w-80">
                        <span className="flex min-w-0 items-center gap-3">
                          <Initial name={line.name} />
                          <span className="min-w-0">
                            <span className="block truncate font-medium text-foreground">{line.name}</span>
                            <PersonMeta line={line} month={month} />
                          </span>
                        </span>
                      </TableCell>
                      <TableCell numeric>{line.salary === null ? <CellEmpty /> : money(line.salary)}</TableCell>
                      <TableCell numeric>
                        <CommissionCell part={line.confirmed} />
                      </TableCell>
                      <TableCell numeric>
                        <CommissionCell part={line.delivered} />
                      </TableCell>
                      <TableCell numeric className="font-semibold">
                        {money(line.total)}
                      </TableCell>
                      <TableCell className="w-px">
                        <RowActions>
                          <IconButton type="button" onClick={() => setEditing(line)} aria-label={openLabel(line)} title={openLabel(line)}>
                            {canManage ? <Pencil size={15} aria-hidden="true" /> : <Wallet size={15} aria-hidden="true" />}
                          </IconButton>
                        </RowActions>
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="bg-subtle font-semibold hover:bg-subtle">
                    <TableCell>{lines.length > PAGE_SIZE ? t("pay.total_everyone", { count: lines.length }) : t("pay.total")}</TableCell>
                    <TableCell numeric>{money(totals.salaries)}</TableCell>
                    <TableCell numeric>{money(lines.reduce((sum, line) => sum + line.confirmed.amount, 0))}</TableCell>
                    <TableCell numeric>{money(lines.reduce((sum, line) => sum + line.delivered.amount, 0))}</TableCell>
                    <TableCell numeric>{money(totals.total)}</TableCell>
                    <TableCell />
                  </TableRow>
                </TableBody>
              </Table>
            </div>
            {shown.totalPages > 1 && <Pagination page={shown.page} totalPages={shown.totalPages} total={shown.total} pageSize={PAGE_SIZE} onPageChange={setPage} />}
          </Card>
        </>
      )}

      {editing && <MemberPayDialog member={editing} canManage={canManage} onClose={() => setEditing(null)} onChanged={onChanged} />}
    </div>
  );
}

/** One quiet line under a name: when they joined or left in the month, and what is missing. */
function PersonMeta({ line, month }: { line: PayrollLine; month: string }) {
  const t = useT("confirmation");
  const locale = useLocale();
  const joinedOn = line.joinedOn && line.joinedOn > `${month}-01` ? line.joinedOn : null;
  const facts = [
    joinedOn && t("pay.joined_on", { date: formatStoreDayShort(joinedOn, locale) }),
    line.leftOn && t("pay.left_on", { date: formatStoreDayShort(line.leftOn, locale) }),
    !line.onTeam && t("pay.not_on_team"),
  ].filter(Boolean);
  const missing = line.incomplete ? (!line.paySet ? t("pay.not_set") : t("pay.unpriced", { count: line.confirmed.unpriced + line.delivered.unpriced })) : null;
  if (facts.length === 0 && !missing) return null;
  return (
    <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
      {facts.length > 0 && <span>{facts.join(" · ")}</span>}
      {missing && (
        <span className="inline-flex items-center gap-1 font-medium text-[var(--tone-warning-text)]">
          <AlertTriangle size={12} className="shrink-0" aria-hidden="true" />
          {missing}
        </span>
      )}
    </span>
  );
}

function CommissionCell({ part }: { part: Commission }) {
  const t = useT("confirmation");
  const locale = useLocale();
  if (part.orders === 0) return <CellEmpty />;
  return (
    <span className="inline-flex flex-col items-end">
      <span className="tabular-nums text-foreground">{formatMoney(part.amount, locale)}</span>
      <span className="text-xs text-muted-foreground">{t("pay.orders_count", { count: part.orders })}</span>
    </span>
  );
}

function Head({ label, help }: { label: string; help: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      {label}
      <InfoTip>{help}</InfoTip>
    </span>
  );
}
