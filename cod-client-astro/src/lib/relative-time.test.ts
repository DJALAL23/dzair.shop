import { describe, expect, it } from "vitest";
import { relativeTime } from "./relative-time";

const NOW = Date.UTC(2026, 9, 12, 12, 0, 0);
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60_000;

describe("relativeTime", () => {
  it("is grammatical in Arabic: dual, plural, and named days", () => {
    expect(relativeTime(ago(10_000), "ar", NOW)).toBe(new Intl.RelativeTimeFormat("ar", { numeric: "auto" }).format(0, "second"));
    expect(relativeTime(ago(3 * MIN), "ar", NOW)).toBe("قبل 3 دقائق");
    expect(relativeTime(ago(11 * MIN), "ar", NOW)).toBe("قبل 11 دقيقة");
    expect(relativeTime(ago(2 * 60 * MIN), "ar", NOW)).toBe("قبل ساعتين");
    expect(relativeTime(ago(24 * 60 * MIN), "ar", NOW)).toBe("أمس");
  });

  it("speaks French and English", () => {
    expect(relativeTime(ago(3 * MIN), "fr", NOW)).toBe("il y a 3 minutes");
    expect(relativeTime(ago(1 * MIN), "en", NOW)).toBe("1 minute ago");
    expect(relativeTime(ago(5 * 24 * 60 * MIN), "en", NOW)).toBe("5 days ago");
  });

  it("is a calendar date past a month, with Latin digits", () => {
    const text = relativeTime(ago(60 * 24 * 60 * MIN), "ar", NOW);
    expect(text).toMatch(/2026/);
    expect(text).not.toMatch(/[٠-٩]/);
  });

  it("shows a dash for a value that is not a date", () => {
    expect(relativeTime("not-a-date", "en", NOW)).toBe("-");
  });
});
