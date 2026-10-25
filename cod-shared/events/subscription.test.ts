import { describe, expect, it } from "vitest";
import { EVENT_TYPES } from "./catalogue";
import { isSubscriptionPattern, readSubscription, subscribesTo } from "./subscription";

describe("a Subscription", () => {
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
