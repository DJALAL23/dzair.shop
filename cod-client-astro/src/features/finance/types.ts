import type { CostCategory, CostCharge, Currency, ForeignCurrency } from "../../../../cod-shared/finance/model";

export type { CostCategory, CostCharge, Currency, ForeignCurrency };

/** A product a cost is for; a deleted product keeps its name, with no id. */
export type CostProduct = { id: string | null; name: string } | null;

/** What a cost was before a change from a day: its amount, and what it was for. */
export interface CostHistoryEntry {
  charge: CostCharge;
  amount: number;
  currency: Currency;
  product: CostProduct;
  validFrom: string;
  validTo: string;
}

export interface Cost {
  id: string;
  name: string;
  category: CostCategory;
  charge: CostCharge;
  /** In its currency, each time it is charged. */
  amount: number;
  currency: Currency;
  startsOn: string;
  /** The day the amount in force started. */
  since: string;
  stopsOn: string | null;
  /** Null for the whole store. */
  product: CostProduct;
  /** What it was before, newest first. */
  history: CostHistoryEntry[];
  /** Sent back with a change: a cost changed since is not changed. */
  revision: string;
  createdAt: string;
  updatedAt: string;
}

/** What a cost is and costs, as sent to the API. */
export interface CostInput {
  name: string;
  category: CostCategory;
  charge: CostCharge;
  amount: number;
  currency: Currency;
  startsOn: string;
  stopsOn: string | null;
  /** Left out on a change, what it is for stays as it is. */
  productId?: string | null;
  /** The day a change of what it costs or is for applies from, today at the latest. */
  changeFrom?: string | null;
}

/** One cost over a period. */
export interface CostLine {
  id: string;
  /** In dinars. */
  amount: number;
  /** In its own currency, every day included; null when it counted nothing or changed currency in the period. */
  ownAmount: number | null;
  ownCurrency: Currency | null;
  orders: number | null;
  missingFrom: string | null;
}

export interface MissingRate {
  currency: ForeignCurrency;
  from: string;
  costIds: string[];
}

export interface CostsSummary {
  from: string;
  to: string;
  total: number;
  ads: number;
  running: number;
  perOrder: number;
  costs: CostLine[];
  missing: MissingRate[];
}

export interface ExchangeRate {
  id: string;
  currency: ForeignCurrency;
  dzdPerUnit: number;
  validFrom: string;
  createdAt: string;
}
