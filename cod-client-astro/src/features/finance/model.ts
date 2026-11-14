/**
 * The store's costs as the dashboard shows them: the costs an Algerian store
 * usually has, ready to pick; amounts typed the way merchants type them; how
 * a cost reads in a list; and the errors in plain words.
 */
import type { Locale } from "@/i18n/config";
import { formatMoney } from "@/features/orders/model";
import { intlLocale } from "@/lib/store-time";
import { isPerOrder, MAX_COST_AMOUNT, type RepeatingCharge } from "../../../../cod-shared/finance/model";
import type { Cost, CostCategory, CostCharge, Currency, ExchangeRate, ForeignCurrency } from "./types";

/** The three ways a cost is charged, as the form asks it. */
export type ChargeKind = "once" | "repeats" | "per_order";

export function chargeKind(charge: CostCharge): ChargeKind {
  if (charge === "once") return "once";
  return isPerOrder(charge) ? "per_order" : "repeats";
}

export interface CostPreset {
  key: string;
  category: CostCategory;
  charge: CostCharge;
  currency: Currency;
}

/** What an Algerian store usually pays for: picking one fills the form, and everything stays editable. */
export const PRESETS: readonly CostPreset[] = [
  { key: "facebook_ads", category: "ads", charge: "daily", currency: "USD" },
  { key: "tiktok_ads", category: "ads", charge: "daily", currency: "USD" },
  { key: "packaging", category: "packaging", charge: "per_shipped", currency: "DZD" },
  { key: "call_center", category: "calls", charge: "per_delivered", currency: "DZD" },
  { key: "phone_credit", category: "calls", charge: "monthly", currency: "DZD" },
  { key: "rent", category: "rent", charge: "monthly", currency: "DZD" },
  { key: "salary", category: "salaries", charge: "monthly", currency: "DZD" },
  { key: "subscription", category: "software", charge: "monthly", currency: "DZD" },
  { key: "shoot", category: "content", charge: "once", currency: "DZD" },
  { key: "influencer", category: "content", charge: "once", currency: "DZD" },
];

const ARABIC_DIGITS = /[٠-٩۰-۹]/g;

/**
 * An amount as a merchant types it — "30000", "30 000", "12,5", "٣٠٠٠" — as a
 * number with at most two decimals, above zero and at most `max`; null for
 * anything else ("30,000" is refused: a thousands mark or a decimal comma).
 */
export function parseAmount(text: string, max = MAX_COST_AMOUNT): number | null {
  const plain = text
    .trim()
    .replace(ARABIC_DIGITS, (digit) => String(digit.charCodeAt(0) - (digit.charCodeAt(0) >= 0x06f0 ? 0x06f0 : 0x0660)))
    .replace(/[\s  ٬]/g, "")
    .replace(/[,٫]/g, ".");
  if (!/^\d+(\.\d{1,2})?$/.test(plain)) return null;
  const value = Number(plain);
  return value > 0 && value <= max ? value : null;
}

const SYMBOLS = { USD: "$", EUR: "€" } as const;

/** An amount in its currency, as the merchant reads it: 30,000 DA, $20, 12,50 € — in Arabic, the number then its sign, like dinars. */
export function formatAmount(amount: number, currency: Currency, locale: Locale): string {
  if (currency === "DZD") return formatMoney(amount, locale);
  const digits = { minimumFractionDigits: Number.isInteger(amount) ? 0 : 2, maximumFractionDigits: 2 };
  if (locale === "ar") return `${new Intl.NumberFormat(intlLocale(locale), digits).format(amount)} ${SYMBOLS[currency]}`;
  return new Intl.NumberFormat(intlLocale(locale), { style: "currency", currency, currencyDisplay: "narrowSymbol", ...digits }).format(amount);
}

/** Dinars a summary counted, to the dinar. */
export const formatDinars = (amount: number, locale: Locale) => formatMoney(Math.round(amount), locale);

/** Where a cost stands on a day. */
export type CostStatus = "running" | "scheduled" | "stopped" | "paid";

export function costStatus(cost: Pick<Cost, "charge" | "startsOn" | "stopsOn">, today: string): CostStatus {
  if (cost.startsOn > today) return "scheduled";
  if (cost.charge === "once") return "paid";
  return cost.stopsOn !== null && cost.stopsOn < today ? "stopped" : "running";
}

/** Whether a cost counts on any day from `from` to `to`. */
export function touches(cost: Pick<Cost, "charge" | "startsOn" | "stopsOn">, from: string, to: string): boolean {
  if (cost.charge === "once") return cost.startsOn >= from && cost.startsOn <= to;
  return cost.startsOn <= to && (cost.stopsOn === null || cost.stopsOn >= from);
}

/** About what a repeating cost comes to in a month, in its own currency: what the form says while typing. */
export function perMonth(amount: number, charge: RepeatingCharge): number {
  if (charge === "daily") return amount * 30;
  if (charge === "weekly") return (amount * 30) / 7;
  if (charge === "yearly") return amount / 12;
  return amount;
}

/** The rate in force for a currency on a day: the latest set on or before it. */
export function rateOn(rates: readonly ExchangeRate[], currency: ForeignCurrency, day: string): ExchangeRate | null {
  return rates.filter((rate) => rate.currency === currency && rate.validFrom <= day).sort((a, b) => b.validFrom.localeCompare(a.validFrom))[0] ?? null;
}

const CODES: Record<string, string> = {
  COST_HAS_HISTORY: "errors.has_history",
  COST_DATES_INVALID: "errors.dates",
  PRODUCT_NOT_FOUND: "errors.product_gone",
  COST_NOT_FOUND: "errors.cost_gone",
  EXCHANGE_RATE_NOT_FOUND: "errors.rate_gone",
};

/** Why a change was refused, in the merchant's words. */
export function financeError(cause: unknown, t: (key: string) => string): string {
  const code = cause && typeof cause === "object" && "code" in cause ? String(cause.code) : "";
  return t(CODES[code] ?? "errors.generic");
}
