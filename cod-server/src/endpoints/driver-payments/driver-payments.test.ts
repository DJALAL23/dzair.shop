/**
 * Driver payments — the request schema. What a payment does runs against
 * real D1 in settlement.e2e.test.ts.
 */

import { describe, it, expect } from "vitest";
import { createPaymentSchema } from "./validation";

describe("createPaymentSchema", () => {
  const validBase = { driverId: "drv_1", type: "cod_remittance" as const, shipmentIds: ["shp_1", "shp_2"] };
  const accepts = (body: unknown) => createPaymentSchema.safeParse(body).success;

  it("accepts a payment of shipments, with or without notes, of every type", () => {
    expect(accepts(validBase)).toBe(true);
    expect(accepts({ ...validBase, notes: "Remise du soir" })).toBe(true);
    for (const type of ["cod_remittance", "fee_payment", "net_settlement"]) expect(accepts({ ...validBase, type })).toBe(true);
  });

  it("refuses a missing driver or type, or an unknown type", () => {
    expect(accepts({ ...validBase, driverId: "" })).toBe(false);
    const { type: _, ...untyped } = validBase;
    expect(accepts(untyped)).toBe(false);
    expect(accepts({ ...validBase, type: "refund" })).toBe(false);
  });

  it("refuses no shipments, an empty id, a shipment listed twice, or more than 500", () => {
    expect(accepts({ ...validBase, shipmentIds: [] })).toBe(false);
    expect(accepts({ ...validBase, shipmentIds: ["shp_1", ""] })).toBe(false);
    expect(accepts({ ...validBase, shipmentIds: ["shp_1", "shp_1"] })).toBe(false);
    expect(accepts({ ...validBase, shipmentIds: Array.from({ length: 501 }, (_, i) => `shp_${i}`) })).toBe(false);
    expect(accepts({ ...validBase, shipmentIds: Array.from({ length: 500 }, (_, i) => `shp_${i}`) })).toBe(true);
  });

  it("no longer takes order ids", () => {
    expect(accepts({ driverId: "drv_1", type: "cod_remittance", orderIds: ["ord_1"] })).toBe(false);
  });
});
