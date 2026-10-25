import type { Actor, BusinessEvent, ConsumerDisabledReason, EventConsumer, EventDelivery } from "./types";

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
export const KNOWN_KINDS = ["meta_capi"] as const;

export function kindLabelKey(kind: string): string | null {
  return (KNOWN_KINDS as readonly string[]).includes(kind) ? `kinds.${kind}` : null;
}

/** A settled Delivery can be tried again; one still due is on its way. */
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

/** A refused retry or Replay, in the merchant's words. */
export function redeliveryError(cause: unknown, t: Translate): string {
  const code = (cause as { code?: unknown } | null)?.code;
  if (code === "EVENT_CONSUMER_DISABLED") return t("errors.consumer_disabled");
  if (code === "EVENT_DELIVERY_ALREADY_DUE") return t("errors.already_due");
  return t("errors.generic");
}
