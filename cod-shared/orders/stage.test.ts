import { describe, it, expect } from "vitest";
import { orderNeedsAttention, orderStage, type StageShipment } from "./stage";

const T = "2026-10-01T10:00:00.000Z";

const shipment = (over: Partial<StageShipment> = {}): StageShipment => ({
  handoffState: "accepted",
  outForDeliveryAt: null,
  deliveredAt: null,
  returnStartedAt: null,
  returnedAt: null,
  cancelledAt: null,
  attentionSince: null,
  ...over,
});

describe("orderStage — before handoff the processing status speaks", () => {
  it.each([
    ["new", "new"],
    ["confirmed", "confirmed"],
    ["unreachable", "unreachable"],
    ["preparing", "preparing"],
    ["ready", "ready_to_ship"],
    ["cancelled", "cancelled"],
  ] as const)("%s → %s", (status, stage) => {
    expect(orderStage(status, null)).toBe(stage);
  });
});

describe("orderStage — after handoff the shipment speaks", () => {
  it.each([
    ["submitting", "handoff_pending"],
    ["unknown", "handoff_pending"],
  ] as const)("a %s handoff is pending", (handoffState, stage) => {
    expect(orderStage("ready", shipment({ handoffState }))).toBe(stage);
  });

  it.each([
    ["in_transit", {}],
    ["out_for_delivery", { outForDeliveryAt: T }],
    ["returning", { outForDeliveryAt: T, returnStartedAt: T }],
    ["delivered", { outForDeliveryAt: T, deliveredAt: T }],
    ["delivered", { outForDeliveryAt: T, returnStartedAt: T, deliveredAt: T }],
    ["returned", { returnStartedAt: T, returnedAt: T }],
    ["returned", { returnedAt: T }],
    ["delivery_cancelled", { cancelledAt: T }],
  ] as const)("%s", (stage, facts) => {
    expect(orderStage("ready", shipment(facts))).toBe(stage);
  });

  it("a pending handoff outranks anything recorded", () => {
    expect(orderStage("ready", shipment({ handoffState: "unknown", deliveredAt: T }))).toBe("handoff_pending");
  });
});

describe("orderNeedsAttention", () => {
  it("is false without a shipment or for a quiet one", () => {
    expect(orderNeedsAttention(null)).toBe(false);
    expect(orderNeedsAttention(shipment())).toBe(false);
    expect(orderNeedsAttention(shipment({ handoffState: "submitting" }))).toBe(false);
  });

  it("is true when the carrier flagged the parcel", () => {
    expect(orderNeedsAttention(shipment({ attentionSince: T }))).toBe(true);
  });

  it("is true when the handoff outcome is unknown", () => {
    expect(orderNeedsAttention(shipment({ handoffState: "unknown" }))).toBe(true);
  });

  it("is true when the carrier cancelled and the merchant must decide", () => {
    expect(orderNeedsAttention(shipment({ cancelledAt: T }))).toBe(true);
  });
});
