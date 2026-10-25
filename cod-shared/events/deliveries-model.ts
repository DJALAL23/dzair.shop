/** The states a Delivery passes through, and what one Attempt can come to (Events context). */

export const DELIVERY_STATES = ["due", "delivered", "skipped", "dead"] as const;
export type DeliveryState = (typeof DELIVERY_STATES)[number];

export const ATTEMPT_OUTCOMES = ["delivered", "skipped", "retry", "reject"] as const;
export type AttemptOutcomeKind = (typeof ATTEMPT_OUTCOMES)[number];
