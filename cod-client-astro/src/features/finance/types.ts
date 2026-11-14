import type { CostCategory, CostCharge, Currency, ForeignCurrency } from "../../../../cod-shared/finance/model";

export type { CostCategory, CostCharge, Currency, ForeignCurrency };

/** An amount a cost had before a change from a day. */
export interface CostHistoryEntry {
  charge: CostCharge;
  amount: number;
  currency: Currency;
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
  /** Null for the whole store; a deleted product keeps its name, with no id. */
  product: { id: string | null; name: string } | null;
  history: CostHistoryEntry[];
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
  /** Left out on a change, the product stays as it is. */
  productId?: string | null;
  changeFrom?: string | null;
}

/** One cost over a period. */
export interface CostLine {
  id: string;
  /** In dinars. */
  amount: number;
  /** In its own currency, every day included. */
  ownAmount: number;
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
