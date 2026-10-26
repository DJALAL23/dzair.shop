/**
 * Deliveries through the merchant's API (Events context): how each Business
 * Event reached each Consumer, every Attempt it took, and a retry on the
 * merchant's word.
 */

import { OpenAPIHono, z } from "@hono/zod-openapi";
import type { AppContext } from "@/types";
import { defineRoute } from "@/lib/route-builder";
import { consumerOwnerPermissions } from "../../../../cod-shared/apps/catalog";
import { EventDeliveryDetailSchema, EventDeliverySchema, IdParamSchema, ListResponseSchema, RedeliverySchema, SuccessResponseSchema } from "@/openapi/schemas";
import { deliveryListQuerySchema } from "./validation";
import * as handlers from "./handlers";

const jsonContent = <T extends z.ZodType>(schema: T) => ({ "application/json": { schema } });

/** Any Consumer's owner's: each Delivery is then seen and steered with its Consumer's owner's (../event-consumers/access). */
const SEE = { anyOf: consumerOwnerPermissions("read") };
const STEER = { anyOf: consumerOwnerPermissions("manage") };

const listDeliveriesRoute = defineRoute({
  method: "get",
  path: "/",
  auth: SEE,
  tags: ["Events"],
  summary: "List Deliveries",
  description: "A Consumer's Deliveries, newest event first and paged with `before`, or every Delivery of one Business Event. `state=dead` lists those given up on.",
  operationId: "listEventDeliveries",
  query: deliveryListQuerySchema,
  responses: {
    200: {
      description: "A page of Deliveries",
      content: jsonContent(
        ListResponseSchema(EventDeliverySchema).extend({
          nextCursor: z.number().int().nullable().openapi({ description: "Pass as `before` for the next page; null on the last page" }),
        }),
      ),
    },
    400: { description: "Neither a Consumer nor a Business Event named, or both (VALIDATION_FAILED)" },
  },
  handler: handlers.listEventDeliveries,
});

const getDeliveryRoute = defineRoute({
  method: "get",
  path: "/{id}",
  auth: SEE,
  tags: ["Events"],
  summary: "Get a Delivery",
  description: "The Delivery with every Attempt it took and what the Consumer answered.",
  operationId: "getEventDelivery",
  params: IdParamSchema,
  responses: {
    200: { description: "The Delivery", content: jsonContent(SuccessResponseSchema(EventDeliveryDetailSchema)) },
    404: { description: "No Delivery with this id (EVENT_DELIVERY_NOT_FOUND)" },
  },
  handler: handlers.getEventDelivery,
});

const retryDeliveryRoute = defineRoute({
  method: "post",
  path: "/{id}/retry",
  auth: STEER,
  tags: ["Events"],
  summary: "Retry a Delivery",
  description: "Make a settled Delivery — dead, skipped or delivered — due again now, its Attempts started over; its history is kept.",
  operationId: "retryEventDelivery",
  params: IdParamSchema,
  responses: {
    202: { description: "Accepted: the Delivery is due and the store delivers it", content: jsonContent(SuccessResponseSchema(RedeliverySchema)) },
    404: { description: "No Delivery with this id (EVENT_DELIVERY_NOT_FOUND)" },
    409: { description: "Already on its way (EVENT_DELIVERY_ALREADY_DUE), or its Consumer is stopped (EVENT_CONSUMER_DISABLED)" },
  },
  handler: handlers.retryEventDelivery,
});

const router = new OpenAPIHono<AppContext>();
router.openapi(listDeliveriesRoute.route, listDeliveriesRoute.handler);
router.openapi(getDeliveryRoute.route, getDeliveryRoute.handler);
router.openapi(retryDeliveryRoute.route, retryDeliveryRoute.handler);

export default router;
