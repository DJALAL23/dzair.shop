/**
 * A Subscription: the Event Types a Consumer asked for, each named exactly
 * (`order.confirmed`), by subject (`order.*`), or all of them (`*`).
 */

import { EVENT_CATALOGUE, EVENT_TYPES, type EventSubject, type EventType } from "./catalogue";

export type SubscriptionPattern = EventType | `${EventSubject}.*` | "*";

const SUBJECTS = new Set<string>(Object.values(EVENT_CATALOGUE).map((entry) => entry.subject));

export function isSubscriptionPattern(value: unknown): value is SubscriptionPattern {
  if (typeof value !== "string") return false;
  if (value === "*") return true;
  if (value.endsWith(".*")) return SUBJECTS.has(value.slice(0, -2));
  return (EVENT_TYPES as readonly string[]).includes(value);
}

/** Whether a Consumer with these patterns receives this Event Type. */
export function subscribesTo(patterns: readonly SubscriptionPattern[], type: EventType): boolean {
  return patterns.some((pattern) => pattern === "*" || pattern === type || pattern === `${EVENT_CATALOGUE[type].subject}.*`);
}

/**
 * The patterns stored on a Consumer. A stored value that is not a list of
 * patterns subscribes to nothing — it is never read as "everything".
 */
export function readSubscription(stored: string): SubscriptionPattern[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    return [];
  }
  return Array.isArray(parsed) ? parsed.filter(isSubscriptionPattern) : [];
}
