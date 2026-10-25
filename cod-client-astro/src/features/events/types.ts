export type { BusinessEvent } from "../../../../cod-shared/events/log";
export type { ConsumerView as EventConsumer, DeliveryView as EventDelivery } from "../../../../cod-shared/events/consumers";
export type { DeliveryState, ConsumerDisabledReason } from "../../../../cod-shared/events/deliveries-model";
export type { EventType } from "../../../../cod-shared/events/catalogue";
export type { Actor, Origin } from "../../../../cod-shared/events/actor";

/** What a retry or a Replay did: Deliveries made due again, and ones made for events never delivered. */
export interface Redelivery {
  reopened: number;
  created: number;
}
