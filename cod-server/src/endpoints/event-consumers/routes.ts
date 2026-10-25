/**
 * The store's Consumers through the merchant's API (Events context): who
 * receives its Business Events, how their Deliveries stand, and the
 * merchant's word on them — add a webhook, edit it, rotate its Signing
 * Secret, send it a Test Event, stop, start again, Replay, delete.
 */

import { OpenAPIHono, z } from "@hono/zod-openapi";
import type { AppContext } from "@/types";
import { defineRoute } from "@/lib/route-builder";
import { SCOPES } from "../../../../cod-shared/rbac/scopes";
import { REPLAY_MAX_EVENTS } from "../../../../cod-shared/events/deliveries";
import { WEBHOOK_CONSUMERS_MAX } from "../../../../cod-shared/events/webhooks";
import { consumerChangeSchema, replaySchema, testEventSchema, webhookCreateSchema } from "./validation";
import {
  EventConsumerSchema,
  IdParamSchema,
  ListResponseSchema,
  MessageResponseSchema,
  RedeliverySchema,
  SigningSecretSchema,
  SuccessResponseSchema,
  WebhookCreatedSchema,
  WebhookTestSchema,
} from "@/openapi/schemas";
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

const createConsumerRoute = defineRoute({
  method: "post",
  path: "/",
  auth: { scope: SCOPES.SETTINGS_INTEGRATIONS },
  tags: ["Events"],
  summary: "Add a webhook",
  description:
    "A webhook Consumer: an endpoint of the merchant's own that receives the Business Events it subscribes to, recorded from now on, each POSTed as JSON and signed per the Standard Webhooks specification. Its Signing Secret is in this answer and never shown in full again.",
  operationId: "createEventConsumer",
  body: webhookCreateSchema,
  responses: {
    201: { description: "The webhook, and its Signing Secret", content: jsonContent(SuccessResponseSchema(WebhookCreatedSchema)) },
    400: { description: "Not a webhook this store can send to: a public https URL, a name, one or more Event Types (VALIDATION_FAILED)" },
    409: { description: `The store already has ${WEBHOOK_CONSUMERS_MAX} webhooks (EVENT_CONSUMER_LIMIT_REACHED)` },
  },
  handler: handlers.createEventConsumer,
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
  summary: "Change a Consumer",
  description:
    "Start or stop any Consumer; rename a webhook, point it at another URL or change what it subscribes to. Stopped, a Consumer receives nothing: its waiting Deliveries are skipped and new events are not delivered to it. Started again, it receives what is recorded from then on and its failing streak is cleared; replay what it missed. A new Subscription applies to what is recorded from then on; a new URL starts without a failing streak.",
  operationId: "updateEventConsumer",
  params: IdParamSchema,
  body: consumerChangeSchema,
  responses: {
    200: { description: "The Consumer as it now stands", content: jsonContent(SuccessResponseSchema(EventConsumerSchema)) },
    400: { description: "Not a change this API makes (VALIDATION_FAILED)" },
    404: { description: "No Consumer with this id (EVENT_CONSUMER_NOT_FOUND)" },
    409: { description: "A built-in Consumer is kept by the store's own settings: only start or stop it (EVENT_CONSUMER_BUILT_IN)" },
  },
  handler: handlers.updateEventConsumer,
});

const deleteConsumerRoute = defineRoute({
  method: "delete",
  path: "/{id}",
  auth: { scope: SCOPES.SETTINGS_INTEGRATIONS },
  tags: ["Events"],
  summary: "Delete a webhook",
  description: "The webhook goes with its Deliveries and their Attempts. The Business Events stay in the Event Log.",
  operationId: "deleteEventConsumer",
  params: IdParamSchema,
  responses: {
    200: { description: "Deleted", content: jsonContent(MessageResponseSchema) },
    404: { description: "No Consumer with this id (EVENT_CONSUMER_NOT_FOUND)" },
    409: { description: "A built-in Consumer is kept by the store's own settings: stop it instead (EVENT_CONSUMER_BUILT_IN)" },
  },
  handler: handlers.deleteEventConsumer,
});

const rotateSecretRoute = defineRoute({
  method: "post",
  path: "/{id}/rotate-secret",
  auth: { scope: SCOPES.SETTINGS_INTEGRATIONS },
  tags: ["Events"],
  summary: "Rotate a webhook's Signing Secret",
  description:
    "A new Signing Secret, in this answer and never shown in full again. For a day, Deliveries carry a signature by each secret, so the endpoint switches to the new one without refusing any; after that, only the new one signs.",
  operationId: "rotateEventConsumerSecret",
  params: IdParamSchema,
  responses: {
    200: { description: "The new Signing Secret", content: jsonContent(SuccessResponseSchema(SigningSecretSchema)) },
    404: { description: "No Consumer with this id (EVENT_CONSUMER_NOT_FOUND)" },
    409: { description: "Only a webhook has a Signing Secret (EVENT_CONSUMER_BUILT_IN)" },
  },
  handler: handlers.rotateEventConsumerSecret,
});

const testEventRoute = defineRoute({
  method: "post",
  path: "/{id}/test",
  auth: { scope: SCOPES.SETTINGS_INTEGRATIONS },
  tags: ["Events"],
  summary: "Send a Test Event to a webhook",
  description:
    "POSTs an example of an Event Type to the webhook now, signed like any Delivery, and answers what the endpoint did. A Test Event has Sequence 0 and an id starting `test_`; it is recorded in no Event Log and has no Delivery. It is sent to a stopped webhook too.",
  operationId: "testEventConsumer",
  params: IdParamSchema,
  body: testEventSchema,
  responses: {
    200: { description: "What the endpoint did with it", content: jsonContent(SuccessResponseSchema(WebhookTestSchema)) },
    400: { description: "Not an Event Type (VALIDATION_FAILED)" },
    404: { description: "No Consumer with this id (EVENT_CONSUMER_NOT_FOUND)" },
    409: { description: "Only a webhook is sent Test Events (EVENT_CONSUMER_BUILT_IN)" },
  },
  handler: handlers.testEventConsumer,
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
router.openapi(createConsumerRoute.route, createConsumerRoute.handler);
router.openapi(getConsumerRoute.route, getConsumerRoute.handler);
router.openapi(updateConsumerRoute.route, updateConsumerRoute.handler);
router.openapi(deleteConsumerRoute.route, deleteConsumerRoute.handler);
router.openapi(rotateSecretRoute.route, rotateSecretRoute.handler);
router.openapi(testEventRoute.route, testEventRoute.handler);
router.openapi(replayRoute.route, replayRoute.handler);

export default router;
