import { addDays } from "../time/store-day";
import { countsKey, isPerOrder, type CostCategory, type CostCharge, type CostVersion, type DailyCounts, type ExchangeRate, type ForeignCurrency, type RepeatingCharge } from "./model";

function daysInMonth(day: string): number {
  return new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)), 0)).getUTCDate();
}

function daysInYear(day: string): number {
  const year = Number(day.slice(0, 4));
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 366 : 365;
}

/** The part of a repeating cost one day carries: a whole month of days is exactly one month's amount. */
function dayShare(charge: RepeatingCharge, day: string): number {
  if (charge === "daily") return 1;
  if (charge === "weekly") return 1 / 7;
  if (charge === "monthly") return 1 / daysInMonth(day);
  return 1 / daysInYear(day);
}

/** The rate in force on a day: the latest one set from that day or before. Null when none is. */
export function rateOn(rates: readonly ExchangeRate[], currency: ForeignCurrency, day: string): number | null {
  let found: ExchangeRate | null = null;
  for (const rate of rates) {
    if (rate.currency === currency && rate.validFrom <= day && (!found || rate.validFrom > found.validFrom)) found = rate;
  }
  return found?.centimesPerUnit ?? null;
}

/** The three parts of the store's costs: ads, costs that run on their own, and costs that follow orders. */
export type CostGroup = "ads" | "running" | "per_order";

export function costGroup(category: CostCategory, charge: CostCharge): CostGroup {
  if (category === "ads") return "ads";
  return isPerOrder(charge) ? "per_order" : "running";
}

/** One cost (all its versions) over a period. */
export interface CostValue {
  seriesId: string;
  /** What it counts in the period, in dinar centimes, days without a rate left out. */
  centimes: number;
  /** The same in its own currency's minor unit, every day included. */
  ownMinor: number;
  /** The orders it counted, for a cost charged per order; null otherwise. */
  orders: number | null;
  /** The first day in the period whose rate is missing; null when nothing is. */
  missingFrom: string | null;
}

/** A currency with days that have no rate, from the first such day, and the costs it leaves out. */
export interface MissingRate {
  currency: ForeignCurrency;
  from: string;
  seriesIds: string[];
}

export interface CostsValue {
  centimes: Record<CostGroup | "total", number>;
  costs: CostValue[];
  missing: MissingRate[];
}

/**
 * The store's costs over a period of store days (both included), in dinar
 * centimes. A one-time cost counts on its day; a repeating one a share of
 * itself each day it runs; a per-order one each order its event touched on
 * a day it runs. A foreign amount takes the rate in force on its day; a day
 * with none is left out of the dinars and named in `missing`. A product's
 * per-order cost counts nothing once the product is deleted. Each version is
 * rounded once, so a cost's line, its group and the total always agree.
 */
export function valueCosts(versions: readonly CostVersion[], rates: readonly ExchangeRate[], counts: ReadonlyMap<string, DailyCounts>, from: string, to: string): CostsValue {
  const series = new Map<string, CostValue>();
  const centimes: CostsValue["centimes"] = { total: 0, ads: 0, running: 0, per_order: 0 };
  const missing = new Map<ForeignCurrency, MissingRate>();

  for (const version of versions) {
    const line = series.get(version.seriesId) ?? { seriesId: version.seriesId, centimes: 0, ownMinor: 0, orders: null, missingFrom: null };
    series.set(version.seriesId, line);
    let dinars = 0;
    let own = 0;

    const count = (day: string, minor: number) => {
      if (minor === 0) return;
      own += minor;
      if (version.currency === "DZD") {
        dinars += minor;
        return;
      }
      const rate = rateOn(rates, version.currency, day);
      if (rate !== null) {
        dinars += (minor * rate) / 100;
        return;
      }
      if (line.missingFrom === null || day < line.missingFrom) line.missingFrom = day;
      const gap = missing.get(version.currency) ?? { currency: version.currency, from: day, seriesIds: [] };
      if (day < gap.from) gap.from = day;
      if (!gap.seriesIds.includes(version.seriesId)) gap.seriesIds.push(version.seriesId);
      missing.set(version.currency, gap);
    };

    const start = version.validFrom > from ? version.validFrom : from;
    const end = version.validTo !== null && version.validTo < to ? version.validTo : to;
    const charge = version.charge;

    if (charge === "once") {
      if (version.validFrom >= from && version.validFrom <= to) count(version.validFrom, version.amountMinor);
    } else if (isPerOrder(charge)) {
      line.orders ??= 0;
      const daily = version.forProduct && version.productId === null ? undefined : counts.get(countsKey(charge, version.productId));
      for (const [day, orders] of daily ?? []) {
        if (day < start || day > end || orders <= 0) continue;
        line.orders += orders;
        count(day, version.amountMinor * orders);
      }
    } else {
      for (let day = start; day <= end; day = addDays(day, 1)) count(day, version.amountMinor * dayShare(charge, day));
    }

    const counted = Math.round(dinars);
    line.centimes += counted;
    line.ownMinor += Math.round(own);
    centimes[costGroup(version.category, charge)] += counted;
    centimes.total += counted;
  }

  return { centimes, costs: [...series.values()], missing: [...missing.values()] };
}
