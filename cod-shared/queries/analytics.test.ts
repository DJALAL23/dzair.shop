import { describe, expect, it } from "vitest";
import { deliveryRate } from "./analytics";

describe("deliveryRate", () => {
  it("is the share delivered of the parcels whose delivery ended", () => {
    expect(deliveryRate([{ stage: "delivered", count: 3 }, { stage: "returned", count: 1 }])).toBe(75);
  });

  it("leaves out a return under way and a parcel the carrier cancelled", () => {
    expect(
      deliveryRate([
        { stage: "delivered", count: 1 },
        { stage: "returned", count: 1 },
        { stage: "returning", count: 5 },
        { stage: "delivery_cancelled", count: 5 },
        { stage: "in_transit", count: 5 },
      ]),
    ).toBe(50);
  });

  it("is null before any delivery ended", () => {
    expect(deliveryRate([{ stage: "returning", count: 2 }, { stage: "out_for_delivery", count: 1 }])).toBeNull();
    expect(deliveryRate([])).toBeNull();
  });

  it("rounds to a whole percent", () => {
    expect(deliveryRate([{ stage: "delivered", count: 2 }, { stage: "returned", count: 1 }])).toBe(67);
  });
});
