import { describe, it, expect } from "vitest";
import { EMPTY_DELIVERY_FACTS, type DeliveryFacts } from "./interpretation";
import {
  DRIVER_STATUSES,
  checkMerchantReport,
  interpretMerchantReport,
  isMerchantReport,
  reportsAllowedFor,
  type ReportTarget,
} from "./merchant-reports";

const T = "2026-10-01T10:00:00.000Z";
const target = (over: Partial<ReportTarget> = {}, delivery: Partial<DeliveryFacts> = {}): ReportTarget => ({
  kind: "driver",
  handoffState: "accepted",
  delivery: { ...EMPTY_DELIVERY_FACTS, ...delivery },
  ...over,
});

describe("what a merchant may report", () => {
  it("reports every driver step for a driver", () => {
    for (const report of DRIVER_STATUSES) {
      expect(checkMerchantReport(target(), report)).toEqual({ ok: true });
    }
  });

  it("only attests a return for a carrier — never a delivery", () => {
    expect(reportsAllowedFor("carrier")).toEqual(["returned"]);
    expect(checkMerchantReport(target({ kind: "carrier" }), "returned")).toEqual({ ok: true });
    for (const report of ["delivered", "out_for_delivery", "failed_attempt"] as const) {
      expect(checkMerchantReport(target({ kind: "carrier" }), report)).toEqual({
        ok: false,
        code: "SHIPMENT_REPORT_NOT_ALLOWED",
      });
    }
  });

  it("refuses reports on a closed shipment", () => {
    for (const closed of [{ deliveredAt: T }, { returnedAt: T }, { cancelledAt: T }]) {
      expect(checkMerchantReport(target({}, closed), "returned")).toEqual({ ok: false, code: "SHIPMENT_CLOSED" });
    }
  });

  it("refuses reports while the handoff is not accepted", () => {
    for (const handoffState of ["submitting", "unknown"] as const) {
      expect(checkMerchantReport(target({ kind: "carrier", handoffState }), "returned")).toEqual({
        ok: false,
        code: "SHIPMENT_HANDOFF_PENDING",
      });
    }
  });
});

describe("interpretMerchantReport", () => {
  it("speaks the same language as the carriers", () => {
    expect(interpretMerchantReport("out_for_delivery")).toEqual({ kind: "milestone", milestone: "out_for_delivery" });
    expect(interpretMerchantReport("failed_attempt")).toEqual({ kind: "failed_attempt" });
    expect(interpretMerchantReport("delivered")).toEqual({ kind: "milestone", milestone: "delivered" });
    expect(interpretMerchantReport("returned")).toEqual({ kind: "milestone", milestone: "returned" });
  });

  it("rejects anything outside the vocabulary", () => {
    for (const bad of ["cancelled", "return_started", "Livré", "", null]) expect(isMerchantReport(bad)).toBe(false);
  });
});
