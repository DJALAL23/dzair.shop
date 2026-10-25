export type { BusinessEvent } from "../../../../cod-shared/events/log";
export type { ConsumerView as EventConsumer, DeliveryView as EventDelivery, WebhookView } from "../../../../cod-shared/events/consumers";
export type { DeliveryState, ConsumerDisabledReason } from "../../../../cod-shared/events/deliveries-model";
export type { EventSubject, EventType } from "../../../../cod-shared/events/catalogue";
export type { Actor, Origin } from "../../../../cod-shared/events/actor";
export type { SubscriptionPattern } from "../../../../cod-shared/events/subscription";
export type { WebhookTest, WebhookUrlProblem } from "../../../../cod-shared/events/webhooks";

/** What a retry or a Replay did: Deliveries made due again, and ones made for events never delivered. */
export interface Redelivery {
  reopened: number;
  created: number;
}

/** A Signing Secret in full, as the one answer that makes it gives it. */
export interface IssuedSecret {
  signingSecret: string;
  /** After a rotation: until when the secret it replaced also signs. */
  previousSecretSignsUntil?: string;
}
