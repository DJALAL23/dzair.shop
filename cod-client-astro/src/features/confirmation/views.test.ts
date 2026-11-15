import { describe, expect, it } from "vitest";
import { callsBeforeCancel, findMembers, orderPayroll, pageOf, payrollTotals, sortResults, tabFrom, teamTotals } from "./views";
import type { MemberResults, PayrollLine, TeamMember } from "./types";

const member = (name: string, email: string): TeamMember => ({ userId: name, name, email, role: "staff", active: true, receiving: true, joinedAt: "2026-11-01T00:00:00.000Z", waiting: 0, callbacks: 0, reach: "own" });
const result = (name: string, fields: Partial<MemberResults> = {}): MemberResults => ({
  userId: name, name, assigned: 0, waiting: 0, confirmed: 0, cancelled: 0, delivered: 0, returned: 0, confirmationRate: null, deliveryRate: null, minutesToDecide: null, cancelledAfterNoAnswer: 0, noAnswerCallsBeforeCancel: 0, ...fields,
});
const line = (name: string, fields: Partial<PayrollLine> = {}): PayrollLine => ({
  userId: name, name, onTeam: true, joinedOn: null, leftOn: null, paySet: true, salary: null,
  confirmed: { orders: 0, amount: 0, unpriced: 0 }, delivered: { orders: 0, amount: 0, unpriced: 0 }, total: 0, incomplete: false, ...fields,
});

describe("the tab a link opens", () => {
  it("is the team, the results, or the payroll for someone who may see pay", () => {
    expect(tabFrom("", true)).toBe("team");
    expect(tabFrom("?tab=results", false)).toBe("results");
    expect(tabFrom("?tab=payroll", true)).toBe("payroll");
    expect(tabFrom("?tab=payroll", false)).toBe("team");
    expect(tabFrom("?tab=anything", true)).toBe("team");
  });
});

describe("a page of rows", () => {
  const rows = Array.from({ length: 23 }, (_, i) => i + 1);
  it("cuts the list in pages and brings a page past the end back to the last one", () => {
    expect(pageOf(rows, 1)).toEqual({ rows: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], page: 1, totalPages: 3, total: 23 });
    expect(pageOf(rows, 3).rows).toEqual([21, 22, 23]);
    expect(pageOf(rows, 9)).toMatchObject({ page: 3, rows: [21, 22, 23] });
    expect(pageOf(rows, 0).page).toBe(1);
    expect(pageOf([], 4)).toEqual({ rows: [], page: 1, totalPages: 1, total: 0 });
  });
});

describe("finding a member", () => {
  const members = [member("Samira Benali", "samira@shop.dz"), member("Karim Haddad", "karim@shop.dz"), member("Hélène Arab", "helene@shop.dz")];
  it("matches every word in the name or email, whatever the case and accents", () => {
    expect(findMembers(members, "").map((m) => m.name)).toHaveLength(3);
    expect(findMembers(members, "  karim ").map((m) => m.name)).toEqual(["Karim Haddad"]);
    expect(findMembers(members, "helene").map((m) => m.name)).toEqual(["Hélène Arab"]);
    expect(findMembers(members, "SAMIRA shop.dz").map((m) => m.name)).toEqual(["Samira Benali"]);
    expect(findMembers(members, "samira karim")).toEqual([]);
  });
});

describe("sorting the results", () => {
  const rows = [result("Samira", { assigned: 10, confirmationRate: 80 }), result("Karim", { assigned: 4, confirmationRate: null }), result("Amina", { assigned: 10, confirmationRate: 95 })];
  it("by a column either way, ties by name, a rate not known yet last both ways", () => {
    expect(sortResults(rows, "assigned", "desc").map((r) => r.name)).toEqual(["Amina", "Samira", "Karim"]);
    expect(sortResults(rows, "assigned", "asc").map((r) => r.name)).toEqual(["Karim", "Amina", "Samira"]);
    expect(sortResults(rows, "confirmationRate", "desc").map((r) => r.name)).toEqual(["Amina", "Samira", "Karim"]);
    expect(sortResults(rows, "confirmationRate", "asc").map((r) => r.name)).toEqual(["Samira", "Amina", "Karim"]);
    expect(sortResults(rows, "name", "asc").map((r) => r.name)).toEqual(["Amina", "Karim", "Samira"]);
  });

  it("by the calls before cancelling, a member who cancelled nothing after no answer last both ways", () => {
    const calls = [
      result("Samira", { cancelledAfterNoAnswer: 4, noAnswerCallsBeforeCancel: 6 }),
      result("Karim", { cancelledAfterNoAnswer: 2, noAnswerCallsBeforeCancel: 6 }),
      result("Amina"),
      result("Yacine", { cancelledAfterNoAnswer: 1, noAnswerCallsBeforeCancel: 3 }),
    ];
    expect(sortResults(calls, "callsBeforeCancel", "desc").map((r) => r.name)).toEqual(["Karim", "Yacine", "Samira", "Amina"]);
    expect(sortResults(calls, "callsBeforeCancel", "asc").map((r) => r.name)).toEqual(["Samira", "Karim", "Yacine", "Amina"]);
  });
});

describe("the calls before cancelling", () => {
  it("are the calls on the orders cancelled after no answer, on average", () => {
    expect(callsBeforeCancel({ cancelledAfterNoAnswer: 4, noAnswerCallsBeforeCancel: 6 })).toBe(1.5);
    expect(callsBeforeCancel({ cancelledAfterNoAnswer: 1, noAnswerCallsBeforeCancel: 3 })).toBe(3);
  });

  it("are not known before an order was cancelled after no answer", () => {
    expect(callsBeforeCancel({ cancelledAfterNoAnswer: 0, noAnswerCallsBeforeCancel: 0 })).toBeNull();
  });
});

describe("the team's totals", () => {
  it("add the counts up and work the rates out from the sums, never by averaging the members' rates", () => {
    const totals = teamTotals([
      result("A", { assigned: 10, confirmed: 9, cancelled: 1, delivered: 1, returned: 0, waiting: 0, confirmationRate: 90, deliveryRate: 100 }),
      result("B", { assigned: 100, confirmed: 50, cancelled: 50, delivered: 10, returned: 30, waiting: 4, confirmationRate: 50, deliveryRate: 25 }),
    ]);
    expect(totals).toEqual({ assigned: 110, confirmed: 59, cancelled: 51, waiting: 4, delivered: 11, returned: 30, confirmationRate: 54, deliveryRate: 27 });
    expect(teamTotals([])).toEqual({ assigned: 0, confirmed: 0, cancelled: 0, waiting: 0, delivered: 0, returned: 0, confirmationRate: null, deliveryRate: null });
  });
});

describe("the month's payroll", () => {
  const lines = [
    line("Samira", { salary: 30000, confirmed: { orders: 20, amount: 2000, unpriced: 0 }, delivered: { orders: 10, amount: 1500, unpriced: 0 }, total: 33500 }),
    line("Karim", { confirmed: { orders: 3, amount: 360, unpriced: 2 }, total: 360, incomplete: true }),
    line("Admin", { paySet: false, incomplete: true }),
  ];
  it("adds up what is owed, salaries and commissions apart, and counts what is missing", () => {
    expect(payrollTotals(lines)).toEqual({ total: 33860, salaries: 30000, commissions: 3860, paid: 2, incomplete: 2 });
  });

  it("puts the lines that need the merchant first", () => {
    expect(orderPayroll(lines).map((l) => l.name)).toEqual(["Admin", "Karim", "Samira"]);
  });
});
