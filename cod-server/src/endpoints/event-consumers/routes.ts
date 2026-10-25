/**
 * The store's Consumers through the merchant's API (Events context): who
 * receives its Business Events, how their Deliveries stand, and the
 * merchant's word on them — stop, start again, Replay.
 */

import { OpenAPIHono, z } from "@hono/zod-openapi";
import type { AppContext } from "@/types";
import { defineRoute } from "@/lib/route-builder";
import { SCOPES } from "../../../../cod-shared/rbac/scopes";
import { REPLAY_MAX_EVENTS } from "../../../../cod-shared/events/deliveries";
import { consumerChangeSchema, replaySchema } from "./validation";
import { EventConsumerSchema, IdParamSchema, ListResponseSchema, RedeliverySchema, SuccessResponseSchema } from "@/openapi/schemas";
import * as handlers from "./handlers";

const jsonContent = <T extends z.ZodType>(schema: T) => ({ "application/json": { schema } });

const listConsumersRoute = defineRoute({
  method: "get",
  path: "/",
  auth: { scope: SCOPES.SETTINGS_INTEGRATIONS },
  tags: ["Events"],
  summary: "List Consumers",
  description: "Who receives the store's Business Events, with how many Deliveries are on their way and how many were given up on.",
  operationId: "listEventConsumers",
  responses: { 200: { description: "Every Consumer, oldest first", content: jsonContent(ListResponseSchema(EventConsumerSchema)) } },
  handler: handlers.listEventConsumers,
});

const getConsumerRoute = defineRoute({
  method: "get",
  path: "/{id}",
  auth: { scope: SCOPES.SETTINGS_INTEGRATIONS },
  tags: ["Events"],
  summary: "Get a Consumer",
  operationId: "getEventConsumer",
  params: IdParamSchema,
  responses: {
    200: { description: "The Consumer", content: jsonContent(SuccessResponseSchema(EventConsumerSchema)) },
    404: { description: "No Consumer with this id (EVENT_CONSUMER_NOT_FOUND)" },
  },
  handler: handlers.getEventConsumer,
});

const updateConsumerRoute = defineRoute({
  method: "patch",
  path: "/{id}",
  auth: { scope: SCOPES.SETTINGS_INTEGRATIONS },
  tags: ["Events"],
  summary: "Start or stop a Consumer",
  description:
    "Stopped, a Consumer receives nothing: its waiting Deliveries are skipped and new events are not delivered to it. Started again, it receives what is recorded from then on and its failing streak is cleared; replay what it missed.",
  operationId: "updateEventConsumer",
  params: IdParamSchema,
  body: consumerChangeSchema,
  responses: {
    200: { description: "The Consumer as it now stands", content: jsonContent(SuccessResponseSchema(EventConsumerSchema)) },
    400: { description: "Not a change this API makes (VALIDATION_FAILED)" },
    404: { description: "No Consumer with this id (EVENT_CONSUMER_NOT_FOUND)" },
  },
  handler: handlers.updateEventConsumer,
});

const replayRoute = defineRoute({
  method: "post",
  path: "/{id}/replay",
  auth: { scope: SCOPES.SETTINGS_INTEGRATIONS },
  tags: ["Events"],
  summary: "Replay Business Events to a Consumer",
  description:
    "Deliver the Business Events of a Sequence range again to this Consumer — those it subscribes to now. Settled Deliveries become due with their Attempts started over (their history is kept); events it never received, recorded while it was stopped or before it existed, get a Delivery. One already on its way is left alone. No Business Event is recorded again.",
  operationId: "replayEventConsumer",
  params: IdParamSchema,
  body: replaySchema,
  responses: {
    202: { description: "Accepted: the Deliveries are due and the store delivers them", content: jsonContent(SuccessResponseSchema(RedeliverySchema)) },
    400: { description: "Not a range of 1 to " + REPLAY_MAX_EVENTS + " Sequences (VALIDATION_FAILED)" },
    404: { description: "No Consumer with this id (EVENT_CONSUMER_NOT_FOUND)" },
    409: { description: "The Consumer is stopped; start it first (EVENT_CONSUMER_DISABLED)" },
  },
  handler: handlers.replayEventConsumer,
});

const router = new OpenAPIHono<AppContext>();
router.openapi(listConsumersRoute.route, listConsumersRoute.handler);
router.openapi(getConsumerRoute.route, getConsumerRoute.handler);
router.openapi(updateConsumerRoute.route, updateConsumerRoute.handler);
router.openapi(replayRoute.route, replayRoute.handler);

export default router;
