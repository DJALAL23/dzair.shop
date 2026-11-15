/**
 * How the confirmation team's tabs arrange their rows: which tab is open,
 * a page of rows, members found by a search, results sorted by a column, and
 * the team's totals over a period and a month. Pure, so each rule is tested
 * on its own; every row comes from the server whole, in one query.
 */

import type { MemberResults, PayrollLine, TeamMember } from "./types";

export const TEAM_TABS = ["team", "results", "payroll"] as const;
export type TeamTab = (typeof TEAM_TABS)[number];

/** The tab a URL opens; payroll only for someone who may see pay. */
export function tabFrom(search: string, canSeePay: boolean): TeamTab {
  const tab = new URLSearchParams(search).get("tab");
  if (tab === "results") return "results";
  if (tab === "payroll" && canSeePay) return "payroll";
  return "team";
}

export const PAGE_SIZE = 10;

export interface Page<T> {
  rows: T[];
  page: number;
  totalPages: number;
  total: number;
}

/** One page of `items`, the page brought back within range when the list shrank. */
export function pageOf<T>(items: readonly T[], page: number, size = PAGE_SIZE): Page<T> {
  const totalPages = Math.max(1, Math.ceil(items.length / size));
  const current = Math.min(Math.max(1, page), totalPages);
  return { rows: items.slice((current - 1) * size, current * size), page: current, totalPages, total: items.length };
}

const fold = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

/** The members whose name or email holds every word of `query`, accents and case aside. */
export function findMembers(members: readonly TeamMember[], query: string): TeamMember[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...members];
  return members.filter((member) => {
    const text = fold(`${member.name} ${member.email}`);
    return words.every((word) => text.includes(word));
  });
}

export const RESULT_SORTS = ["name", "assigned", "confirmed", "cancelled", "callsBeforeCancel", "confirmationRate", "deliveryRate", "minutesToDecide"] as const;
export type ResultSort = (typeof RESULT_SORTS)[number];

/**
 * On the orders a member cancelled after the customer did not answer, how
 * many calls came first, on average; null before any. A fact for the
 * merchant to weigh, never a rule of how many calls are enough.
 */
export function callsBeforeCancel(row: Pick<MemberResults, "cancelledAfterNoAnswer" | "noAnswerCallsBeforeCancel">): number | null {
  return row.cancelledAfterNoAnswer > 0 ? row.noAnswerCallsBeforeCancel / row.cancelledAfterNoAnswer : null;
}

const valueOf = (row: MemberResults, key: Exclude<ResultSort, "name">) => (key === "callsBeforeCancel" ? callsBeforeCancel(row) : row[key]);

/** Results sorted by a column; a figure not known yet always goes last; ties by name. */
export function sortResults(rows: readonly MemberResults[], key: ResultSort, direction: "asc" | "desc"): MemberResults[] {
  const sign = direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (key === "name") return sign * a.name.localeCompare(b.name);
    const [x, y] = [valueOf(a, key), valueOf(b, key)];
    if (x === null && y === null) return a.name.localeCompare(b.name);
    if (x === null) return 1;
    if (y === null) return -1;
    return sign * (x - y) || a.name.localeCompare(b.name);
  });
}

const percent = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : null);

export interface TeamTotals {
  assigned: number;
  confirmed: number;
  cancelled: number;
  waiting: number;
  delivered: number;
  returned: number;
  /** Out of the orders confirmed or cancelled, as for each member. */
  confirmationRate: number | null;
  /** Out of the confirmed orders whose delivery ended. */
  deliveryRate: number | null;
}

/** The whole team over the period: counts added up, rates worked out from the sums, never averaged. */
export function teamTotals(rows: readonly MemberResults[]): TeamTotals {
  const sum = (pick: (row: MemberResults) => number) => rows.reduce((total, row) => total + pick(row), 0);
  const [confirmed, cancelled, delivered, returned] = [sum((r) => r.confirmed), sum((r) => r.cancelled), sum((r) => r.delivered), sum((r) => r.returned)];
  return {
    assigned: sum((r) => r.assigned),
    confirmed,
    cancelled,
    waiting: sum((r) => r.waiting),
    delivered,
    returned,
    confirmationRate: percent(confirmed, confirmed + cancelled),
    deliveryRate: percent(delivered, delivered + returned),
  };
}

export interface PayrollTotals {
  total: number;
  salaries: number;
  commissions: number;
  /** People with something to be paid. */
  paid: number;
  /** Lines with something missing. */
  incomplete: number;
}

/** The month's payroll added up, line by line, in whole dinars. */
export function payrollTotals(lines: readonly PayrollLine[]): PayrollTotals {
  return lines.reduce<PayrollTotals>(
    (totals, line) => ({
      total: totals.total + line.total,
      salaries: totals.salaries + (line.salary ?? 0),
      commissions: totals.commissions + line.confirmed.amount + line.delivered.amount,
      paid: totals.paid + (line.total > 0 ? 1 : 0),
      incomplete: totals.incomplete + (line.incomplete ? 1 : 0),
    }),
    { total: 0, salaries: 0, commissions: 0, paid: 0, incomplete: 0 },
  );
}

/** Lines that need the merchant first, then by name. */
export function orderPayroll(lines: readonly PayrollLine[]): PayrollLine[] {
  return [...lines].sort((a, b) => Number(b.incomplete) - Number(a.incomplete) || a.name.localeCompare(b.name));
}
