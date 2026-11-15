import { describe, expect, it } from "vitest";
import { communesOf } from "../places";
import { customerPrice, profileFromRates, type CarrierPlaceRate } from "./profile-from-rates";

const EXACT = { add: 0, roundTo: 0 } as const;
const place = (communeId: string, homeRate: number | null, stopDeskRate: number | null = null, home = true): CarrierPlaceRate => ({ communeId, home, homeRate, stopDeskRate });
const blida = communesOf(9).map((c) => c.id);
const alger = communesOf(16).map((c) => c.id);

describe("customerPrice", () => {
  it("is the carrier's price, plus the merchant's amount, rounded up when asked", () => {
    expect(customerPrice(470, EXACT)).toBe(470);
    expect(customerPrice(470, { add: 100, roundTo: 0 })).toBe(570);
    expect(customerPrice(470, { add: 0, roundTo: 50 })).toBe(500);
    expect(customerPrice(500, { add: 0, roundTo: 50 })).toBe(500);
    expect(customerPrice(470, { add: 100, roundTo: 100 })).toBe(600);
    expect(customerPrice(461, { add: 0, roundTo: 10 })).toBe(470);
  });
});

describe("profileFromRates", () => {
  it("makes one wilaya price and no commune prices from a carrier that prices per wilaya", () => {
    const { rules, communes } = profileFromRates(blida.map((id) => place(id, 500, 350)), EXACT);
    expect(rules).toEqual([{ wilayaId: 9, homePrice: 500, stopDeskPrice: 350, homeEnabled: true, stopDeskEnabled: true }]);
    expect(communes.get(9)).toEqual([]);
  });

  it("takes a per-commune carrier's most common price, and gives the others their own", () => {
    const [a, b, c] = alger;
    const { rules, communes } = profileFromRates([...alger.map((id) => place(id, 400, 300)), place(a!, 600, 300), place(b!, 400, 250)], EXACT);
    expect(rules[0]).toMatchObject({ wilayaId: 16, homePrice: 400, stopDeskPrice: 300 });
    const own = communes.get(16)!;
    expect(own).toContainEqual({ communeId: a, homeEnabled: null, homePrice: 600, stopDeskEnabled: null, stopDeskPrice: null });
    expect(own).toContainEqual({ communeId: b, homeEnabled: null, homePrice: null, stopDeskEnabled: null, stopDeskPrice: 250 });
    expect(own.find((o) => o.communeId === c)).toBeUndefined();
  });

  it("turns home delivery off where the carrier does not reach the door, or is not on its map", () => {
    const [missing, noDoor, ...rest] = alger;
    const { communes } = profileFromRates([place(noDoor!, 400, 300, false), ...rest.map((id) => place(id, 400, 300))], EXACT);
    const own = communes.get(16)!;
    expect(own).toContainEqual({ communeId: missing, homeEnabled: false, homePrice: null, stopDeskEnabled: null, stopDeskPrice: null });
    expect(own).toContainEqual({ communeId: noDoor, homeEnabled: false, homePrice: null, stopDeskEnabled: null, stopDeskPrice: null });
    expect(own).toHaveLength(2);
  });

  it("offers stop desk alone where the carrier only prices desks, without turning communes off", () => {
    const { rules, communes } = profileFromRates([place(blida[0]!, null, 350)], EXACT);
    expect(rules).toEqual([{ wilayaId: 9, homePrice: 0, stopDeskPrice: 350, homeEnabled: false, stopDeskEnabled: true }]);
    expect(communes.get(9)).toEqual([]);
  });

  it("leaves out a wilaya the carrier gives no price for, and a commune it does not know", () => {
    const { rules } = profileFromRates([...blida.map((id) => place(id, null, null)), place("no-such-commune", 500)], EXACT);
    expect(rules).toEqual([]);
  });

  it("applies the merchant's amount and rounding to every price, wilaya and commune", () => {
    const [a] = alger;
    const { rules, communes } = profileFromRates([...alger.map((id) => place(id, 420, 310)), place(a!, 610, 310)], { add: 100, roundTo: 50 });
    expect(rules[0]).toMatchObject({ homePrice: 550, stopDeskPrice: 450 });
    expect(communes.get(16)).toContainEqual({ communeId: a, homeEnabled: null, homePrice: 750, stopDeskEnabled: null, stopDeskPrice: null });
  });

  it("gives the same profile for the same map, taking the lower price on a tie", () => {
    const [a, b] = blida;
    const plan = profileFromRates([place(a!, 600), place(b!, 500)], EXACT);
    expect(plan.rules[0]!.homePrice).toBe(500);
    expect(profileFromRates([place(b!, 500), place(a!, 600)], EXACT)).toEqual(plan);
  });

  it("lists wilayas in order", () => {
    const { rules } = profileFromRates([place(alger[0]!, 400), place(blida[0]!, 500)], EXACT);
    expect(rules.map((r) => r.wilayaId)).toEqual([9, 16]);
  });
});
