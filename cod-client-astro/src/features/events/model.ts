import { EVENT_CATALOGUE, EVENT_TYPES } from "../../../../cod-shared/events/catalogue";
import { webhookUrlProblem } from "../../../../cod-shared/events/webhooks";
import { consumerOwnerPermissions, INTEGRATIONS } from "../../../../cod-shared/apps/catalog";
import type { Actor, BusinessEvent, ConsumerDisabledReason, EventConsumer, EventDelivery, EventSubject, SubscriptionPattern, WebhookUrlProblem } from "./types";

type Translate = (key: string, values?: Record<string, string | number>) => string;

/** Who caused a Business Event, in the merchant's words. */
export function actorLabel(actor: Actor, t: Translate): string {
  switch (actor.kind) {
    case "staff":
    case "carrier":
      return actor.name;
    case "agent":
      return t("actor.agent", { name: actor.name });
    case "shopper":
      return t("actor.shopper");
    case "system":
      return t("actor.system");
  }
}

/** "Confirmed by Nadia, from the dashboard". */
export function eventByline(event: BusinessEvent, t: Translate): string {
  return t("byline", { who: actorLabel(event.actor, t), through: t(`origin.${event.origin}`) });
}

export type ConsumerStatus = "active" | "failing" | "stopped_by_merchant" | "stopped_failing" | "stopped_gone";

const STOPPED: Record<ConsumerDisabledReason, ConsumerStatus> = { merchant: "stopped_by_merchant", failing: "stopped_failing", gone: "stopped_gone" };

export function consumerStatus(consumer: EventConsumer): ConsumerStatus {
  if (!consumer.enabled) return STOPPED[consumer.disabledReason ?? "merchant"];
  return consumer.failingSince ? "failing" : "active";
}

/** The Consumer Kinds the dashboard can name; a kind it does not know is shown by its Consumer's name alone. */
export const KNOWN_KINDS = ["meta_capi", "webhook"] as const;

export function kindLabelKey(kind: string): string | null {
  return (KNOWN_KINDS as readonly string[]).includes(kind) ? `kinds.${kind}` : null;
}

/** A settled Delivery can be tried again; one still due is on its way. */
/** On an order: who may open an event on who received it (anyone who may see some Consumer), and who is sent on to Integrations. */
export function orderEventsAccess(may: (scope: string) => boolean): { canSeeDeliveries: boolean; canOpenIntegrations: boolean } {
  return { canSeeDeliveries: consumerOwnerPermissions("read").some((scope) => may(scope)), canOpenIntegrations: may(INTEGRATIONS.permissions.read) };
}

export const canRetry = (delivery: EventDelivery, consumer: EventConsumer) => consumer.enabled && delivery.state !== "due";

/**
 * The range a Replay dialog opens on: the dead Deliveries listed, when there
 * are any — what the merchant most likely wants delivered again — else every
 * event listed.
 */
export function suggestedReplayRange(deliveries: readonly EventDelivery[]): { fromSequence: number; toSequence: number } | null {
  const pool = deliveries.some((d) => d.state === "dead") ? deliveries.filter((d) => d.state === "dead") : deliveries;
  if (pool.length === 0) return null;
  const sequences = pool.map((d) => d.event.sequence);
  return { fromSequence: Math.min(...sequences), toSequence: Math.max(...sequences) };
}

export const REPLAY_MAX_EVENTS = 1000;

export type ReplayRangeProblem = "not_whole" | "reversed" | "too_long";

/** What is wrong with a range the merchant typed, or null; the server checks it again. */
export function replayRangeProblem(fromSequence: number, toSequence: number): ReplayRangeProblem | null {
  if (!Number.isInteger(fromSequence) || !Number.isInteger(toSequence) || fromSequence < 1 || toSequence < 1) return "not_whole";
  if (fromSequence > toSequence) return "reversed";
  if (toSequence - fromSequence >= REPLAY_MAX_EVENTS) return "too_long";
  return null;
}

const REFUSALS: Record<string, string> = {
  EVENT_CONSUMER_DISABLED: "errors.consumer_disabled",
  EVENT_DELIVERY_ALREADY_DUE: "errors.already_due",
  EVENT_CONSUMER_BUILT_IN: "errors.built_in",
  EVENT_CONSUMER_LIMIT_REACHED: "errors.limit_reached",
  EVENT_CONSUMER_NOT_FOUND: "errors.not_found",
  VALIDATION_FAILED: "errors.invalid",
};

/** A refused action on a Consumer or a Delivery, in the merchant's words. */
export function actionError(cause: unknown, t: Translate): string {
  const code = (cause as { code?: unknown } | null)?.code;
  return t(typeof code === "string" && Object.hasOwn(REFUSALS, code) ? REFUSALS[code]! : "errors.generic");
}

export const SUBJECTS = [...new Set(EVENT_TYPES.map((type) => EVENT_CATALOGUE[type].subject))] as EventSubject[];

/** The Event Types of one subject, in the catalogue's order. */
export const typesOf = (subject: EventSubject) => EVENT_TYPES.filter((type) => EVENT_CATALOGUE[type].subject === subject);

/** Whether a wider pattern the merchant chose already covers this one: `*` covers all, `order.*` every order type. */
export function coveredByWider(patterns: readonly SubscriptionPattern[], pattern: SubscriptionPattern): boolean {
  if (pattern === "*") return false;
  if (patterns.includes("*")) return true;
  if (pattern.endsWith(".*")) return false;
  return patterns.includes(`${EVENT_CATALOGUE[pattern as keyof typeof EVENT_CATALOGUE].subject}.*` as SubscriptionPattern);
}

const PATTERN_ORDER: SubscriptionPattern[] = ["*", ...SUBJECTS.map((subject) => `${subject}.*` as SubscriptionPattern), ...EVENT_TYPES];

/**
 * A Subscription in its tightest form: each pattern once, none a wider one
 * already covers, in the catalogue's order. It never widens what was picked
 * — every order type picked one by one stays that list, because `order.*`
 * would also take the order types added later.
 */
export function tightSubscription(patterns: readonly SubscriptionPattern[]): SubscriptionPattern[] {
  return PATTERN_ORDER.filter((pattern) => patterns.includes(pattern) && !coveredByWider(patterns, pattern));
}

/** The Subscription after the merchant ticks or unticks one pattern; one a wider pattern covers changes nothing. */
export function pickPattern(patterns: readonly SubscriptionPattern[], pattern: SubscriptionPattern, on: boolean): SubscriptionPattern[] {
  return tightSubscription(on ? [...patterns, pattern] : patterns.filter((p) => p !== pattern));
}

/** What keeps a typed URL from being an endpoint, before the server says so too. */
export function endpointProblem(url: string): WebhookUrlProblem | null {
  return webhookUrlProblem(url);
}

/** What an edit really changes, field by field: an endpoint saved as it was is not a new endpoint. */
export function webhookChange(
  consumer: EventConsumer,
  fields: { name: string; url: string; subscription: SubscriptionPattern[] },
): Partial<{ name: string; url: string; subscription: SubscriptionPattern[] }> {
  const subscription = tightSubscription(fields.subscription);
  return {
    ...(fields.name !== consumer.name ? { name: fields.name } : {}),
    ...(fields.url !== consumer.webhook?.url ? { url: fields.url } : {}),
    ...(subscription.join() !== tightSubscription(consumer.subscription).join() ? { subscription } : {}),
  };
}
