/**
 * The Event Log, read by the merchant's API (Events context): every Business
 * Event the store recorded, in the shape every Consumer receives.
 */

import { OpenAPIHono, z } from "@hono/zod-openapi";
import type { AppContext } from "@/types";
import { defineRoute } from "@/lib/route-builder";
import { SCOPES } from "../../../../cod-shared/rbac/scopes";
import { IdParamSchema, ListResponseSchema, SuccessResponseSchema } from "@/openapi/schemas";
import { BUSINESS_EVENT_SCHEMA } from "@/events/catalogue";
import { eventLogQuerySchema } from "./validation";
import * as handlers from "./handlers";

const BusinessEventSchema = BUSINESS_EVENT_SCHEMA.openapi("BusinessEvent", {
  description:
    "A Business Event as it is published: its envelope — id (the same on every delivery), Sequence, type and version, subject, order, when it happened and was recorded, who caused it and through what — and the data its type and version promise. Fields are only ever added.",
});

const jsonContent = <T extends z.ZodType>(schema: T) => ({ "application/json": { schema } });

const listEventsRoute = defineRoute({
  method: "get",
  path: "/",
  auth: { scope: SCOPES.ORDERS_READ },
  tags: ["Events"],
  summary: "Read the Event Log",
  description:
    "The store's Business Events. With `after`, oldest first from that Sequence: follow the log by passing each page's `nextCursor` as the next `after`. Otherwise newest first, paged back with `before`.",
  operationId: "listEvents",
  query: eventLogQuerySchema,
  responses: {
    200: {
      description: "A page of the Event Log",
      content: jsonContent(
        ListResponseSchema(BusinessEventSchema).extend({
          nextCursor: z.number().int().nullable().openapi({ description: "The Sequence to pass as `after` (or `before`, the way this page was read) for the next page; null on the last page" }),
        }),
      ),
    },
    400: { description: "A type that is not an Event Type or pattern, or `after` and `before` together (VALIDATION_FAILED)" },
  },
  handler: handlers.listEvents,
});

const getEventRoute = defineRoute({
  method: "get",
  path: "/{id}",
  auth: { scope: SCOPES.ORDERS_READ },
  tags: ["Events"],
  summary: "Get a Business Event",
  operationId: "getEvent",
  params: IdParamSchema,
  responses: {
    200: { description: "The Business Event", content: jsonContent(SuccessResponseSchema(BusinessEventSchema)) },
    404: { description: "No Business Event with this id (BUSINESS_EVENT_NOT_FOUND); events are kept 90 days" },
  },
  handler: handlers.getEvent,
});

const router = new OpenAPIHono<AppContext>();
router.openapi(listEventsRoute.route, listEventsRoute.handler);
router.openapi(getEventRoute.route, getEventRoute.handler);

export default router;
