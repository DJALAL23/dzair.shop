import { describe, expect, it } from "vitest";
import { EVENT_CATALOGUE, EVENT_TYPES } from "./catalogue";
import { isSubscriptionPattern, readSubscription, subscribesTo, SUBSCRIPTION_PATTERNS_MAX } from "./subscription";

describe("a Subscription", () => {
  it("can name every pattern there is, a review's subject too, and no more", () => {
    const every = ["*", ...new Set(EVENT_TYPES.map((type) => `${EVENT_CATALOGUE[type].subject}.*`)), ...EVENT_TYPES];
    expect(every).toContain("review.*");
    expect(every.every(isSubscriptionPattern)).toBe(true);
    expect(SUBSCRIPTION_PATTERNS_MAX).toBe(every.length);
    expect(subscribesTo(["review.*"], "review.submitted")).toBe(true);
    expect(subscribesTo(["order.*"], "review.submitted")).toBe(false);
  });

  it("names a type exactly, a whole subject, or everything", () => {
    expect(subscribesTo(["order.confirmed"], "order.confirmed")).toBe(true);
    expect(subscribesTo(["order.confirmed"], "order.cancelled")).toBe(false);
    expect(subscribesTo(["order.*"], "order.cancelled")).toBe(true);
    expect(subscribesTo(["order.*"], "shipment.delivered")).toBe(false);
    expect(subscribesTo(["shipment.*", "order.created"], "order.created")).toBe(true);
    for (const type of EVENT_TYPES) expect(subscribesTo(["*"], type)).toBe(true);
    expect(subscribesTo([], "order.created")).toBe(false);
  });

  it("knows only patterns the catalogue can match", () => {
    for (const valid of ["*", "order.*", "shipment.*", "order.line_returned", "shipment.delivery_failed"]) expect(isSubscriptionPattern(valid)).toBe(true);
    for (const invalid of ["order", "orders.*", "order.shipped", "*.*", "order.*.x", "", 3, null]) expect(isSubscriptionPattern(invalid)).toBe(false);
  });

  it("reads what a Consumer stored, and never reads a broken value as everything", () => {
    expect(readSubscription('["order.*","shipment.delivered"]')).toEqual(["order.*", "shipment.delivered"]);
    expect(readSubscription('["order.*","nonsense"]')).toEqual(["order.*"]);
    expect(readSubscription("not json")).toEqual([]);
    expect(readSubscription('"*"')).toEqual([]);
    expect(readSubscription("{}")).toEqual([]);
  });
});
