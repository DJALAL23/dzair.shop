import { describe, expect, it } from "vitest";
import { retrySchedule } from "./retry-schedule";

describe("a retry schedule", () => {
  const schedule = retrySchedule([1, 5, 60]);
  const now = new Date("2026-10-25T10:00:00.000Z");

  it("waits each time as long as the schedule says, then gives up", () => {
    expect(schedule.maxAttempts).toBe(4);
    expect(schedule.nextAttemptAfter(1, now)).toBe("2026-10-25T10:01:00.000Z");
    expect(schedule.nextAttemptAfter(2, now)).toBe("2026-10-25T10:05:00.000Z");
    expect(schedule.nextAttemptAfter(3, now)).toBe("2026-10-25T11:00:00.000Z");
    expect(schedule.nextAttemptAfter(4, now)).toBeNull();
    expect(schedule.nextAttemptAfter(9, now)).toBeNull();
  });

  it("treats a failure before any counted try as the first", () => {
    expect(schedule.nextAttemptAfter(0, now)).toBe("2026-10-25T10:01:00.000Z");
  });
});
