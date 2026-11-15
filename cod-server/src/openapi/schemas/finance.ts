import { z } from "@hono/zod-openapi";
import { COST_CATEGORIES, COST_CHARGES, CURRENCIES, FOREIGN_CURRENCIES } from "../../../../cod-shared/finance/model";

const money = { charge: z.enum(COST_CHARGES), amount: z.number().openapi({ description: "In its currency" }), currency: z.enum(CURRENCIES) };
const product = z.object({ id: z.string().nullable().openapi({ description: "Null once the product was deleted: the cost keeps its name, and still counts its orders" }), name: z.string() }).nullable();

export const CostSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    category: z.enum(COST_CATEGORIES),
    ...money,
    startsOn: z.string().openapi({ description: "Store day it started; for a one-time cost, the day it was paid" }),
    since: z.string().openapi({ description: "Store day the amount in force started: later than `startsOn` once it changed from a day" }),
    stopsOn: z.string().nullable().openapi({ description: "Its last store day; null while it runs" }),
    product: product.openapi({ description: "The product it is for; null for the whole store" }),
    history: z
      .array(z.object({ ...money, product: product.openapi({ description: "What it was for then; null for the whole store" }), validFrom: z.string(), validTo: z.string() }))
      .openapi({ description: "What it was before a change from a day, newest first" }),
    revision: z.string().openapi({ description: "Name it when changing the cost: a change to a cost changed since is refused" }),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("Cost");

export const CostsSummarySchema = z
  .object({
    from: z.string(),
    to: z.string(),
    total: z.number().openapi({ description: "In DZD, to the dinar: every cost of the period, days without a rate left out. Always the sum of the costs' amounts, and of `ads`, `running` and `perOrder`" }),
    ads: z.number().openapi({ description: "In DZD: costs in the `ads` category" }),
    running: z.number().openapi({ description: "In DZD: the other one-time and repeating costs" }),
    perOrder: z.number().openapi({ description: "In DZD: the other costs charged per order" }),
    costs: z.array(
      z.object({
        id: z.string(),
        amount: z.number().openapi({ description: "In DZD, to the dinar: what it counts in the period" }),
        ownAmount: z.number().nullable().openapi({ description: "The same in its own currency, every day included; null when it counted nothing or changed currency in the period" }),
        ownCurrency: z.enum(CURRENCIES).nullable().openapi({ description: "The currency of `ownAmount`" }),
        orders: z.number().int().nullable().openapi({ description: "The orders it counted, for a cost charged per order" }),
        missingFrom: z.string().nullable().openapi({ description: "The first day of the period with no rate for its currency; null when none is missing" }),
      }),
    ),
    missing: z
      .array(z.object({ currency: z.enum(FOREIGN_CURRENCIES), from: z.string(), costIds: z.array(z.string()) }))
      .openapi({ description: "Each currency with days that have no rate: from the first such day, and the costs it leaves out" }),
  })
  .openapi("CostsSummary");

export const ExchangeRateSchema = z
  .object({ id: z.string(), currency: z.enum(FOREIGN_CURRENCIES), dzdPerUnit: z.number(), validFrom: z.string(), createdAt: z.string() })
  .openapi("ExchangeRate");
