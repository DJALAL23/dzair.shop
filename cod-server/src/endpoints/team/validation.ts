import { z } from "@hono/zod-openapi";
import { DISTRIBUTIONS, PAY_KINDS } from "../../../../cod-shared/team/model";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "A day as YYYY-MM-DD");

export const assignOrdersSchema = z.object({
  orderIds: z.array(z.string().min(1)).min(1).max(100),
  to: z.string().min(1).nullable().openapi({ description: "A team member's user id; null: to nobody; `rule`: share them out by the store's rule, each to someone other than who has it" }),
});

export const callbackSchema = z.object({
  at: z.iso.datetime({ offset: true }).nullable().openapi({ description: "When to call the customer back; null clears it" }),
});

export const addMemberSchema = z.object({
  userId: z.string().min(1),
  receiving: z.boolean().default(true).openapi({ description: "Whether they receive new orders automatically from now" }),
});

export const receivingSchema = z.object({
  receiving: z.boolean(),
});

export const teamConfigSchema = z.object({
  distribution: z.enum(DISTRIBUTIONS).openapi({ description: "`manual`: a manager gives every order; `in_turn`: to each receiving member in turn; `evenly`: to the receiving member with the fewest orders waiting" }),
  takeBackMinutes: z.number().int().min(5).max(1440).nullable().openapi({ description: "Minutes a member has to act on a new order before it moves on; null: never" }),
  takeBackLimit: z.number().int().min(1).max(10).openapi({ description: "How many times an order moves on before it waits for a manager" }),
});

export const payRateSchema = z.object({
  kind: z.enum(PAY_KINDS).openapi({ description: "`salary` a month; `per_confirmed` per order they confirm; `per_delivered` per order they confirmed that is delivered" }),
  amount: z.number().int().min(0).max(10_000_000).openapi({ description: "In DZD" }),
  validFrom: day.openapi({ description: "From this day on (a salary, from the first of its month); the same kind from the same day is replaced" }),
});

export const resultsQuerySchema = z
  .object({
    from: day.openapi({ description: "First store day (Algeria), included" }),
    to: day.openapi({ description: "Last store day, included" }),
  })
  .refine((q) => q.from <= q.to, "`from` comes before `to`")
  .refine((q) => Date.parse(q.to) - Date.parse(q.from) <= 366 * 86_400_000, "A period of at most a year");

export const payrollQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "A month as YYYY-MM"),
});

export const userIdParams = z.object({ userId: z.string().min(1) });
export const payIdParams = z.object({ id: z.string().min(1) });
