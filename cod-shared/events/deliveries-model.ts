/** The states a Delivery passes through, what one Attempt can come to, and why a Consumer stops receiving (Events context). */

export const DELIVERY_STATES = ["due", "delivered", "skipped", "dead"] as const;
export type DeliveryState = (typeof DELIVERY_STATES)[number];

export const ATTEMPT_OUTCOMES = ["delivered", "skipped", "retry", "reject"] as const;
export type AttemptOutcomeKind = (typeof ATTEMPT_OUTCOMES)[number];

/** Why the store stopped delivering to a Consumer: every Attempt failed for too long, or the merchant turned it off. */
export const CONSUMER_DISABLED_REASONS = ["failing", "merchant"] as const;
export type ConsumerDisabledReason = (typeof CONSUMER_DISABLED_REASONS)[number];
