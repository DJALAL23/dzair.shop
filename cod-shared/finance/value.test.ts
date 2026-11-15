import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { countsKey, type CostVersion, type DailyCounts, type ExchangeRate } from "./model";
import { addDays } from "../time/store-day";
import { rateOn, valueCosts } from "./value";

const cost = (over: Partial<CostVersion> = {}): CostVersion => ({
  id: "v1",
  seriesId: "rent",
  category: "rent",
  charge: "monthly",
  amountMinor: 3_000_000,
  currency: "DZD",
  validFrom: "2026-01-01",
  validTo: null,
  productId: null,
  ...over,
});

const NONE = new Map<string, DailyCounts>();
const dinars = (centimes: number) => centimes / 100;
const total = (versions: CostVersion[], from: string, to: string, rates: ExchangeRate[] = [], counts = NONE) => dinars(valueCosts(versions, rates, counts, from, to).centimes.total);
const monthEnd = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);

describe("a cost that repeats", () => {
  it("counts a whole month of a monthly cost as exactly its amount, whatever the month's length", () => {
    fc.assert(
      fc.property(fc.integer({ min: 2024, max: 2032 }), fc.integer({ min: 1, max: 12 }), fc.integer({ min: 1, max: 500_000 }), (year, month, wholeDinars) => {
        const m = `${year}-${String(month).padStart(2, "0")}`;
        const value = valueCosts([cost({ amountMinor: wholeDinars * 100, validFrom: "2020-01-01" })], [], NONE, `${m}-01`, monthEnd(m));
        expect(value.centimes.total).toBe(wholeDinars * 100);
      }),
    );
  });

  it("counts the days of the period it runs: half of November is half the rent", () => {
    expect(total([cost()], "2026-11-01", "2026-11-15")).toBe(15_000);
    expect(total([cost({ validFrom: "2026-11-21" })], "2026-11-01", "2026-11-30")).toBe(10_000);
    expect(total([cost({ validTo: "2026-11-10" })], "2026-11-01", "2026-11-30")).toBe(10_000);
    expect(total([cost({ validFrom: "2026-12-01" })], "2026-11-01", "2026-11-30")).toBe(0);
    expect(total([cost({ validTo: "2026-10-31" })], "2026-11-01", "2026-11-30")).toBe(0);
  });

  it("counts a daily cost each day, a weekly one a seventh a day, a yearly one over the days of its year", () => {
    expect(total([cost({ charge: "daily", amountMinor: 150_000 })], "2026-11-01", "2026-11-10")).toBe(15_000);
    expect(total([cost({ charge: "weekly", amountMinor: 700_000 })], "2026-11-01", "2026-11-14")).toBe(14_000);
    expect(total([cost({ charge: "yearly", amountMinor: 36_600_000 })], "2028-01-01", "2028-12-31")).toBe(366_000);
    expect(total([cost({ charge: "yearly", amountMinor: 36_500_000 })], "2026-01-01", "2026-12-31")).toBe(365_000);
  });

  it("rounds what a cost counts to the dinar, once: 14 days of a 31-day month of 30,000 DA are 13,548 DA", () => {
    expect(total([cost()], "2026-12-01", "2026-12-14")).toBe(13_548);
    expect(total([cost({ amountMinor: 3_000_050 })], "2026-12-01", "2026-12-31")).toBe(30_001);
  });

  it("never gains or loses more than a dinar when a period is cut in two", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("daily", "weekly", "monthly", "yearly" as const),
        fc.integer({ min: 1, max: 100_000_000 }),
        fc.integer({ min: 0, max: 400 }),
        fc.integer({ min: 0, max: 400 }),
        (charge, amount, length, cut) => {
          const from = "2026-01-01";
          const to = addDays(from, length);
          const middle = addDays(from, Math.min(cut, length));
          const versions = [cost({ charge, amountMinor: amount, validFrom: "2025-06-01" })];
          const whole = valueCosts(versions, [], NONE, from, to).centimes.total;
          const parts = valueCosts(versions, [], NONE, from, middle).centimes.total + (middle < to ? valueCosts(versions, [], NONE, addDays(middle, 1), to).centimes.total : 0);
          expect(Math.abs(whole - parts)).toBeLessThanOrEqual(100);
        },
      ),
    );
  });
});

describe("a one-time cost", () => {
  it("counts on the day it was paid, and only in a period holding that day", () => {
    const shoot = cost({ seriesId: "shoot", category: "content", charge: "once", amountMinor: 2_500_000, validFrom: "2026-11-03" });
    expect(total([shoot], "2026-11-01", "2026-11-30")).toBe(25_000);
    expect(total([shoot], "2026-11-04", "2026-11-30")).toBe(0);
    expect(total([shoot], "2026-11-03", "2026-11-03")).toBe(25_000);
  });
});

describe("a cost per order", () => {
  const days = (entries: Record<string, number>): DailyCounts => new Map(Object.entries(entries));

  it("counts each order its event touched on the days it runs, and says how many", () => {
    const packaging = cost({ seriesId: "pack", category: "packaging", charge: "per_shipped", amountMinor: 8_000, validFrom: "2026-11-05", validTo: "2026-11-20" });
    const counts = new Map([[countsKey("per_shipped", null), days({ "2026-11-04": 9, "2026-11-05": 3, "2026-11-20": 2, "2026-11-21": 7 })]]);
    const value = valueCosts([packaging], [], counts, "2026-11-01", "2026-11-30");
    expect(value.costs).toEqual([{ seriesId: "pack", centimes: 40_000, ownMinor: 40_000, currency: "DZD", orders: 5, missingFrom: null }]);
    expect(value.centimes).toEqual({ total: 40_000, ads: 0, running: 0, per_order: 40_000 });
  });

  it("reads the counts of its own event and its own product", () => {
    const counts = new Map([
      [countsKey("per_delivered", null), days({ "2026-11-02": 10 })],
      [countsKey("per_delivered", "robe"), days({ "2026-11-02": 4 })],
      [countsKey("per_confirmed", null), days({ "2026-11-02": 20 })],
    ]);
    const callCenter = cost({ seriesId: "calls", category: "calls", charge: "per_delivered", amountMinor: 15_000 });
    expect(total([callCenter], "2026-11-01", "2026-11-30", [], counts)).toBe(1_500);
    expect(total([{ ...callCenter, productId: "robe" }], "2026-11-01", "2026-11-30", [], counts)).toBe(600);
    expect(total([{ ...callCenter, productId: "sac" }], "2026-11-01", "2026-11-30", [], counts)).toBe(0);
    expect(valueCosts([callCenter], [], NONE, "2026-11-01", "2026-11-30").costs[0]).toMatchObject({ orders: 0, ownMinor: null, currency: null });
  });
});

describe("a cost in dollars or euros", () => {
  const usd = (validFrom: string, dinarsPerDollar: number): ExchangeRate => ({ currency: "USD", centimesPerUnit: dinarsPerDollar * 100, validFrom });
  const ads = cost({ seriesId: "fb", category: "ads", charge: "daily", amountMinor: 2_000, currency: "USD", validFrom: "2026-11-01" });

  it("takes the rate in force on each day", () => {
    expect(total([ads], "2026-11-01", "2026-11-04", [usd("2026-10-01", 250), usd("2026-11-03", 260)])).toBe(2 * 20 * 250 + 2 * 20 * 260);
  });

  it("leaves out the days without a rate and names the currency, the first such day and the cost", () => {
    const value = valueCosts([ads, cost({ seriesId: "tiktok", category: "ads", charge: "once", amountMinor: 5_000, currency: "USD", validFrom: "2026-11-02" })], [usd("2026-11-03", 250)], NONE, "2026-11-01", "2026-11-04");
    expect(dinars(value.centimes.total)).toBe(2 * 20 * 250);
    expect(value.missing).toEqual([{ currency: "USD", from: "2026-11-01", seriesIds: ["fb", "tiktok"] }]);
    expect(value.costs.map((line) => [line.seriesId, line.missingFrom, line.ownMinor])).toEqual([
      ["fb", "2026-11-01", 8_000],
      ["tiktok", "2026-11-02", 5_000],
    ]);
  });

  it("never treats a day with nothing to pay as missing a rate", () => {
    const perOrder = cost({ seriesId: "app", category: "software", charge: "per_confirmed", amountMinor: 10, currency: "EUR" });
    expect(valueCosts([perOrder], [], NONE, "2026-11-01", "2026-11-30").missing).toEqual([]);
  });
});

describe("a cost changed from a day", () => {
  it("adds its versions into one line, each in its own group, and the lines, groups and total agree", () => {
    const before = cost({ id: "v1", seriesId: "agency", category: "calls", charge: "monthly", amountMinor: 3_000_000, validFrom: "2026-01-01", validTo: "2026-11-15" });
    const after = cost({ id: "v2", seriesId: "agency", category: "calls", charge: "per_delivered", amountMinor: 20_000, validFrom: "2026-11-16" });
    const counts = new Map([[countsKey("per_delivered", null), new Map([["2026-11-10", 50], ["2026-11-20", 10]])]]);
    const value = valueCosts([before, after, cost({ seriesId: "fb", category: "ads", charge: "once", amountMinor: 1_000_000, validFrom: "2026-11-02" })], [], counts, "2026-11-01", "2026-11-30");
    expect(value.costs.find((line) => line.seriesId === "agency")).toMatchObject({ ownMinor: 1_700_000, currency: "DZD" });
    expect(value.costs.find((line) => line.seriesId === "agency")).toMatchObject({ centimes: 1_500_000 + 200_000, orders: 10 });
    expect(value.centimes).toEqual({ total: 2_700_000, ads: 1_000_000, running: 1_500_000, per_order: 200_000 });
    expect(value.costs.reduce((sum, line) => sum + line.centimes, 0)).toBe(value.centimes.total);
  });
});

describe("any store's costs", () => {
  const DAY0 = "2026-01-01";
  const on = (n: number) => addDays(DAY0, n);
  const versionArb = fc.record({
    seriesId: fc.constantFrom("a", "b", "c", "d"),
    category: fc.constantFrom("ads", "packaging", "rent", "other" as const),
    charge: fc.constantFrom("once", "daily", "weekly", "monthly", "yearly", "per_confirmed", "per_shipped", "per_delivered", "per_returned" as const),
    amountMinor: fc.integer({ min: 1, max: 5_000_000 }),
    currency: fc.constantFrom("DZD", "USD", "EUR" as const),
    start: fc.integer({ min: 0, max: 120 }),
    length: fc.option(fc.integer({ min: 0, max: 90 }), { nil: null }),
    productId: fc.constantFrom(null, "robe"),
  });
  const storeArb = fc.record({
    versions: fc.array(versionArb, { maxLength: 8 }).map((drafts) =>
      drafts.map(({ start, length, ...draft }, index): CostVersion => ({ ...draft, id: `v${index}`, validFrom: on(start), validTo: draft.charge === "once" || length === null ? null : on(start + length) })),
    ),
    rates: fc.array(fc.record({ currency: fc.constantFrom("USD", "EUR" as const), centimesPerUnit: fc.integer({ min: 10_000, max: 40_000 }), validFrom: fc.integer({ min: 0, max: 200 }).map(on) }), { maxLength: 4 }),
    counts: fc.array(fc.record({ charge: fc.constantFrom("per_confirmed", "per_shipped", "per_delivered", "per_returned" as const), productId: fc.constantFrom(null, "robe"), day: fc.integer({ min: 0, max: 200 }).map(on), orders: fc.integer({ min: 1, max: 30 }) }), { maxLength: 20 }),
    from: fc.integer({ min: 0, max: 150 }),
    length: fc.integer({ min: 0, max: 60 }),
  });
  const countsOf = (entries: Array<{ charge: Parameters<typeof countsKey>[0]; productId: string | null; day: string; orders: number }>) => {
    const counts = new Map<string, Map<string, number>>();
    for (const { charge, productId, day, orders } of entries) {
      const daily = counts.get(countsKey(charge, productId)) ?? new Map<string, number>();
      daily.set(day, (daily.get(day) ?? 0) + orders);
      counts.set(countsKey(charge, productId), daily);
    }
    return counts;
  };

  it("always has lines, groups and total that agree, in whole dinars", () => {
    fc.assert(
      fc.property(storeArb, (store) => {
        const value = valueCosts(store.versions, store.rates, countsOf(store.counts), on(store.from), on(store.from + store.length));
        expect(value.costs.reduce((sum, line) => sum + line.centimes, 0)).toBe(value.centimes.total);
        expect(value.centimes.ads + value.centimes.running + value.centimes.per_order).toBe(value.centimes.total);
        for (const line of value.costs) expect(line.centimes % 100).toBe(0);
      }),
      { numRuns: 300 },
    );
  });

  it("never changes a past period when a rate, or a version, starts after it", () => {
    fc.assert(
      fc.property(storeArb, fc.integer({ min: 1, max: 60 }), fc.integer({ min: 10_000, max: 40_000 }), (store, after, centimes) => {
        const [from, to] = [on(store.from), on(store.from + store.length)];
        const counts = countsOf(store.counts);
        const before = valueCosts(store.versions, store.rates, counts, from, to);
        const later = addDays(to, after);
        const rate: ExchangeRate = { currency: "USD", centimesPerUnit: centimes, validFrom: later };
        const version = cost({ id: "late", seriesId: "a", charge: "daily", currency: "USD", validFrom: later });
        expect(valueCosts([...store.versions, version], [...store.rates, rate], counts, from, to).centimes).toEqual(before.centimes);
      }),
      { numRuns: 300 },
    );
  });

  it("leaves out exactly the days before a currency's first rate", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 40 }), fc.integer({ min: 0, max: 40 }), fc.integer({ min: 1, max: 100_00 }), (rateDay, length, cents) => {
        const ads = cost({ seriesId: "fb", category: "ads", charge: "daily", amountMinor: cents, currency: "USD", validFrom: on(0) });
        const value = valueCosts([ads], [{ currency: "USD", centimesPerUnit: 25_000, validFrom: on(rateDay) }], NONE, on(0), on(length));
        const counted = Math.max(0, length - rateDay + 1);
        expect(value.centimes.total).toBe(Math.round((counted * cents * 25_000) / 100 / 100) * 100);
        expect(value.missing).toEqual(rateDay > 0 ? [{ currency: "USD", from: on(0), seriesIds: ["fb"] }] : []);
      }),
    );
  });
});

describe("a cost that changed currency", () => {
  it("gives no amount in its own currency for a period holding both", () => {
    const dollars = cost({ id: "v1", seriesId: "fb", category: "ads", charge: "daily", amountMinor: 2_000, currency: "USD", validFrom: "2026-11-01", validTo: "2026-11-10" });
    const dinarsAfter = cost({ id: "v2", seriesId: "fb", category: "ads", charge: "daily", amountMinor: 500_000, currency: "DZD", validFrom: "2026-11-11" });
    const rates = [{ currency: "USD" as const, centimesPerUnit: 25_000, validFrom: "2026-10-01" }];
    expect(valueCosts([dollars, dinarsAfter], rates, NONE, "2026-11-01", "2026-11-20").costs).toEqual([{ seriesId: "fb", centimes: 10 * 500_000 + 10 * 500_000, ownMinor: null, currency: null, orders: null, missingFrom: null }]);
    expect(valueCosts([dollars, dinarsAfter], rates, NONE, "2026-11-11", "2026-11-20").costs[0]).toMatchObject({ ownMinor: 5_000_000, currency: "DZD" });
  });
});

describe("the rate in force", () => {
  it("is the latest set on or before the day, whatever order the rates come in", () => {
    const rates: ExchangeRate[] = [
      { currency: "USD", centimesPerUnit: 26_000, validFrom: "2026-11-10" },
      { currency: "EUR", centimesPerUnit: 28_000, validFrom: "2026-11-01" },
      { currency: "USD", centimesPerUnit: 25_000, validFrom: "2026-11-01" },
    ];
    expect(rateOn(rates, "USD", "2026-10-31")).toBeNull();
    expect(rateOn(rates, "USD", "2026-11-09")).toBe(25_000);
    expect(rateOn(rates, "USD", "2026-11-10")).toBe(26_000);
    expect(rateOn(rates, "EUR", "2026-12-01")).toBe(28_000);
  });
});
