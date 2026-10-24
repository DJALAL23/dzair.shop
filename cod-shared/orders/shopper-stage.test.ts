import { describe, expect, it } from "vitest";
import { ORDER_STAGES } from "./stage";
import { SHOPPER_ORDER_STAGES, shopperOrderStage } from "./shopper-stage";

describe("shopperOrderStage", () => {
  it.each([
    ["new", "placed"],
    ["unreachable", "placed"],
    ["confirmed", "confirmed"],
    ["preparing", "preparing"],
    ["ready_to_ship", "preparing"],
    ["handoff_pending", "preparing"],
    ["delivery_cancelled", "preparing"],
    ["in_transit", "shipped"],
    ["out_for_delivery", "out_for_delivery"],
    ["delivered", "delivered"],
    ["returning", "returned"],
    ["returned", "returned"],
    ["cancelled", "cancelled"],
  ] as const)("%s reads as %s", (stage, shopper) => {
    expect(shopperOrderStage(stage)).toBe(shopper);
  });

  it("words every merchant stage, and every shopper stage is reachable", () => {
    const reached = new Set(ORDER_STAGES.map(shopperOrderStage));
    expect([...reached].sort()).toEqual([...SHOPPER_ORDER_STAGES].sort());
  });
});
