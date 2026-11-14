import { describe, expect, it } from "vitest";
import { callbackChoices, callbackState, dayFromNow, fromStoreInput, memberWarning, payStart, periodRange, splitMinutes, storeClock, toStoreInput } from "./model";

describe("the results periods", () => {
  it("gives each results period its first and last day", () => {
    const now = new Date("2026-11-14T10:00:00.000Z");
    expect(periodRange("today", now)).toEqual({ from: "2026-11-14", to: "2026-11-14" });
    expect(periodRange("7d", now)).toEqual({ from: "2026-11-08", to: "2026-11-14" });
    expect(periodRange("30d", now)).toEqual({ from: "2026-10-16", to: "2026-11-14" });
    expect(periodRange("month", now)).toEqual({ from: "2026-11-01", to: "2026-11-14" });
  });
});

describe("the quick callback times", () => {
  it("offer this evening only before 17:00 in Algeria, and tomorrow at 10:00 and 15:00", () => {
    const morning = callbackChoices(new Date("2026-11-14T09:02:00.000Z"));
    expect(morning).toEqual([
      { key: "in_1h", at: "2026-11-14T10:05:00.000Z" },
      { key: "this_evening", at: "2026-11-14T17:00:00.000Z" },
      { key: "tomorrow_morning", at: "2026-11-15T09:00:00.000Z" },
      { key: "tomorrow_afternoon", at: "2026-11-15T14:00:00.000Z" },
    ]);
    expect(callbackChoices(new Date("2026-11-14T16:00:00.000Z")).map((c) => c.key)).toEqual(["in_1h", "tomorrow_morning", "tomorrow_afternoon"]);
  });

  it("name a callback due, later today, or another day", () => {
    const now = new Date("2026-11-14T10:00:00.000Z");
    expect(callbackState("2026-11-14T10:00:00.000Z", now)).toBe("due");
    expect(callbackState("2026-11-14T22:30:00.000Z", now)).toBe("today");
    expect(callbackState("2026-11-14T23:30:00.000Z", now)).toBe("later");
  });

  it("read and show a typed time in Algeria's time, whatever the browser's clock", () => {
    expect(fromStoreInput("2026-11-14T15:30")).toBe("2026-11-14T14:30:00.000Z");
    expect(toStoreInput("2026-11-14T14:30:00.000Z")).toBe("2026-11-14T15:30");
    expect(fromStoreInput("not a time")).toBeNull();
    expect(storeClock("2026-11-14T14:30:00.000Z", "en")).toBe("15:30");
  });

  it("say whether a callback is today, tomorrow or another day", () => {
    const now = new Date("2026-11-14T20:00:00.000Z");
    expect(dayFromNow("2026-11-14T22:00:00.000Z", now)).toBe("today");
    expect(dayFromNow("2026-11-14T23:30:00.000Z", now)).toBe("tomorrow");
    expect(dayFromNow("2026-11-16T09:00:00.000Z", now)).toBe("other");
  });
});

describe("a member's row", () => {
  it("warns of an inactive account first, then of permissions that show no order", () => {
    expect(memberWarning({ active: false, reach: "none" })).toBe("inactive");
    expect(memberWarning({ active: true, reach: "none" })).toBe("no_access");
    expect(memberWarning({ active: true, reach: "own" })).toBeNull();
  });

  it("shows minutes as hours and minutes", () => {
    expect(splitMinutes(65)).toEqual({ hours: 1, minutes: 5 });
    expect(splitMinutes(9)).toEqual({ hours: 0, minutes: 9 });
  });
});

describe("pay", () => {
  it("starts a salary on the first of its month, a commission on its day", () => {
    expect(payStart("salary", "2026-11-20")).toBe("2026-11-01");
    expect(payStart("per_confirmed", "2026-11-20")).toBe("2026-11-20");
    expect(payStart("per_delivered", "2026-11-20")).toBe("2026-11-20");
  });
});
