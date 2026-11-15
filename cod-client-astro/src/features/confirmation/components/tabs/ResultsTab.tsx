import { useEffect, useState } from "react";
import { CheckCircle2, Inbox, PackageCheck, Percent } from "lucide-react";
import { useLocale, useT } from "@/i18n/react";
import { Card, CellEmpty, Initial, Pagination, RowTitle, Select, SortHeader, StatStrip, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableSkeleton } from "@/components/ui";
import { getTeamResults } from "@/features/confirmation/api";
import { periodRange, RESULTS_PERIODS, splitMinutes, type ResultsPeriod } from "@/features/confirmation/model";
import { callsBeforeCancel, pageOf, PAGE_SIZE, RESULT_SORTS, sortResults, teamTotals, type ResultSort } from "@/features/confirmation/views";
import type { MemberResults } from "@/features/confirmation/types";

/**
 * How the team did over a period: the team's totals first, worked out from
 * the sums, then each member, sortable by any column and paged — with how
 * many calls they made before cancelling an order nobody answered, for the
 * merchant to judge.
 */
export function ResultsTab({ version }: { version: number }) {
  const t = useT("confirmation");
  const locale = useLocale();
  const [period, setPeriod] = useState<ResultsPeriod>("7d");
  const [rows, setRows] = useState<MemberResults[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [sort, setSort] = useState<{ key: ResultSort; direction: "asc" | "desc" }>({ key: "assigned", direction: "desc" });
  const [page, setPage] = useState(1);

  useEffect(() => {
    let current = true;
    setRows(null);
    setFailed(false);
    setPage(1);
    const { from, to } = periodRange(period);
    getTeamResults(from, to)
      .then((results) => current && setRows(results))
      .catch(() => current && setFailed(true));
    return () => {
      current = false;
    };
  }, [period, version]);

  const numbers = locale === "ar" ? "ar-DZ" : `${locale}-DZ`;
  const number = (value: number) => new Intl.NumberFormat(numbers).format(value);
  const calls = (row: MemberResults) => {
    const average = callsBeforeCancel(row);
    return average === null ? null : new Intl.NumberFormat(numbers, { maximumFractionDigits: 1 }).format(average);
  };
  const rate = (value: number | null) => (value === null ? null : `${number(value)}%`);
  const speed = (minutes: number | null) => {
    if (minutes === null) return null;
    const parts = splitMinutes(minutes);
    return parts.hours > 0 ? t("results.hours", { hours: number(parts.hours), minutes: String(parts.minutes).padStart(2, "0") }) : t("results.minutes", { minutes: number(parts.minutes) });
  };
  const sortBy = (key: string) => {
    setSort((current) => ({ key: key as ResultSort, direction: current.key === key && current.direction === "desc" ? "asc" : key === "name" ? "asc" : "desc" }));
    setPage(1);
  };

  const totals = rows ? teamTotals(rows) : null;
  const shown = rows ? pageOf(sortResults(rows, sort.key, sort.direction), page) : null;
  const head = (key: ResultSort, label: string, help?: string) => (
    <SortHeader label={label} sortKey={key} activeKey={sort.key} direction={sort.direction} onSort={sortBy} align={key === "name" ? "start" : "end"} help={help} wrap={help !== undefined} />
  );

  return (
    <div className="@container space-y-4">
      <Select
        aria-label={t("results.period")}
        value={period}
        onChange={(event) => setPeriod(event.currentTarget.value as ResultsPeriod)}
        variant="pill"
        wrapperClassName="inline-flex"
      >
        {RESULTS_PERIODS.map((key) => (
          <option key={key} value={key}>
            {t(`results.periods.${key}`)}
          </option>
        ))}
      </Select>

      {failed ? (
        <Card>
          <p className="text-sm text-muted-foreground">{t("results.error")}</p>
        </Card>
      ) : !rows || !totals || !shown ? (
        <div className="space-y-4">
          <div className="h-24 shimmer rounded-xl" />
          <Card flush className="overflow-hidden">
            <TableSkeleton rows={4} columns={6} />
          </Card>
        </div>
      ) : (
        <>
          <StatStrip
            items={[
              { label: t("results.orders"), value: number(totals.assigned), hint: totals.waiting > 0 ? t("results.still_waiting", { count: totals.waiting }) : undefined, icon: Inbox },
              { label: t("results.confirmed"), value: number(totals.confirmed), hint: t("results.cancelled_count", { count: totals.cancelled }), icon: CheckCircle2 },
              { label: t("results.rate"), value: rate(totals.confirmationRate) ?? "—", hint: t("results.rate_short"), icon: Percent },
              { label: t("results.delivery"), value: rate(totals.deliveryRate) ?? "—", hint: t("results.delivery_counts", { delivered: number(totals.delivered), returned: number(totals.returned) }), icon: PackageCheck },
            ]}
          />

          <Card flush className="overflow-hidden">
            {rows.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-muted-foreground">{t("results.empty")}</p>
            ) : (
              <>
                <div className="flex items-center justify-end gap-2 p-2 @4xl:hidden">
                  <span className="text-xs text-muted-foreground">{t("results.sort_by")}</span>
                  <Select
                    aria-label={t("results.sort_by")}
                    size="sm"
                    value={sort.key}
                    onChange={(event) => {
                      const key = event.currentTarget.value as ResultSort;
                      setSort({ key, direction: key === "name" ? "asc" : "desc" });
                      setPage(1);
                    }}
                  >
                    {RESULT_SORTS.map((key) => (
                      <option key={key} value={key}>
                        {t(`results.sorts.${key}`)}
                      </option>
                    ))}
                  </Select>
                </div>
                <ul className="divide-y divide-border border-t border-border @4xl:hidden">
                  {shown.rows.map((row) => (
                    <li key={row.userId} className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Initial name={row.name} className="size-9" />
                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{row.name}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {t("results.orders_count", { count: row.assigned })}
                          {row.waiting > 0 && ` · ${t("results.still_waiting", { count: row.waiting })}`}
                        </span>
                      </div>
                      <dl className="mt-2.5 grid grid-cols-3 gap-x-2 gap-y-2.5 rounded-lg bg-subtle p-2.5 text-xs @xl:grid-cols-6">
                        <Figure label={t("results.rate")} value={rate(row.confirmationRate)} strong />
                        <Figure label={t("results.delivery")} value={rate(row.deliveryRate)} strong />
                        <Figure label={t("results.speed")} value={speed(row.minutesToDecide)} />
                        <Figure label={t("results.confirmed")} value={number(row.confirmed)} />
                        <Figure label={t("results.cancelled")} value={number(row.cancelled)} />
                        <Figure label={t("results.calls_before_cancel")} value={calls(row)} />
                      </dl>
                    </li>
                  ))}
                </ul>
                <div className="relative hidden overflow-x-auto @4xl:block">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        {head("name", t("results.member"))}
                        {head("assigned", t("results.orders"))}
                        <TableHead numeric>{t("results.waiting")}</TableHead>
                        {head("confirmed", t("results.confirmed"))}
                        {head("cancelled", t("results.cancelled"))}
                        {head("callsBeforeCancel", t("results.calls_before_cancel"), t("results.calls_before_cancel_help"))}
                        {head("confirmationRate", t("results.rate"), t("results.rate_help"))}
                        {head("deliveryRate", t("results.delivery"), t("results.delivery_help"))}
                        {head("minutesToDecide", t("results.speed"), t("results.speed_help"))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {shown.rows.map((row) => (
                        <TableRow key={row.userId}>
                          <TableCell className="w-full max-w-72">
                            <RowTitle media={<Initial name={row.name} />}>{row.name}</RowTitle>
                          </TableCell>
                          <TableCell numeric>{number(row.assigned)}</TableCell>
                          <TableCell numeric className="text-muted-foreground">
                            {row.waiting > 0 ? number(row.waiting) : <CellEmpty />}
                          </TableCell>
                          <TableCell numeric>{number(row.confirmed)}</TableCell>
                          <TableCell numeric>{number(row.cancelled)}</TableCell>
                          <TableCell numeric>
                            {calls(row) === null ? <CellEmpty /> : <span title={t("results.no_answer_cancels", { count: row.cancelledAfterNoAnswer })}>{calls(row)}</span>}
                          </TableCell>
                          <TableCell numeric className="font-semibold">
                            {rate(row.confirmationRate) ?? <CellEmpty />}
                          </TableCell>
                          <TableCell numeric className="font-semibold">
                            {rate(row.deliveryRate) ?? <CellEmpty />}
                          </TableCell>
                          <TableCell numeric>{speed(row.minutesToDecide) ?? <CellEmpty />}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                {shown.totalPages > 1 && <Pagination page={shown.page} totalPages={shown.totalPages} total={shown.total} pageSize={PAGE_SIZE} onPageChange={setPage} />}
              </>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function Figure({ label, value, strong = false }: { label: string; value: string | null; strong?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="leading-tight text-muted-foreground">{label}</dt>
      <dd className={`mt-0.5 text-sm tabular-nums ${value === null ? "text-subtle-foreground" : strong ? "font-semibold text-foreground" : "text-foreground"}`}>{value ?? "—"}</dd>
    </div>
  );
}
