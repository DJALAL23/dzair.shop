import { describe, expect, it } from "vitest";
import { EVENT_CATALOGUE, EVENT_TYPES } from "../../../cod-shared/events/catalogue";
import { BUSINESS_EVENT_SCHEMA } from "./catalogue";
import { exampleEvent } from "./examples";

describe("the examples", () => {
  it.each(EVENT_TYPES)("%s is published exactly as its schema says, nothing more", (type) => {
    const example = exampleEvent(type);
    expect(BUSINESS_EVENT_SCHEMA.parse(example)).toEqual(example);
    expect(example.type).toBe(type);
    expect(example.subject.type).toBe(EVENT_CATALOGUE[type].subject);
    expect(example.recordedAt >= example.occurredAt).toBe(true);
  });

  it("each have their own id and Sequence", () => {
    const events = EVENT_TYPES.map(exampleEvent);
    expect(new Set(events.map((e) => e.id)).size).toBe(EVENT_TYPES.length);
    expect(new Set(events.map((e) => e.sequence)).size).toBe(EVENT_TYPES.length);
    for (const event of events) expect(event.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("carry the order status each event leaves it in", () => {
    expect(exampleEvent("order.created").data.order.status).toBe("new");
    for (const type of ["order.confirmed", "order.unreachable", "order.preparing", "order.ready", "order.cancelled"] as const) {
      const event = exampleEvent(type);
      expect(event.data.order.status).toBe(type.slice("order.".length));
      expect(event.data.previousStatus).not.toBe(event.data.order.status);
    }
    expect(exampleEvent("shipment.delivered").data.shipment.deliveredAt).toBe(exampleEvent("shipment.delivered").occurredAt);
  });
});
