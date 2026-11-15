import { describe, expect, it } from "vitest";
import type { Translate } from "@/i18n/core";
import { assignmentWay, confirmationHistory } from "./history";
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
