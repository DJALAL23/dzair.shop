import { describe, expect, it } from "vitest";
import { formatMonth, formatStoreDay, monthDays, shiftMonth, storeDay, storeMonth } from "./store-time";

describe("store days, in Algeria's time", () => {
  it("turns at 23:00 UTC", () => {
    expect(storeDay(new Date("2026-11-14T22:59:00.000Z"))).toBe("2026-11-14");
    expect(storeDay(new Date("2026-11-14T23:00:00.000Z"))).toBe("2026-11-15");
  });

  it("counts months across a year's end, and knows each month's last day", () => {
    expect(storeMonth(new Date("2026-12-31T23:30:00.000Z"))).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(monthDays("2026-11")).toEqual({ from: "2026-11-01", to: "2026-11-30" });
    expect(monthDays("2028-02")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(monthDays("2026-12")).toEqual({ from: "2026-12-01", to: "2026-12-31" });
  });

  it("names its days and months as the merchant reads them, whatever the browser's time zone", () => {
    expect(formatStoreDay("2026-11-01", "en")).toBe("Nov 1, 2026");
    expect(formatMonth("2026-11", "fr")).toBe("novembre 2026");
    expect(formatMonth("2027-01", "en")).toBe("January 2027");
  });
});
