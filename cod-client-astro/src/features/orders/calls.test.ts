import { describe, expect, it } from "vitest";
import type { Translate } from "@/i18n/core";
import { callNumbers, CONFIRM_STEPS, confirmStepCounts, confirmStepFrom, confirmStepQuery, moveLabel, statusMoves, viewQuery } from "./model";
import type { OrderStageCounts, StatusHistoryItem } from "./types";

const step = (id: string, status: StatusHistoryItem["status"], timestamp: string): StatusHistoryItem => ({ id, status, timestamp, by: null, byName: null });
const COUNTS: OrderStageCounts = {
  stages: [
    { stage: "new", count: 4 },
    { stage: "unreachable", count: 6 },
    { stage: "confirmed", count: 9 },
  ],
  needsAttention: 0,
  archived: 0,
  callbacks: 0,
  callbacksDue: 0,
  noAnswer: { call1: 3, call2: 2, call3OrMore: 1 },
  deliveryRate: null,
};
const words: Translate = (key, values) => `${key}${values ? JSON.stringify(values) : ""}`;

describe("the orders to confirm, call by call", () => {
  it("go new, then Call 1, Call 2, Call 3 and more", () => {
    expect(CONFIRM_STEPS).toEqual(["new", "call1", "call2", "call3"]);
  });

  it("open each step within the queue: the new ones by their stage, each call by its count", () => {
    expect(confirmStepQuery("new")).toEqual({ stages: ["new"] });
    expect(confirmStepQuery("call1")).toEqual({ calls: 1 });
    expect(confirmStepQuery("call2")).toEqual({ calls: 2 });
    expect(confirmStepQuery("call3")).toEqual({ calls: 3 });
    expect({ ...viewQuery("to_confirm"), ...confirmStepQuery("call2") }).toEqual({ stages: ["new", "unreachable"], calls: 2 });
    expect({ ...viewQuery("to_confirm"), ...confirmStepQuery("new") }).toEqual({ stages: ["new"] });
  });

  it("count each step from the server's counts, none when a stage has no orders", () => {
    expect(confirmStepCounts(COUNTS)).toEqual({ new: 4, call1: 3, call2: 2, call3: 1 });
    expect(confirmStepCounts({ ...COUNTS, stages: [], noAnswer: { call1: 0, call2: 0, call3OrMore: 0 } })).toEqual({ new: 0, call1: 0, call2: 0, call3: 0 });
  });

  it("open the step a link names, only in the orders to confirm, and nothing a link makes up", () => {
    expect(confirmStepFrom("?view=to_confirm&step=call2", "to_confirm")).toBe("call2");
    expect(confirmStepFrom("?step=new", "to_confirm")).toBe("new");
    expect(confirmStepFrom("?view=all&step=call2", "all")).toBeNull();
    expect(confirmStepFrom("?step=call2", "callbacks")).toBeNull();
    expect(confirmStepFrom("?step=call4", "to_confirm")).toBeNull();
    expect(confirmStepFrom("?step=", "to_confirm")).toBeNull();
    expect(confirmStepFrom("", "to_confirm")).toBeNull();
  });
});

describe("the calls in an order's timeline", () => {
  it("are numbered back from the order's count, the newest being its last call", () => {
    const history = [step("placed", "new", "2026-11-14T08:00:00.000Z"), step("a", "unreachable", "2026-11-14T09:00:00.000Z"), step("b", "unreachable", "2026-11-14T13:00:00.000Z"), step("c", "confirmed", "2026-11-14T15:00:00.000Z")];
    expect([...callNumbers(history, 2)]).toEqual([["b", 2], ["a", 1]]);
  });

  it("keep their true numbers once the log dropped the first ones", () => {
    expect([...callNumbers([step("last", "unreachable", "2026-11-14T13:00:00.000Z")], 3)]).toEqual([["last", 3]]);
  });

  it("are read in time order whatever order they come in, the same instant by id", () => {
    const history = [step("b", "unreachable", "2026-11-14T13:00:00.000Z"), step("a", "unreachable", "2026-11-14T09:00:00.000Z"), step("d", "unreachable", "2026-11-14T13:00:00.000Z")];
    expect([...callNumbers(history, 3)]).toEqual([["d", 3], ["b", 2], ["a", 1]]);
  });

  it("number none beyond what the order counts", () => {
    const history = [step("a", "unreachable", "2026-11-14T09:00:00.000Z"), step("b", "unreachable", "2026-11-14T13:00:00.000Z")];
    expect([...callNumbers(history, 1)]).toEqual([["b", 1]]);
    expect([...callNumbers(history, 0)]).toEqual([]);
  });
});

describe("the No answer button", () => {
  it("says which call it records: the next one", () => {
    expect(moveLabel(words, "unreachable", 0)).toBe('calls.no_answer{"call":1}');
    expect(moveLabel(words, "unreachable", 2)).toBe('calls.no_answer{"call":3}');
    expect(moveLabel(words, "confirmed", 2)).toBe("move.confirmed");
    expect(moveLabel(words, "cancelled", 2)).toBe("move.cancelled");
  });

  it("is offered again while the order is on no answer, never before the decision", () => {
    expect(statusMoves({ status: "unreachable", hasShipment: false })).toEqual([
      { status: "confirmed", emphasis: "primary" },
      { status: "unreachable", emphasis: "secondary" },
      { status: "cancelled", emphasis: "danger" },
    ]);
    expect(statusMoves({ status: "cancelled", hasShipment: false })).toEqual([]);
  });
});
