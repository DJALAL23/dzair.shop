import { useEffect, useState } from "react";
import { AlertTriangle, ChevronLeft, ChevronRight } from "lucide-react";
import { useLocale, useT } from "@/i18n/react";
import { Card, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui";
import { formatMoney } from "@/features/orders/model";
import { getPayroll } from "@/features/confirmation/api";
import { formatMonth, shiftMonth, storeMonth } from "@/features/confirmation/model";
import type { Commission, PayrollLine } from "@/features/confirmation/types";

/**
 * A month's payroll: each member's salary in force at the month's end, and
 * their commission on the orders they confirmed and on those delivered in
 * it, each at the rate of its day. What has no rate is named, never counted
 * as zero, so the merchant knows the total is not complete.
 */
export function PayrollCard({ version, onEditPay }: { version: number; onEditPay?: (line: PayrollLine) => void }) {
  const t = useT("confirmation");
  const locale = useLocale();
  const thisMonth = storeMonth();
  const [month, setMonth] = useState(thisMonth);
  const [lines, setLines] = useState<PayrollLine[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let current = true;
    setLines(null);
    setFailed(false);
    getPayroll(month)
      .then((rows) => current && setLines(rows))
      .catch(() => current && setFailed(true));
    return () => {
      current = false;
    };
  }, [month, version]);

  const money = (amount: number) => formatMoney(amount, locale);
  const total = (lines ?? []).reduce((sum, line) => sum + line.total, 0);
  const incomplete = (lines ?? []).some((line) => line.incomplete);

  const nav = (
    <div className="flex items-center gap-1">
      <button type="button" onClick={() => setMonth(shiftMonth(month, -1))} aria-label={t("pay.previous_month")} className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground pointer-coarse:size-10">
        <ChevronLeft size={16} className="rtl:rotate-180" aria-hidden="true" />
      </button>
      <span className="min-w-32 text-center text-sm font-semibold capitalize text-foreground">{formatMonth(month, locale)}</span>
      <button
        type="button"
        disabled={month >= thisMonth}
        onClick={() => setMonth(shiftMonth(month, 1))}
        aria-label={t("pay.next_month")}
        className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30 pointer-coarse:size-10"
      >
        <ChevronRight size={16} className="rtl:rotate-180" aria-hidden="true" />
      </button>
    </div>
  );

  const commission = (part: Commission) => (
    <span className="inline-flex flex-col items-end">
      <span className="tabular-nums">{money(part.amount)}</span>
      <span className="text-xs text-muted-foreground">{t("pay.orders_count", { count: part.orders })}</span>
      {part.unpriced > 0 && <span className="text-xs font-medium text-[var(--tone-warning-text)]">{t("pay.unpriced", { count: part.unpriced })}</span>}
    </span>
  );

  const flag = (line: PayrollLine) =>
    line.incomplete && (
      <span className="mt-0.5 flex items-center gap-1 text-xs font-medium text-[var(--tone-warning-text)]">
        <AlertTriangle size={12} aria-hidden="true" />
        {line.paySet ? t("pay.incomplete") : t("pay.not_set")}
        {onEditPay && (
          <button type="button" onClick={() => onEditPay(line)} className="underline underline-offset-2">
            {t("pay.fix")}
          </button>
        )}
      </span>
    );

  return (
    <Card title={t("pay.payroll")} help={t("pay.explain")} action={nav} flush>
      {failed ? (
        <p className="border-t border-border px-4 py-6 text-sm text-muted-foreground">{t("pay.load_error")}</p>
      ) : lines === null ? (
        <div className="space-y-2 border-t border-border p-4">
          <div className="h-5 shimmer rounded" />
          <div className="h-5 shimmer rounded" />
        </div>
      ) : lines.length === 0 ? (
        <p className="border-t border-border px-4 py-6 text-sm text-muted-foreground">{t("pay.payroll_empty")}</p>
      ) : (
        <>
          <div className="divide-y divide-border border-t border-border md:hidden">
            {lines.map((line) => (
              <article key={line.userId} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-foreground">{line.name}</p>
                    {flag(line)}
                  </div>
                  <span className="shrink-0 font-semibold tabular-nums text-foreground">{money(line.total)}</span>
                </div>
                <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <dt className="text-muted-foreground">{t("pay.salary")}</dt>
                    <dd className="mt-0.5 tabular-nums text-foreground">{line.salary === null ? "—" : money(line.salary)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">{t("pay.per_confirmed")}</dt>
                    <dd className="mt-0.5 tabular-nums text-foreground">{money(line.confirmed.amount)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">{t("pay.per_delivered")}</dt>
                    <dd className="mt-0.5 tabular-nums text-foreground">{money(line.delivered.amount)}</dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
          <div className="relative hidden overflow-x-auto md:block">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>{t("results.member")}</TableHead>
                  <TableHead numeric>{t("pay.salary")}</TableHead>
                  <TableHead numeric>{t("pay.per_confirmed")}</TableHead>
                  <TableHead numeric>{t("pay.per_delivered")}</TableHead>
                  <TableHead numeric>{t("pay.total")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((line) => (
                  <TableRow key={line.userId} className="align-top hover:bg-transparent">
                    <TableCell>
                      <p className="font-medium text-foreground">{line.name}</p>
                      {flag(line)}
                    </TableCell>
                    <TableCell numeric>{line.salary === null ? "—" : money(line.salary)}</TableCell>
                    <TableCell numeric>{commission(line.confirmed)}</TableCell>
                    <TableCell numeric>{commission(line.delivered)}</TableCell>
                    <TableCell numeric className="font-semibold text-foreground">
                      {money(line.total)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3 text-sm">
            <span className="font-semibold text-foreground">{incomplete ? t("pay.total_so_far") : t("pay.total_month")}</span>
            <span className="font-semibold tabular-nums text-foreground">{money(total)}</span>
          </div>
        </>
      )}
    </Card>
  );
}
