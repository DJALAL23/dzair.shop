import { describe, it, expect } from "vitest";
import {
  ORDER_STATUSES,
  allowedTransitions,
  checkDeliveryDetailsEdit,
  checkHandoff,
  checkTransition,
  isOrderStatus,
  type OrderStatus,
} from "./lifecycle";

// The table the business agreed on, written independently of the module so a
// change to the module's table has to be a deliberate change here too.
const EXPECTED: ReadonlyArray<[OrderStatus, OrderStatus]> = [
  ["new", "confirmed"],
  ["new", "unreachable"],
  ["new", "cancelled"],
  ["confirmed", "preparing"],
  ["confirmed", "ready"],
  ["confirmed", "unreachable"],
  ["confirmed", "cancelled"],
  ["unreachable", "confirmed"],
  ["unreachable", "cancelled"],
  ["preparing", "ready"],
  ["preparing", "cancelled"],
  ["ready", "cancelled"],
];

const allowed = (from: OrderStatus, to: OrderStatus) =>
  EXPECTED.some(([f, t]) => f === from && t === to);

describe("order lifecycle — every pair of statuses", () => {
  for (const from of ORDER_STATUSES) {
    for (const to of ORDER_STATUSES) {
      const expected = allowed(from, to);
      it(`${from} → ${to} is ${expected ? "allowed" : "refused"}`, () => {
        const verdict = checkTransition({ status: from, hasShipment: false }, to);
        expect(verdict.ok).toBe(expected);
        if (!verdict.ok) {
          expect(verdict).toMatchObject({ code: "INVALID_STATUS_TRANSITION", from, to });
        }
      });
    }
  }

  it("lists exactly the allowed moves", () => {
    for (const from of ORDER_STATUSES) {
      const expected = EXPECTED.filter(([f]) => f === from).map(([, t]) => t);
      expect([...allowedTransitions({ status: from, hasShipment: false })].sort()).toEqual(expected.sort());
    }
  });

  it("explains a refusal with what is allowed instead", () => {
    expect(checkTransition({ status: "new", hasShipment: false }, "ready")).toEqual({
      ok: false,
      code: "INVALID_STATUS_TRANSITION",
      from: "new",
      to: "ready",
      allowed: ["confirmed", "unreachable", "cancelled"],
    });
  });
});

describe("order lifecycle — an order with a shipment is finished processing", () => {
  it.each(ORDER_STATUSES)("refuses every move from %s once a shipment exists", (from) => {
    for (const to of ORDER_STATUSES) {
      expect(checkTransition({ status: from, hasShipment: true }, to)).toEqual({
        ok: false,
        code: "ORDER_HAS_SHIPMENT",
      });
    }
    expect(allowedTransitions({ status: from, hasShipment: true })).toEqual([]);
  });

  it("cannot be cancelled until its shipment is voided", () => {
    expect(checkTransition({ status: "ready", hasShipment: true }, "cancelled").ok).toBe(false);
    expect(checkTransition({ status: "ready", hasShipment: false }, "cancelled").ok).toBe(true);
  });
});

describe("handoff", () => {
  it("is allowed only for a ready order without a shipment", () => {
    for (const status of ORDER_STATUSES) {
      expect(checkHandoff({ status, hasShipment: false }).ok).toBe(status === "ready");
    }
  });

  it("names the status that blocks it", () => {
    expect(checkHandoff({ status: "unreachable", hasShipment: false })).toEqual({
      ok: false,
      code: "ORDER_NOT_READY_FOR_HANDOFF",
      status: "unreachable",
    });
  });

  it("refuses a second shipment", () => {
    expect(checkHandoff({ status: "ready", hasShipment: true })).toEqual({
      ok: false,
      code: "ORDER_HAS_SHIPMENT",
    });
  });
});

describe("delivery details", () => {
  it("are editable until handoff and locked after it", () => {
    for (const status of ORDER_STATUSES) {
      expect(checkDeliveryDetailsEdit({ status, hasShipment: false }).ok).toBe(true);
      expect(checkDeliveryDetailsEdit({ status, hasShipment: true }).ok).toBe(false);
    }
  });
});

describe("isOrderStatus", () => {
  it("accepts processing statuses only — delivery words are not order statuses", () => {
    for (const status of ORDER_STATUSES) expect(isOrderStatus(status)).toBe(true);
    for (const legacy of ["assigned", "dispatched", "out_for_delivery", "delivered", "returned", "", null, 3]) {
      expect(isOrderStatus(legacy)).toBe(false);
    }
  });
});
