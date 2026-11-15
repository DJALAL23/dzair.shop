import { z } from "@hono/zod-openapi";
import { COST_CATEGORIES, COST_CHARGES, CURRENCIES, FOREIGN_CURRENCIES, MAX_COST_AMOUNT, MAX_RATE } from "../../../../cod-shared/finance/model";

const isDay = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00.000Z`).toISOString().startsWith(value);
const day = z.string().refine(isDay, "A day as YYYY-MM-DD");
const twoDecimals = (value: number) => Math.abs(Math.round(value * 100) - value * 100) < 1e-6;

const costFields = {
  name: z.string().trim().min(1).max(80).openapi({ description: "What the merchant calls it: Facebook ads, Rent, Packaging…" }),
  category: z.enum(COST_CATEGORIES).openapi({ description: "`ads`, `packaging`, `calls` (call center, phone credit), `content` (shoots, influencers), `salaries` (people outside the confirmation team, whose pay is in Team → Payroll), `rent` (rent and bills), `software` (apps and subscriptions), `other`" }),
  charge: z.enum(COST_CHARGES).openapi({
    description: "`once` on the day it was paid; `daily`, `weekly`, `monthly`, `yearly` from its first day, spread over each day it runs; `per_confirmed`, `per_shipped`, `per_delivered`, `per_returned` on each order confirmed, handed to a carrier or driver, delivered or returned while it runs",
  }),
  amount: z.number().positive().max(MAX_COST_AMOUNT).refine(twoDecimals, "At most two decimals").openapi({ description: "In its currency, at most two decimals: each time it is charged" }),
  currency: z.enum(CURRENCIES).openapi({ description: "A cost in dollars or euros is counted in dinars at the store's rate in force on each day it counts" }),
  startsOn: day.openapi({ description: "Store day it starts; for a one-time cost, the day it was paid" }),
  stopsOn: day.nullable().default(null).openapi({ description: "Its last store day; null while it runs. Always null for a one-time cost" }),
};

const daysFollowOn = <T extends { charge: string; startsOn: string; stopsOn: string | null }>(schema: z.ZodType<T>) =>
  schema
    .refine((cost) => cost.charge !== "once" || cost.stopsOn === null, { message: "A one-time cost has no last day", path: ["stopsOn"] })
    .refine((cost) => cost.stopsOn === null || cost.stopsOn >= cost.startsOn, { message: "It stops on or after the day it starts", path: ["stopsOn"] });

export const costSchema = daysFollowOn(
  z.object({
    ...costFields,
    productId: z.string().min(1).nullable().default(null).openapi({ description: "The product it is for; null for the whole store" }),
  }),
);

export const costUpdateSchema = daysFollowOn(
  z.object({
    ...costFields,
    revision: z.string().min(1).openapi({ description: "The cost's `revision` as read: a cost changed since, by anyone, is not changed (409 COST_CHANGED), so a change is never applied to a state its author did not see, nor twice" }),
    productId: z.string().min(1).nullable().optional().openapi({ description: "The product it is for; null for the whole store; left out, it stays as it is" }),
    changeFrom: day.nullable().optional().openapi({
      description:
        "The store day, today at the latest, a change of what it costs (amount, currency, charge) or what it is for (`productId`) applies from: the days before keep theirs. Left out, the change applies from the day its amount in force started: a correction. On or before its first day, it applies to the whole cost",
    }),
  }),
);

export const summaryQuerySchema = z
  .object({
    from: day.openapi({ description: "First store day (Algeria), included" }),
    to: day.openapi({ description: "Last store day, included" }),
  })
  .refine((q) => q.from <= q.to, "`from` comes before `to`")
  .refine((q) => Date.parse(q.to) - Date.parse(q.from) <= 366 * 86_400_000, "A period of at most a year");

export const rateSchema = z.object({
  currency: z.enum(FOREIGN_CURRENCIES),
  dzdPerUnit: z.number().positive().max(MAX_RATE).refine(twoDecimals, "At most two decimals").openapi({ description: "What one unit of the currency costs the merchant, in dinars: what they really pay, not the bank's rate" }),
  validFrom: day.openapi({ description: "From this store day on; the same currency and day again replaces it" }),
});

export const idParams = z.object({ id: z.string().min(1) });
