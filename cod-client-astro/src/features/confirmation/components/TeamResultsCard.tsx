import { useEffect, useState } from "react";
import { useLocale, useT } from "@/i18n/react";
import { Card, InfoTip, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Tabs } from "@/components/ui";
import { getTeamResults } from "@/features/confirmation/api";
import { periodRange, RESULTS_PERIODS, splitMinutes, type ResultsPeriod } from "@/features/confirmation/model";
import type { MemberResults } from "@/features/confirmation/types";

/**
 * Each member's results over a period: the orders placed in it that are
 * with them now, how many they confirmed or cancelled, the share confirmed
 * and delivered, and how fast they first act on an order. Each rate says
 * what it is out of.
 */
export function TeamResultsCard({ version }: { version: number }) {
  const t = useT("confirmation");
  const locale = useLocale();
  const [period, setPeriod] = useState<ResultsPeriod>("7d");
  const [rows, setRows] = useState<MemberResults[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let current = true;
    setRows(null);
    setFailed(false);
    const { from, to } = periodRange(period);
    getTeamResults(from, to)
      .then((results) => current && setRows([...results].sort((a, b) => b.assigned - a.assigned || a.name.localeCompare(b.name))))
      .catch(() => current && setFailed(true));
    return () => {
      current = false;
    };
  }, [period, version]);

  const number = (value: number) => new Intl.NumberFormat(locale === "ar" ? "ar-DZ" : `${locale}-DZ`).format(value);
  const rate = (value: number | null) => (value === null ? "—" : `${number(value)}%`);
  const speed = (minutes: number | null) => {
    if (minutes === null) return "—";
    const parts = splitMinutes(minutes);
    return parts.hours > 0 ? t("results.hours", { hours: number(parts.hours), minutes: String(parts.minutes).padStart(2, "0") }) : t("results.minutes", { minutes: number(parts.minutes) });
  };
  const head = (label: string, help?: string) => (
    <span className="inline-flex items-center gap-1">
      {label}
      {help && <InfoTip>{help}</InfoTip>}
    </span>
  );

  return (
    <Card title={t("results.title")} help={t("results.explain")} flush>
      <Tabs
        label={t("results.period")}
        value={period}
        onChange={setPeriod}
        items={RESULTS_PERIODS.map((key) => ({ key, label: t(`results.periods.${key}`) }))}
        className="px-2 pb-2"
      />
      {failed ? (
        <p className="border-t border-border px-4 py-6 text-sm text-muted-foreground">{t("results.error")}</p>
      ) : rows === null ? (
        <div className="space-y-2 border-t border-border p-4">
          <div className="h-5 shimmer rounded" />
          <div className="h-5 shimmer rounded" />
        </div>
      ) : rows.length === 0 ? (
        <p className="border-t border-border px-4 py-6 text-sm text-muted-foreground">{t("results.empty")}</p>
      ) : (
        <>
          <div className="divide-y divide-border border-t border-border md:hidden">
            {rows.map((row) => (
              <article key={row.userId} className="px-4 py-3">
                <p className="font-semibold text-foreground">{row.name}</p>
                <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
                  <Figure label={t("results.orders")} value={number(row.assigned)} />
                  <Figure label={t("results.rate")} value={rate(row.confirmationRate)} />
                  <Figure label={t("results.delivery")} value={rate(row.deliveryRate)} />
                  <Figure label={t("results.confirmed")} value={number(row.confirmed)} />
                  <Figure label={t("results.cancelled")} value={number(row.cancelled)} />
                  <Figure label={t("results.speed")} value={speed(row.minutesToDecide)} />
                </dl>
              </article>
            ))}
          </div>
          <div className="relative hidden overflow-x-auto md:block">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>{t("results.member")}</TableHead>
                  <TableHead numeric>{t("results.orders")}</TableHead>
                  <TableHead numeric>{t("results.confirmed")}</TableHead>
                  <TableHead numeric>{t("results.cancelled")}</TableHead>
                  <TableHead numeric>{head(t("results.rate"), t("results.rate_help"))}</TableHead>
                  <TableHead numeric>{head(t("results.delivery"), t("results.delivery_help"))}</TableHead>
                  <TableHead numeric>{head(t("results.speed"), t("results.speed_help"))}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.userId} className="hover:bg-transparent">
                    <TableCell className="font-medium text-foreground">{row.name}</TableCell>
                    <TableCell numeric>
                      {number(row.assigned)}
                      {row.waiting > 0 && <span className="ms-1.5 text-xs text-muted-foreground">{t("results.still_waiting", { count: row.waiting })}</span>}
                    </TableCell>
                    <TableCell numeric>{number(row.confirmed)}</TableCell>
                    <TableCell numeric>{number(row.cancelled)}</TableCell>
                    <TableCell numeric className="font-semibold">{rate(row.confirmationRate)}</TableCell>
                    <TableCell numeric className="font-semibold">{rate(row.deliveryRate)}</TableCell>
                    <TableCell numeric>{speed(row.minutesToDecide)}</TableCell>
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

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">{value}</dd>
    </div>
  );
}
