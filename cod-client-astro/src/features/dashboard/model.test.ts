import { describe, expect, it } from "vitest";
import { deliverySuccessRate, queueBreakdown, summarizeActivity } from "./model";

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
    archived: 0,
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
    expect(queueBreakdown({ stages: [], needsAttention: 0, archived: 0 }).every((queue) => queue.count === 0 && queue.share === 0)).toBe(true);
  });

  it("measures delivery success over the parcels that reached their customer", () => {
    expect(deliverySuccessRate(counts)).toBe(75);
    expect(deliverySuccessRate({ stages: [{ stage: "in_transit", count: 4 }], needsAttention: 0, archived: 0 })).toBeNull();
  });

  it("fills every day of the window and compares it with the window before", () => {
    const summary = summarizeActivity({
      from: "2026-10-14",
      to: "2026-10-16",
      days: [
        { date: "2026-10-14", orders: 2, sales: 3000 },
        { date: "2026-10-16", orders: 1, sales: 3000 },
      ],
      previous: { orders: 4, sales: 4000 },
    });
    expect(summary.days.map((day) => [day.date, day.orders])).toEqual([
      ["2026-10-14", 2],
      ["2026-10-15", 0],
      ["2026-10-16", 1],
    ]);
    expect(summary).toMatchObject({ orders: 3, sales: 6000, average: 2000, change: { orders: -25, sales: 50, average: 100 } });
  });

  it("gives no change against an empty window, and no average without orders", () => {
    const summary = summarizeActivity({ from: "2026-10-16", to: "2026-10-16", days: [], previous: { orders: 0, sales: 0 } });
    expect(summary).toMatchObject({ days: [{ date: "2026-10-16", orders: 0, sales: 0 }], orders: 0, average: null, change: { orders: null, sales: null, average: null } });
  });
});
