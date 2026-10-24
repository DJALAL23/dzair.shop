/**
 * What can be done to a shipment now — every rule, including the ones that
 * must refuse. The capability sets are the real adapters' declarations.
 */
import { describe, it, expect } from "vitest";
import { EMPTY_DELIVERY_FACTS, type DeliveryFacts } from "../../../../cod-shared/shipments/interpretation";
import { ECOTRACK_CAPABILITIES } from "@/carriers/ecotrack/adapter";
import { NOEST_CAPABILITIES } from "@/carriers/noest/adapter";
import { YALIDINE_CAPABILITIES } from "@/carriers/yalidine/adapter";
import { ZR_CAPABILITIES } from "@/carriers/zr_express/adapter";
import type { CarrierCapabilities } from "@/carriers/contract";
import { SHIPMENT_ACTIONS } from "../../../../cod-shared/shipments/actions";
import { availableActions, checkAction, type ShipmentAction, type ShipmentSubject } from "./actions";

const AT = "2026-10-14T09:00:00.000Z";

const carrier = (over: Partial<ShipmentSubject> = {}, delivery: Partial<DeliveryFacts> = {}): ShipmentSubject => ({
  kind: "carrier",
  handoffState: "accepted",
  validatedAt: null,
  ...over,
  delivery: { ...EMPTY_DELIVERY_FACTS, ...delivery },
});
const driver = (delivery: Partial<DeliveryFacts> = {}): ShipmentSubject => ({ kind: "driver", handoffState: "accepted", validatedAt: AT, delivery: { ...EMPTY_DELIVERY_FACTS, ...delivery } });

const code = (subject: ShipmentSubject, caps: CarrierCapabilities | null, action: ShipmentAction) => {
  const verdict = checkAction(subject, caps, action);
  return verdict.ok ? "ok" : verdict.code;
};

describe("a parcel that is not accepted yet has nothing to act on", () => {
  it.each(SHIPMENT_ACTIONS.filter((a) => a !== "resolve" && a !== "lookup"))("%s waits for the carrier", (action) => {
    for (const handoffState of ["submitting", "unknown"] as const) {
      expect(code(carrier({ handoffState }), ECOTRACK_CAPABILITIES, action)).toBe("SHIPMENT_HANDOFF_PENDING");
    }
  });

  it("only an unknown outcome is resolved; lookup also needs a carrier that searches by order number", () => {
    expect(code(carrier({ handoffState: "unknown" }), ZR_CAPABILITIES, "resolve")).toBe("ok");
    expect(code(carrier({ handoffState: "unknown" }), ECOTRACK_CAPABILITIES, "lookup")).toBe("ok");
    expect(code(carrier({ handoffState: "unknown" }), ZR_CAPABILITIES, "lookup")).toBe("OPERATION_NOT_SUPPORTED");
    for (const handoffState of ["submitting", "accepted"] as const) {
      expect(code(carrier({ handoffState }), ECOTRACK_CAPABILITIES, "resolve")).toBe("SHIPMENT_ACTION_NOT_AVAILABLE");
      expect(code(carrier({ handoffState }), ECOTRACK_CAPABILITIES, "lookup")).toBe("SHIPMENT_ACTION_NOT_AVAILABLE");
    }
  });

  it("an unknown outcome offers resolving and nothing else", () => {
    expect(availableActions(carrier({ handoffState: "unknown" }), ECOTRACK_CAPABILITIES)).toEqual(["resolve", "lookup"]);
    expect(availableActions(carrier({ handoffState: "submitting" }), ECOTRACK_CAPABILITIES)).toEqual([]);
  });
});

describe("validating", () => {
  it("only for a carrier that validates separately, once", () => {
    expect(code(carrier(), ECOTRACK_CAPABILITIES, "validate")).toBe("ok");
    expect(code(carrier(), YALIDINE_CAPABILITIES, "validate")).toBe("OPERATION_NOT_SUPPORTED");
    expect(code(carrier({ validatedAt: AT }), ECOTRACK_CAPABILITIES, "validate")).toBe("SHIPMENT_ACTION_NOT_AVAILABLE");
    expect(code(carrier({}, { cancelledAt: AT }), ECOTRACK_CAPABILITIES, "validate")).toBe("SHIPMENT_CLOSED");
  });
});

describe("editing the parcel", () => {
  it("before it leaves: a separately validated carrier stops accepting changes at validation", () => {
    expect(code(carrier(), ECOTRACK_CAPABILITIES, "update")).toBe("ok");
    expect(code(carrier({ validatedAt: AT }), ECOTRACK_CAPABILITIES, "update")).toBe("SHIPMENT_ACTION_NOT_AVAILABLE");
    expect(code(carrier({ validatedAt: AT }), NOEST_CAPABILITIES, "update")).toBe("SHIPMENT_ACTION_NOT_AVAILABLE");
    expect(code(carrier({ validatedAt: AT }), YALIDINE_CAPABILITIES, "update")).toBe("ok");
  });

  it("never once it is on its way or closed", () => {
    expect(code(carrier({ validatedAt: AT }, { outForDeliveryAt: AT }), YALIDINE_CAPABILITIES, "update")).toBe("SHIPMENT_ACTION_NOT_AVAILABLE");
    expect(code(carrier({ validatedAt: AT }, { returnStartedAt: AT }), YALIDINE_CAPABILITIES, "update")).toBe("SHIPMENT_ACTION_NOT_AVAILABLE");
    expect(code(carrier({ validatedAt: AT }, { cancelledAt: AT }), YALIDINE_CAPABILITIES, "update")).toBe("SHIPMENT_CLOSED");
  });

  it("not for a driver", () => {
    expect(code(driver(), null, "update")).toBe("OPERATION_NOT_SUPPORTED");
  });
});

describe("voiding", () => {
  it("a carrier parcel is cancelled at the carrier first, while the carrier still allows it", () => {
    expect(code(carrier(), ECOTRACK_CAPABILITIES, "void")).toBe("ok");
    expect(code(carrier({ validatedAt: AT }), ECOTRACK_CAPABILITIES, "void")).toBe("SHIPMENT_ACTION_NOT_AVAILABLE");
    expect(code(carrier({ validatedAt: AT }), YALIDINE_CAPABILITIES, "void")).toBe("ok");
    expect(code(carrier(), { ...YALIDINE_CAPABILITIES, cancel: false }, "void")).toBe("OPERATION_NOT_SUPPORTED");
  });

  it("a parcel the carrier already cancelled is released without asking it", () => {
    expect(code(carrier({ validatedAt: AT }, { cancelledAt: AT }), { ...ECOTRACK_CAPABILITIES, cancel: false }, "void")).toBe("ok");
  });

  it("never once it reached the customer's side", () => {
    expect(code(carrier({}, { outForDeliveryAt: AT }), YALIDINE_CAPABILITIES, "void")).toBe("SHIPMENT_NOT_VOIDABLE");
    expect(code(carrier({}, { returnStartedAt: AT }), YALIDINE_CAPABILITIES, "void")).toBe("SHIPMENT_NOT_VOIDABLE");
    expect(code(carrier({}, { deliveredAt: AT }), YALIDINE_CAPABILITIES, "void")).toBe("SHIPMENT_CLOSED");
    expect(code(driver({ outForDeliveryAt: AT }), null, "void")).toBe("SHIPMENT_NOT_VOIDABLE");
  });

  it("a driver's shipment is voided with no carrier to ask", () => {
    expect(code(driver(), null, "void")).toBe("ok");
  });
});

describe("the parcel's life with the carrier", () => {
  it("a return is asked once the carrier has the parcel, and only until it starts", () => {
    expect(code(carrier(), ECOTRACK_CAPABILITIES, "askReturn")).toBe("SHIPMENT_ACTION_NOT_AVAILABLE");
    expect(code(carrier({ validatedAt: AT }), ECOTRACK_CAPABILITIES, "askReturn")).toBe("ok");
    expect(code(carrier({ validatedAt: AT }, { returnStartedAt: AT }), ECOTRACK_CAPABILITIES, "askReturn")).toBe("SHIPMENT_ACTION_NOT_AVAILABLE");
    expect(code(carrier({ validatedAt: AT }, { deliveredAt: AT }), ECOTRACK_CAPABILITIES, "askReturn")).toBe("SHIPMENT_CLOSED");
    expect(code(carrier({ validatedAt: AT }), YALIDINE_CAPABILITIES, "askReturn")).toBe("OPERATION_NOT_SUPPORTED");
  });

  it("another attempt is asked only after a failed one, before a return", () => {
    expect(code(carrier({ validatedAt: AT }), NOEST_CAPABILITIES, "requestNewAttempt")).toBe("SHIPMENT_ACTION_NOT_AVAILABLE");
    expect(code(carrier({ validatedAt: AT }, { deliveryAttempts: 1 }), NOEST_CAPABILITIES, "requestNewAttempt")).toBe("ok");
    expect(code(carrier({ validatedAt: AT }, { deliveryAttempts: 1, returnStartedAt: AT }), NOEST_CAPABILITIES, "requestNewAttempt")).toBe("SHIPMENT_ACTION_NOT_AVAILABLE");
    expect(code(carrier({ validatedAt: AT }, { deliveryAttempts: 1 }), ECOTRACK_CAPABILITIES, "requestNewAttempt")).toBe("OPERATION_NOT_SUPPORTED");
  });

  it("a return is confirmed at the carrier while the parcel is open", () => {
    expect(code(carrier({ validatedAt: AT }, { returnStartedAt: AT }), ECOTRACK_CAPABILITIES, "confirmReturn")).toBe("ok");
    expect(code(carrier(), ECOTRACK_CAPABILITIES, "confirmReturn")).toBe("SHIPMENT_ACTION_NOT_AVAILABLE");
    expect(code(carrier({ validatedAt: AT }, { returnedAt: AT }), ECOTRACK_CAPABILITIES, "confirmReturn")).toBe("SHIPMENT_CLOSED");
    expect(code(carrier({ validatedAt: AT }), NOEST_CAPABILITIES, "confirmReturn")).toBe("OPERATION_NOT_SUPPORTED");
  });

  it("remarks: added while open, read any time; a label until cancelled; history any time", () => {
    expect(code(carrier(), ECOTRACK_CAPABILITIES, "addRemark")).toBe("ok");
    expect(code(carrier({}, { deliveredAt: AT }), ECOTRACK_CAPABILITIES, "addRemark")).toBe("SHIPMENT_CLOSED");
    expect(code(carrier({}, { deliveredAt: AT }), ECOTRACK_CAPABILITIES, "listRemarks")).toBe("ok");
    expect(code(carrier(), NOEST_CAPABILITIES, "listRemarks")).toBe("OPERATION_NOT_SUPPORTED");
    expect(code(carrier(), YALIDINE_CAPABILITIES, "addRemark")).toBe("OPERATION_NOT_SUPPORTED");
    expect(code(carrier({}, { deliveredAt: AT }), YALIDINE_CAPABILITIES, "label")).toBe("ok");
    expect(code(carrier({}, { cancelledAt: AT }), YALIDINE_CAPABILITIES, "label")).toBe("SHIPMENT_ACTION_NOT_AVAILABLE");
    expect(code(carrier({}, { returnedAt: AT }), ZR_CAPABILITIES, "sync")).toBe("ok");
    expect(code(carrier(), { ...ZR_CAPABILITIES, history: false }, "sync")).toBe("OPERATION_NOT_SUPPORTED");
  });

  it("a merchant reports on an open shipment only", () => {
    expect(code(carrier(), ECOTRACK_CAPABILITIES, "report")).toBe("ok");
    expect(code(driver(), null, "report")).toBe("ok");
    expect(code(driver({ deliveredAt: AT }), null, "report")).toBe("SHIPMENT_CLOSED");
  });
});

describe("a driver has no carrier", () => {
  it.each(["validate", "update", "resolve", "lookup", "addRemark", "listRemarks", "askReturn", "requestNewAttempt", "confirmReturn", "sync"] as const)("%s", (action) => {
    expect(code(driver(), null, action)).toBe("OPERATION_NOT_SUPPORTED");
  });

  it("even if carrier capabilities were passed for it", () => {
    for (const action of ["validate", "update", "sync", "askReturn"] as const) {
      expect(code(driver(), ECOTRACK_CAPABILITIES, action)).toBe("OPERATION_NOT_SUPPORTED");
    }
  });

  it("has CodFlow's label while the parcel is out, and none once it is closed", () => {
    expect(code(driver(), null, "label")).toBe("ok");
    expect(code(driver({ deliveredAt: AT }), null, "label")).toBe("SHIPMENT_CLOSED");
    expect(code(driver({ returnedAt: AT }), null, "label")).toBe("SHIPMENT_CLOSED");
  });

  it("offers voiding, its label and reporting", () => {
    expect(availableActions(driver(), null)).toEqual(["void", "label", "report"]);
  });

  it("a carrier shipment whose company lost its adapter offers nothing that needs the carrier", () => {
    expect(availableActions(carrier(), null)).toEqual(["report"]);
  });
});

describe("what is offered is exactly what is allowed", () => {
  const subjects = [
    carrier(),
    carrier({ validatedAt: AT }),
    carrier({ validatedAt: AT }, { outForDeliveryAt: AT, deliveryAttempts: 2 }),
    carrier({ validatedAt: AT }, { returnStartedAt: AT }),
    carrier({ validatedAt: AT }, { deliveredAt: AT }),
    carrier({ handoffState: "unknown" }),
    driver(),
  ];
  const capabilitySets = [ECOTRACK_CAPABILITIES, NOEST_CAPABILITIES, YALIDINE_CAPABILITIES, ZR_CAPABILITIES];

  it("for every carrier and state", () => {
    for (const subject of subjects) {
      for (const caps of subject.kind === "driver" ? [null] : capabilitySets) {
        const offered = availableActions(subject, caps);
        for (const action of SHIPMENT_ACTIONS) expect(offered.includes(action)).toBe(checkAction(subject, caps, action).ok);
      }
    }
  });
});
