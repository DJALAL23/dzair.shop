import { describe, expect, it } from "vitest";
import { changedMeanwhile, chargeKind, costStatus, financeError, formatAmount, parseAmount, perMonth, rateOn, targetKey, touches, versionOn } from "./model";
import type { Cost, ExchangeRate } from "./types";

describe("an amount the merchant types", () => {
  it("reads plain digits, spaces, a decimal comma and Arabic digits", () => {
    expect(parseAmount("30000")).toBe(30_000);
    expect(parseAmount(" 30 000 ")).toBe(30_000);
    expect(parseAmount("12,5")).toBe(12.5);
    expect(parseAmount("12.50")).toBe(12.5);
    expect(parseAmount("٣٠٠٠")).toBe(3000);
    expect(parseAmount("۱۲٫۵")).toBe(12.5);
  });

  it("refuses nothing, a third decimal, a thousands mark, words and an amount past the limit", () => {
    for (const wrong of ["", "0", "0.00", "12.345", "30,000", "-5", "abc", "1e5", "2000000000"]) expect(parseAmount(wrong), wrong).toBeNull();
    expect(parseAmount("300", 250)).toBeNull();
  });
});

describe("how a cost reads", () => {
  it("names its charge's kind", () => {
    expect(chargeKind("once")).toBe("once");
    expect(chargeKind("weekly")).toBe("repeats");
    expect(chargeKind("per_returned")).toBe("per_order");
  });

  it("says where it stands today", () => {
    const today = "2026-11-14";
    expect(costStatus({ charge: "monthly", startsOn: "2026-11-01", stopsOn: null }, today)).toBe("running");
    expect(costStatus({ charge: "monthly", startsOn: "2026-11-01", stopsOn: "2026-11-14" }, today)).toBe("running");
    expect(costStatus({ charge: "monthly", startsOn: "2026-11-01", stopsOn: "2026-11-13" }, today)).toBe("stopped");
    expect(costStatus({ charge: "daily", startsOn: "2026-11-15", stopsOn: null }, today)).toBe("scheduled");
    expect(costStatus({ charge: "once", startsOn: "2026-11-03", stopsOn: null }, today)).toBe("paid");
    expect(costStatus({ charge: "once", startsOn: "2026-12-01", stopsOn: null }, today)).toBe("scheduled");
  });

  it("knows whether it counts on any day of a period", () => {
    expect(touches({ charge: "once", startsOn: "2026-11-03", stopsOn: null }, "2026-11-01", "2026-11-30")).toBe(true);
    expect(touches({ charge: "once", startsOn: "2026-10-31", stopsOn: null }, "2026-11-01", "2026-11-30")).toBe(false);
    expect(touches({ charge: "monthly", startsOn: "2026-01-01", stopsOn: null }, "2026-11-01", "2026-11-30")).toBe(true);
    expect(touches({ charge: "monthly", startsOn: "2026-01-01", stopsOn: "2026-10-31" }, "2026-11-01", "2026-11-30")).toBe(false);
    expect(touches({ charge: "monthly", startsOn: "2026-12-01", stopsOn: null }, "2026-11-01", "2026-11-30")).toBe(false);
  });

  it("puts a repeating cost into a month, and formats each currency", () => {
    expect(perMonth(20, "daily")).toBe(600);
    expect(perMonth(700, "weekly")).toBe(3000);
    expect(perMonth(120_000, "yearly")).toBe(10_000);
    expect(perMonth(30_000, "monthly")).toBe(30_000);
    expect(formatAmount(20, "USD", "en")).toBe("$20");
    expect(formatAmount(12.5, "EUR", "en")).toBe("€12.50");
    expect(formatAmount(30_000, "DZD", "en")).toBe("30,000 DA");
    expect(formatAmount(20, "USD", "fr")).toBe("20\u00a0$");
    expect(formatAmount(12.5, "USD", "ar")).toBe("12,50 $");
  });
});

describe("the rate in force", () => {
  it("is the latest set on or before the day", () => {
    const rates = [
      { id: "1", currency: "USD", dzdPerUnit: 250, validFrom: "2026-11-01", createdAt: "" },
      { id: "2", currency: "USD", dzdPerUnit: 260, validFrom: "2026-11-10", createdAt: "" },
      { id: "3", currency: "EUR", dzdPerUnit: 280, validFrom: "2026-11-01", createdAt: "" },
    ] satisfies ExchangeRate[];
    expect(rateOn(rates, "USD", "2026-10-31")).toBeNull();
    expect(rateOn(rates, "USD", "2026-11-09")?.dzdPerUnit).toBe(250);
    expect(rateOn(rates, "USD", "2026-11-10")?.dzdPerUnit).toBe(260);
  });
});

describe("a refusal", () => {
  it("is said in the merchant's words, whatever the code", () => {
    const t = (key: string) => key;
    expect(financeError({ code: "COST_DATES_INVALID" }, t)).toBe("errors.dates");
    expect(financeError({ code: "COST_HAS_HISTORY" }, t)).toBe("errors.has_history");
    expect(financeError(new Error("offline"), t)).toBe("errors.generic");
    expect(financeError({ code: "COST_CHANGED" }, t)).toBe("errors.changed");
  });

  it("knows when the cost changed meanwhile, and only then", () => {
    expect(changedMeanwhile({ code: "COST_CHANGED" })).toBe(true);
    expect(changedMeanwhile({ code: "COST_DATES_INVALID" })).toBe(false);
    expect(changedMeanwhile(new Error("offline"))).toBe(false);
  });
});

describe("a cost on a day", () => {
  const raised: Cost = {
    id: "rent",
    name: "Loyer",
    category: "rent",
    charge: "monthly",
    amount: 36_000,
    currency: "DZD",
    startsOn: "2026-09-01",
    since: "2026-11-14",
    stopsOn: "2026-12-31",
    product: null,
    history: [
      { charge: "monthly", amount: 31_000, currency: "DZD", product: { id: "p", name: "Robe" }, validFrom: "2026-10-01", validTo: "2026-11-13" },
      { charge: "monthly", amount: 30_000, currency: "DZD", product: null, validFrom: "2026-09-01", validTo: "2026-09-30" },
    ],
    revision: "r",
    createdAt: "2026-09-01T08:00:00.000Z",
    updatedAt: "2026-11-14T08:00:00.000Z",
  };

  it("has the amount in force that day; before it starts its first, after it stops its last", () => {
    expect(versionOn(raised, "2026-09-30")).toMatchObject({ amount: 30_000, validFrom: "2026-09-01", validTo: "2026-09-30" });
    expect(versionOn(raised, "2026-10-01")).toMatchObject({ amount: 31_000, product: { name: "Robe" } });
    expect(versionOn(raised, "2026-11-14")).toMatchObject({ amount: 36_000, validFrom: "2026-11-14", validTo: "2026-12-31" });
    expect(versionOn(raised, "2026-08-01").amount).toBe(30_000);
    expect(versionOn(raised, "2027-01-15").amount).toBe(36_000);
  });

  it("is for the whole store, a product, or a deleted product, each told apart", () => {
    expect(targetKey(null)).toBe("store");
    expect(targetKey({ id: "p", name: "Robe" })).toBe("p");
    expect(targetKey({ id: null, name: "Robe" })).toBe("deleted:Robe");
    expect(targetKey({ id: null, name: "Robe" })).not.toBe(targetKey({ id: null, name: "Sac" }));
  });
});
