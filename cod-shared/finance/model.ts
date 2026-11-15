/**
 * The words of the store's own costs (marketing analytics Phase 2.4).
 *
 * A **cost** is money the store spends that is neither what a product cost
 * it (order lines freeze that), nor a carrier's charge, nor the confirmation
 * team's pay (Team → Payroll): ads, packaging, calls, rent, subscriptions.
 * Its **charge** says when it counts:
 *
 * - `once`: on the day it was paid;
 * - `daily` / `weekly` / `monthly` / `yearly`: from its first day, spread
 *   over each day it runs, so a whole month of a monthly cost is exactly its
 *   amount and half a month is half of it;
 * - `per_confirmed` / `per_shipped` / `per_delivered` / `per_returned`: on
 *   each order confirmed, handed to a carrier or driver, delivered or
 *   returned while it runs.
 *
 * A cost has **versions** (versions.ts): a change of what it costs or what
 * it is for applies from a day, today at the latest, and the days before
 * keep theirs, so a past month never changes. An **exchange rate** is what
 * one dollar or euro costs the merchant in dinars, from a day on — what they
 * really pay, not the bank's rate.
 * There is no default: a foreign cost on a day without a rate is left out
 * and named, never guessed.
 */

export const CURRENCIES = ["DZD", "USD", "EUR"] as const;
export type Currency = (typeof CURRENCIES)[number];

/** The currencies a rate is set for. */
export const FOREIGN_CURRENCIES = ["USD", "EUR"] as const;
export type ForeignCurrency = (typeof FOREIGN_CURRENCIES)[number];

export const COST_CATEGORIES = ["ads", "packaging", "calls", "content", "salaries", "rent", "software", "other"] as const;
export type CostCategory = (typeof COST_CATEGORIES)[number];

export const REPEATING_CHARGES = ["daily", "weekly", "monthly", "yearly"] as const;
export type RepeatingCharge = (typeof REPEATING_CHARGES)[number];

export const PER_ORDER_CHARGES = ["per_confirmed", "per_shipped", "per_delivered", "per_returned"] as const;
export type PerOrderCharge = (typeof PER_ORDER_CHARGES)[number];

export const COST_CHARGES = ["once", ...REPEATING_CHARGES, ...PER_ORDER_CHARGES] as const;
export type CostCharge = (typeof COST_CHARGES)[number];

export const isRepeating = (charge: CostCharge): charge is RepeatingCharge => (REPEATING_CHARGES as readonly string[]).includes(charge);
export const isPerOrder = (charge: CostCharge): charge is PerOrderCharge => (PER_ORDER_CHARGES as readonly string[]).includes(charge);

/** The largest amount a cost or rate takes, in major units: a typo, not a cost, beyond it. */
export const MAX_COST_AMOUNT = 1_000_000_000;
export const MAX_RATE = 100_000;

/** Major units (12.5) to the currency's minor unit (1250); every currency here has two decimals. */
export const toMinor = (amount: number): number => Math.round(amount * 100);
export const fromMinor = (minor: number): number => minor / 100;

/** One version of a cost, as the valuation reads it. */
export interface CostVersion {
  id: string;
  seriesId: string;
  category: CostCategory;
  charge: CostCharge;
  amountMinor: number;
  currency: Currency;
  /** Store days (YYYY-MM-DD, Algeria), both included; `validTo` null while it runs. */
  validFrom: string;
  validTo: string | null;
  /** The product it is for, kept after the product is deleted; null for the whole store. */
  productId: string | null;
}

/** What one dollar or euro costs in dinar centimes, from a store day on. */
export interface ExchangeRate {
  currency: ForeignCurrency;
  centimesPerUnit: number;
  validFrom: string;
}

/** How many orders a per-order event touched on each store day, for the whole store or one product. */
export type DailyCounts = ReadonlyMap<string, number>;

/** The key of the counts a per-order cost reads: its event, and its product when it has one. */
export const countsKey = (charge: PerOrderCharge, productId: string | null): string => `${charge}:${productId ?? "*"}`;
