import { describe, expect, it } from "vitest";
import type { Translate } from "@/i18n/core";
import { assignedLine, assignmentWay, confirmationHistory, gapLine, gapWords, historyGaps } from "./history";
import type { AssignmentStep, StatusHistoryItem } from "@/features/orders/types";

const AT = "2026-11-14T08:00:00.000Z";
const status = (id: string, value: StatusHistoryItem["status"], timestamp: string, byName: string | null = null): StatusHistoryItem => ({ id, status: value, timestamp, by: null, byName });
const handover = (id: string, at: string, to: string | null, way: AssignmentStep["way"] = "automatic", extra: Partial<AssignmentStep> = {}): AssignmentStep => ({
  id, at, to: to === null ? null : { id: `u-${to}`, name: to }, from: null, way, byName: null, ...extra,
});
const brief = (entries: ReturnType<typeof confirmationHistory>) =>
  entries.map((entry) => (entry.kind === "handover" ? `to ${entry.step.to?.name ?? "nobody"}` : entry.call === null ? entry.status : `call ${entry.call}`));

describe("an order's confirmation history", () => {
  it("tells it newest first: placed, given out, each call by its number, then the decision", () => {
    const entries = confirmationHistory({
      unansweredCalls: 2,
      statusHistory: [status("p", "new", AT), status("u1", "unreachable", "2026-11-14T09:00:00.000Z", "Samira"), status("u2", "unreachable", "2026-11-14T13:00:00.000Z", "Samira"), status("c", "cancelled", "2026-11-14T15:00:00.000Z", "Samira")],
      assignmentHistory: [handover("a", AT, "Samira")],
    });
    expect(brief(entries)).toEqual(["cancelled", "call 2", "call 1", "to Samira", "new"]);
    expect(entries[0]).toMatchObject({ kind: "status", byName: "Samira", at: "2026-11-14T15:00:00.000Z" });
  });

  it("leaves out what comes after the confirmation: preparing and shipping", () => {
    const entries = confirmationHistory({
      unansweredCalls: 0,
      statusHistory: [status("p", "new", AT), status("c", "confirmed", "2026-11-14T09:00:00.000Z"), status("r", "preparing", "2026-11-14T10:00:00.000Z"), status("y", "ready", "2026-11-14T11:00:00.000Z")],
      assignmentHistory: [],
    });
    expect(brief(entries)).toEqual(["confirmed", "new"]);
  });

  it("at one instant, puts the order placed first, then given out, then worked", () => {
    const entries = confirmationHistory({
      unansweredCalls: 1,
      statusHistory: [status("z-call", "unreachable", AT), status("z-placed", "new", AT)],
      assignmentHistory: [handover("z-given", AT, "Karim")],
    });
    expect(brief(entries)).toEqual(["call 1", "to Karim", "new"]);
  });

  it("orders two handovers of the same instant by id, and keeps an order handed back to nobody", () => {
    const entries = confirmationHistory({
      unansweredCalls: 0,
      statusHistory: [],
      assignmentHistory: [handover("a", AT, "Samira"), handover("b", AT, null, "manual", { byName: "Bilal" })],
    });
    expect(brief(entries)).toEqual(["to nobody", "to Samira"]);
  });

  it("says no call number the order does not count, and works without an assignment history", () => {
    const entries = confirmationHistory({ unansweredCalls: 0, statusHistory: [status("u", "unreachable", AT)], assignmentHistory: undefined });
    expect(entries).toEqual([{ kind: "status", id: "u", at: AT, status: "unreachable", byName: null, call: null }]);
  });
});

describe("how an order came to its member", () => {
  const words: Translate = (key, values) => `${key}${values ? JSON.stringify(values) : ""}`;

  it("names the rule, the manager, or the member it was taken back from", () => {
    expect(assignmentWay(words, handover("a", AT, "Samira"))).toBe("order.way_automatic");
    expect(assignmentWay(words, handover("a", AT, "Samira", "manual", { byName: "Bilal" }))).toBe('order.way_manual{"name":"Bilal"}');
    expect(assignmentWay(words, handover("a", AT, "Samira", "take_back", { from: { id: "u-k", name: "Karim" } }))).toBe('order.way_take_back{"name":"Karim"}');
    expect(assignmentWay(words, handover("a", AT, null, "manual", { byName: "Bilal" }))).toBe('order.way_unassigned{"name":"Bilal"}');
  });
});

describe("when and how the order came to the member who has it, in one line", () => {
  const words: Translate = (key, values) => `${key}${values ? JSON.stringify(values) : ""}`;

  it("says when, and how: by the rule, by a manager, or taken back from a member", () => {
    expect(assignedLine(words, "yesterday", handover("a", AT, "Samira"), "u-Samira")).toBe('order.since_automatic{"time":"yesterday"}');
    expect(assignedLine(words, "yesterday", handover("a", AT, "Samira", "manual", { byName: "Bilal" }), "u-Samira")).toBe('order.since_manual{"time":"yesterday","name":"Bilal"}');
    expect(assignedLine(words, "yesterday", handover("a", AT, "Samira", "take_back", { from: { id: "u-k", name: "Karim" } }), "u-Samira")).toBe(
      'order.since_take_back{"time":"yesterday","name":"Karim"}',
    );
  });

  it("says only when, if the latest handover is not to the member who has it, or names nobody", () => {
    expect(assignedLine(words, "yesterday", undefined, "u-Samira")).toBe('order.since{"time":"yesterday"}');
    expect(assignedLine(words, "yesterday", handover("a", AT, "Karim"), "u-Samira")).toBe('order.since{"time":"yesterday"}');
    expect(assignedLine(words, "yesterday", handover("a", AT, null, "manual", { byName: "Bilal" }), "u-Samira")).toBe('order.since{"time":"yesterday"}');
    expect(assignedLine(words, "yesterday", handover("a", AT, "Samira", "manual"), "u-Samira")).toBe('order.since{"time":"yesterday"}');
    expect(assignedLine(words, "yesterday", handover("a", AT, "Samira", "take_back"), "u-Samira")).toBe('order.since{"time":"yesterday"}');
  });
});

describe("how long after the step before it each call and decision came", () => {
  const words: Translate = (key, values) => `${key}${values ? JSON.stringify(values) : ""}`;
  const at = (minutes: number) => new Date(Date.parse(AT) + minutes * 60_000).toISOString();

  it("times the first call from the order being placed, each later call from the one before, and the decision from the last call", () => {
    const entries = confirmationHistory({
      statusHistory: [status("p", "new", at(0)), status("c1", "unreachable", at(90)), status("c2", "unreachable", at(210)), status("ok", "confirmed", at(215))],
      assignmentHistory: [handover("h", at(30), "Samira")],
      unansweredCalls: 2,
    });
    expect(Object.fromEntries(historyGaps(entries))).toEqual({
      c1: { minutes: 90, after: { kind: "placed" } },
      c2: { minutes: 120, after: { kind: "call", call: 1 } },
      ok: { minutes: 5, after: { kind: "call", call: 2 } },
    });
  });

  it("times a call after a confirmation from the confirmation, and a call whose number is lost from the previous call", () => {
    const entries = confirmationHistory({
      statusHistory: [status("c0", "unreachable", at(0)), status("ok", "confirmed", at(60)), status("c9", "unreachable", at(61))],
      assignmentHistory: [],
      unansweredCalls: 1,
    });
    expect(Object.fromEntries(historyGaps(entries))).toEqual({
      ok: { minutes: 60, after: { kind: "call", call: null } },
      c9: { minutes: 1, after: { kind: "confirmed" } },
    });
  });

  it("says a gap in minutes, hours and minutes, or days, and under a minute as such", () => {
    expect(gapWords(words, 0)).toBe("history.gap_now");
    expect(gapWords(words, 1)).toBe('history.gap_minutes{"minutes":1}');
    expect(gapWords(words, 59)).toBe('history.gap_minutes{"minutes":59}');
    expect(gapWords(words, 60)).toBe('history.gap_hours{"hours":1,"minutes":"00"}');
    expect(gapWords(words, 125)).toBe('history.gap_hours{"hours":2,"minutes":"05"}');
    expect(gapWords(words, 1439)).toBe('history.gap_hours{"hours":23,"minutes":"59"}');
    expect(gapWords(words, 1440)).toBe('history.gap_days{"count":1}');
    expect(gapWords(words, 6 * 1440 + 700)).toBe('history.gap_days{"count":6}');
  });

  it("gives a step after a cancellation no gap: nothing is counted from a closed order", () => {
    const entries = confirmationHistory({ statusHistory: [status("x", "cancelled", at(0)), status("y", "unreachable", at(5))], assignmentHistory: [], unansweredCalls: 1 });
    expect(historyGaps(entries).has("y")).toBe(false);
  });

  it("names the step the gap is counted from", () => {
    expect(gapLine(words, { minutes: 5, after: { kind: "placed" } })).toBe('history.after_placed{"gap":"history.gap_minutes{\\"minutes\\":5}"}');
    expect(gapLine(words, { minutes: 5, after: { kind: "confirmed" } })).toBe('history.after_confirmed{"gap":"history.gap_minutes{\\"minutes\\":5}"}');
    expect(gapLine(words, { minutes: 5, after: { kind: "call", call: 2 } })).toBe('history.after_call{"gap":"history.gap_minutes{\\"minutes\\":5}","call":2}');
    expect(gapLine(words, { minutes: 5, after: { kind: "call", call: null } })).toBe('history.after_previous_call{"gap":"history.gap_minutes{\\"minutes\\":5}"}');
  });
});
