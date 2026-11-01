import { z } from "@hono/zod-openapi";
import { REPLAY_MAX_EVENTS } from "../../../../cod-shared/events/deliveries";
import { EVENT_TYPES } from "../../../../cod-shared/events/catalogue";
import { isSubscriptionPattern, type SubscriptionPattern } from "../../../../cod-shared/events/subscription";
import { WEBHOOK_KIND, WEBHOOK_URL_MAX, webhookUrlProblem, type WebhookUrlProblem } from "../../../../cod-shared/events/webhooks";

const URL_PROBLEMS: Record<WebhookUrlProblem, string> = {
  invalid: "Not a URL",
  too_long: `At most ${WEBHOOK_URL_MAX} characters`,
  not_https: "The endpoint must use https",
  credentials: "Put no user name or password in the URL; authenticate the request by its signature",
  private_host: "The endpoint must be on the public internet, not a private network or a reserved name",
};

const name = z.string().trim().min(1).max(80).openapi({ description: "What the merchant calls it", example: "Order system" });

const url = z
  .string()
  .trim()
  .superRefine((value, ctx) => {
    const problem = webhookUrlProblem(value);
    if (problem) ctx.addIssue({ code: "custom", message: URL_PROBLEMS[problem], params: { problem } });
  })
  .openapi({ description: "Where Deliveries are POSTed: a public https URL", example: "https://erp.example.dz/hooks/wocart" });

const subscription = z
  .array(z.string().refine(isSubscriptionPattern, { message: "Not an Event Type, a subject (`order.*`) or `*`" }))
  .min(1)
  .max(EVENT_TYPES.length + 3)
  .transform((patterns) => patterns as SubscriptionPattern[])
  .openapi({ description: "The Event Types it receives, each named exactly, by subject (`order.*`), or `*`", example: ["order.created", "shipment.*"] });

export const webhookCreateSchema = z.object({
  kind: z.literal(WEBHOOK_KIND).openapi({ description: "The kind of Consumer: `webhook`, an endpoint of the merchant's own" }),
  name,
  url,
  subscription,
});

export const consumerChangeSchema = z
  .object({
    enabled: z.boolean().optional().openapi({ description: "Start (true) or stop (false) delivering to it" }),
    name: name.optional(),
    url: url.optional(),
    subscription: subscription.optional(),
  })
  .refine((change) => Object.values(change).some((value) => value !== undefined), { message: "Say what to change: enabled, name, url or subscription" });

export const testEventSchema = z.object({
  type: z.enum(EVENT_TYPES).optional().openapi({ description: "Which Event Type's example to send; `order.created` when not said" }),
});

const sequence = z.number().int().min(1);
export const replaySchema = z
  .object({
    fromSequence: sequence.openapi({ description: "The first Business Event to deliver again, by Sequence" }),
    toSequence: sequence.openapi({ description: `The last one; at most ${REPLAY_MAX_EVENTS} Sequences after the first` }),
  })
  .refine((range) => range.fromSequence <= range.toSequence && range.toSequence - range.fromSequence < REPLAY_MAX_EVENTS, {
    message: `A Replay spans 1 to ${REPLAY_MAX_EVENTS} Sequences, from the first to the last`,
    path: ["toSequence"],
  });
