import { z } from "@hono/zod-openapi";
import { DELIVERY_PAGE_MAX } from "../../../../cod-shared/events/consumers";
import { DELIVERY_STATES } from "../../../../cod-shared/events/deliveries-model";

export const deliveryListQuerySchema = z
  .object({
    consumerId: z.string().min(1).optional().openapi({ description: "A Consumer's Deliveries, newest event first" }),
    eventId: z.string().min(1).optional().openapi({ description: "Every Delivery of one Business Event" }),
    state: z.enum(DELIVERY_STATES).optional().openapi({ description: "Only Deliveries in this state — `dead` for those given up on" }),
    before: z.coerce.number().int().min(0).optional().openapi({ description: "Read on from before this event Sequence: the previous page's `nextCursor`" }),
    limit: z.coerce.number().int().min(1).max(DELIVERY_PAGE_MAX).default(50).openapi({ description: `At most this many (1–${DELIVERY_PAGE_MAX})` }),
  })
  .refine((query) => (query.consumerId === undefined) !== (query.eventId === undefined), {
    message: "Name a Consumer or a Business Event, one of the two",
    path: ["consumerId"],
  });
