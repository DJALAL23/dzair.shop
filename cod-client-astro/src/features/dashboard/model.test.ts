import { describe, expect, it } from "vitest";
import { deliverySuccessRate, queueBreakdown } from "./model";

const counts = {
  stages: [
    { stage: "new" as const, count: 2 },
    { stage: "unreachable" as const, count: 1 },
    { stage: "in_transit" as const, count: 3 },
    { stage: "delivered" as const, count: 6 },
    { stage: "returned" as const, count: 1 },
    { stage: "returning" as const, count: 1 },
  ],
  needsAttention: 1,
};

describe("the overview", () => {
  it("shows every work queue with its orders and its share, in the order of the day", () => {
    expect(queueBreakdown(counts)).toEqual([
      { key: "to_confirm", count: 3, share: 21 },
      { key: "to_prepare", count: 0, share: 0 },
      { key: "to_ship", count: 0, share: 0 },
      { key: "on_the_way", count: 3, share: 21 },
      { key: "delivered", count: 6, share: 43 },
      { key: "returns", count: 2, share: 14 },
      { key: "cancelled", count: 0, share: 0 },
    ]);
    expect(queueBreakdown({ stages: [], needsAttention: 0 }).every((queue) => queue.count === 0 && queue.share === 0)).toBe(true);
  });

  it("measures delivery success over the parcels that reached their customer", () => {
    expect(deliverySuccessRate(counts)).toBe(75);
    expect(deliverySuccessRate({ stages: [{ stage: "in_transit", count: 4 }], needsAttention: 0 })).toBeNull();
  });
});
