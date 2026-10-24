/**
 * Money as a Business Event carries it: an exact decimal string with its
 * currency, so no consumer meets a binary float or guesses the unit (ADR 0018).
 */

export const CURRENCY = "DZD";

export interface Money {
  amount: string;
  currency: typeof CURRENCY;
}

/** Dinars as the database stores them, rounded to the centime. */
export function money(dinars: number): Money {
  if (!Number.isFinite(dinars) || dinars < 0) throw new RangeError(`Not an amount of money: ${dinars}`);
  return { amount: (Math.round(dinars * 100) / 100).toFixed(2), currency: CURRENCY };
}
