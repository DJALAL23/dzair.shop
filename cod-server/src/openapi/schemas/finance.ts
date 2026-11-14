import { z } from "@hono/zod-openapi";
import { COST_CATEGORIES, COST_CHARGES, CURRENCIES, FOREIGN_CURRENCIES } from "../../../../cod-shared/finance/model";

const money = { charge: z.enum(COST_CHARGES), amount: z.number().openapi({ description: "In its currency" }), currency: z.enum(CURRENCIES) };

export const CostSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    category: z.enum(COST_CATEGORIES),
    ...money,
    startsOn: z.string().openapi({ description: "Store day it started; for a one-time cost, the day it was paid" }),
    since: z.string().openapi({ description: "Store day the amount in force started: later than `startsOn` once it changed" }),
    stopsOn: z.string().nullable().openapi({ description: "Its last store day; null while it runs" }),
    product: z
      .object({ id: z.string().nullable().openapi({ description: "Null once the product was deleted: the cost keeps its name" }), name: z.string() })
      .nullable()
      .openapi({ description: "The product it is for; null for the whole store" }),
    history: z.array(z.object({ ...money, validFrom: z.string(), validTo: z.string() })).openapi({ description: "Earlier amounts, newest first" }),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("Cost");

export const CostsSummarySchema = z
  .object({
    from: z.string(),
    to: z.string(),
    total: z.number().openapi({ description: "In DZD: every cost of the period, days without a rate left out" }),
    ads: z.number().openapi({ description: "In DZD: costs in the `ads` category" }),
    running: z.number().openapi({ description: "In DZD: the other one-time and repeating costs" }),
    perOrder: z.number().openapi({ description: "In DZD: the other costs charged per order" }),
    costs: z.array(
      z.object({
        id: z.string(),
        amount: z.number().openapi({ description: "In DZD, what it counts in the period" }),
        ownAmount: z.number().openapi({ description: "The same in its own currency, every day included" }),
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
