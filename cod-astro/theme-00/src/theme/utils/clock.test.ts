/**
 * The clock reading shown for a voice note's length and position.
 */
import { describe, expect, it } from "vitest";
import { formatClock } from "./clock";

describe("formatClock", () => {
  it("reads a length as minutes and two-digit seconds", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(4_400)).toBe("0:04");
    expect(formatClock(65_400)).toBe("1:05");
    expect(formatClock(3_600_000)).toBe("60:00");
  });

  it("rounds to the nearest second and never goes below zero", () => {
    expect(formatClock(59_600)).toBe("1:00");
    expect(formatClock(-400)).toBe("0:00");
  });
});
