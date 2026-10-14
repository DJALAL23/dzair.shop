/**
 * What a merchant may report about a shipment, and what it means.
 *
 * A store's own driver has no API and no carrier vocabulary: the merchant
 * reports the driver's progress, in CodFlow's own words, and those words are
 * the driver shipment's provider statuses. A carrier shipment is reported by
 * its carrier — the merchant may only attest the one fact they can see for
 * themselves: the goods are back in their hands. They can never claim a
 * carrier delivered a parcel.
 */

import { ERROR_CODES } from "../errors/codes";
import {
  isClosed,
  type DeliveryFacts,
  type Interpretation,
  type ShipmentRuleVerdict,
} from "./interpretation";
import type { HandoffState, ShipmentKind } from "./model";

export const DRIVER_STATUSES = [
  "out_for_delivery",
  "failed_attempt",
  "delivered",
  "returned",
] as const;
export type MerchantReport = (typeof DRIVER_STATUSES)[number];

/** The only report a merchant may make on a carrier shipment. */
const CARRIER_ATTESTATIONS: readonly MerchantReport[] = ["returned"];

export function isMerchantReport(value: unknown): value is MerchantReport {
  return typeof value === "string" && (DRIVER_STATUSES as readonly string[]).includes(value);
}

export function interpretMerchantReport(report: MerchantReport): Interpretation {
  switch (report) {
    case "out_for_delivery":
      return { kind: "milestone", milestone: "out_for_delivery" };
    case "failed_attempt":
      return { kind: "failed_attempt" };
    case "delivered":
      return { kind: "milestone", milestone: "delivered" };
    case "returned":
      return { kind: "milestone", milestone: "returned" };
  }
}

export function reportsAllowedFor(kind: ShipmentKind): readonly MerchantReport[] {
  return kind === "driver" ? DRIVER_STATUSES : CARRIER_ATTESTATIONS;
}

export interface ReportTarget {
  kind: ShipmentKind;
  handoffState: HandoffState;
  delivery: DeliveryFacts;
}

export function checkMerchantReport(target: ReportTarget, report: MerchantReport): ShipmentRuleVerdict {
  if (!reportsAllowedFor(target.kind).includes(report)) {
    return { ok: false, code: ERROR_CODES.SHIPMENT_REPORT_NOT_ALLOWED };
  }
  if (target.handoffState !== "accepted") {
    return { ok: false, code: ERROR_CODES.SHIPMENT_HANDOFF_PENDING };
  }
  if (isClosed(target.delivery)) return { ok: false, code: ERROR_CODES.SHIPMENT_CLOSED };
  return { ok: true };
}
