import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { countdownEnd, countdownTarget, timeLeft } from "../countdown";

/** 2026-11-10 12:00 in Algiers (UTC+1). */
const NOW = Date.UTC(2026, 10, 10, 11, 0);
const algiers = (day: number, hours = 0, minutes = 0) => Date.UTC(2026, 10, day, hours, minutes) - 60 * 60 * 1000;

describe("what a countdown counts to", () => {
  it("is midnight, a day, or a day at a time, from the merchant's fields", () => {
    expect(countdownTarget("midnight", "2026-11-12", "18:00")).toBe("midnight");
    expect(countdownTarget("date", " 2026-11-12 ", "")).toBe("2026-11-12");
    expect(countdownTarget("date", "2026-11-12", "9:30")).toBe("2026-11-12T09:30");
    expect(countdownTarget("date", "2026-11-12", "soon")).toBe("2026-11-12");
    expect(countdownTarget("date", "", "18:00")).toBeUndefined();
    expect(countdownTarget("none", "2026-11-12", "18:00")).toBeUndefined();
  });
});

describe("when a countdown ends, in Algiers time", () => {
  it("ends at the next midnight", () => {
    expect(countdownEnd("midnight", NOW)).toBe(algiers(11));
  });

  it("ends at the end of the day the merchant chose, or at the time they gave", () => {
    expect(countdownEnd("2026-11-12", NOW)).toBe(algiers(13));
    expect(countdownEnd("2026-11-12T18:30", NOW)).toBe(algiers(12, 18, 30));
    expect(countdownEnd("2026-11-10T13:00", NOW)).toBe(algiers(10, 13));
  });

  it("is nothing once past, or for a day or time that does not exist", () => {
    expect(countdownEnd("2026-11-10T11:59", NOW)).toBeNull();
    expect(countdownEnd("2026-11-09", NOW)).toBeNull();
    expect(countdownEnd("2026-02-30", NOW)).toBeNull();
    expect(countdownEnd("2026-11-12T24:00", NOW)).toBeNull();
    expect(countdownEnd("12/11/2026", NOW)).toBeNull();
  });

  it("leaves whole days, hours, minutes and seconds", () => {
    expect(timeLeft(algiers(12, 18, 30), NOW)).toEqual({ days: 2, hours: 6, minutes: 30, seconds: 0 });
  });
});

describe("how a countdown reads", () => {
  it("runs its clock left to right in every language, so Arabic does not read seconds first", () => {
    const source = readFileSync(resolve(__dirname, "../../components/ui/Countdown.astro"), "utf8");
    expect(source).toMatch(/\.is-line \.countdown-parts \{[^}]*direction: ltr;[^}]*unicode-bidi: isolate;/);
  });
});
