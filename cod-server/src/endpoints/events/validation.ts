import { z } from "@hono/zod-openapi";
import { isSubscriptionPattern, type SubscriptionPattern } from "../../../../cod-shared/events/subscription";
import { EVENT_LOG_PAGE_MAX } from "../../../../cod-shared/events/log";

const sequence = z.coerce.number().int().min(0);

export const eventLogQuerySchema = z
  .object({
    after: sequence.optional().openapi({
      description: "Read forward, oldest first, from after this Sequence — how an integration follows the log (`after=0` reads from the start).",
    }),
    before: sequence.optional().openapi({ description: "Read back, newest first, from before this Sequence." }),
    limit: z.coerce.number().int().min(1).max(EVENT_LOG_PAGE_MAX).default(50).openapi({ description: `At most this many events (1–${EVENT_LOG_PAGE_MAX})` }),
    type: z
      .string()
      .optional()
      .transform((value, ctx): SubscriptionPattern[] | undefined => {
        if (value === undefined) return undefined;
        const patterns = value.split(",").map((part) => part.trim());
        const unknown = patterns.filter((pattern) => !isSubscriptionPattern(pattern));
        if (unknown.length) {
          ctx.addIssue({ code: "custom", message: `Not an Event Type or pattern: ${unknown.join(", ")}` });
          return z.NEVER;
        }
        return patterns as SubscriptionPattern[];
      })
      .openapi({
        type: "string",
        description: "Only these Event Types, comma-separated, each named exactly (`order.confirmed`), by subject (`order.*`), or `*`.",
        example: "order.created,shipment.*",
      }),
    orderId: z.string().min(1).optional().openapi({ description: "Only the events of this order" }),
  })
  .refine((query) => query.after === undefined || query.before === undefined, {
    message: "Read after a Sequence or before one, never both",
    path: ["before"],
  });
