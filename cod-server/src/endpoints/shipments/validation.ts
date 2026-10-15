/**
 * Request bodies for handing orders to delivery and acting on a shipment.
 */

import { z } from "@hono/zod-openapi";
import { DRIVER_STATUSES } from "../../../../cod-shared/shipments/merchant-reports";

const parcelChoices = {
  deliveryType: z.enum(["home", "stop_desk"]).optional().openapi({
    description:
      "Ship as home or stop-desk delivery instead of what the customer asked for — for a carrier with no desk in the wilaya, or the reverse. The cash to collect does not change.",
  }),
  stationCode: z.string().trim().min(1).optional().openapi({ description: "The stop desk, when shipping to one" }),
  weight: z.number().positive().optional().openapi({ description: "Parcel weight in kg; otherwise the order's, else the sum of its variants'" }),
  fragile: z.boolean().optional(),
  remarks: z.string().trim().max(500).optional().openapi({ description: "For the courier; otherwise the order's notes" }),
};

export const carrierHandoffSchema = z.object({
  kind: z.literal("carrier"),
  companyId: z.string().min(1).openapi({ description: "The delivery company to hand the order to" }),
  ...parcelChoices,
});

export const bulkCarrierHandoffSchema = z.object({
  companyId: z.string().min(1),
  orderIds: z.array(z.string().min(1)).min(1).max(100),
  deliveryType: parcelChoices.deliveryType,
});

export const resolveHandoffSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("lookup") }),
  z.object({
    action: z.literal("attach"),
    trackingNumber: z.string().trim().min(1),
    carrierParcelId: z.string().trim().min(1).optional().openapi({
      description: "The carrier's own parcel id, when it differs from the tracking number (ZR Express)",
    }),
  }),
  z.object({ action: z.literal("release") }),
]);

export const validateShipmentSchema = z.object({
  requestPickup: z.boolean().optional().openapi({ description: "Ask the carrier to collect the parcel (EcoTrack)" }),
});

export const updateParcelSchema = z.object({
  customerName: z.string().trim().min(1).optional(),
  phone: z.string().trim().min(9).optional(),
  address: z.string().trim().optional(),
  wilayaId: z.number().int().min(1).max(58).optional(),
  communeId: z.string().min(1).optional(),
  amount: z.number().nonnegative().optional().openapi({ description: "The cash to collect" }),
  weight: z.number().positive().optional(),
  fragile: z.boolean().optional(),
  remarks: z.string().trim().max(500).optional(),
});

export const remarkSchema = z.object({
  content: z.string().trim().min(1).max(500).openapi({ example: "Appeler le client 30 minutes avant" }),
});

export const merchantReportSchema = z.object({
  status: z.enum(DRIVER_STATUSES).openapi({
    description: "A driver's progress; on a carrier shipment only `returned` (the goods are back with the merchant)",
  }),
  reason: z.string().trim().max(500).optional().openapi({ description: "Why — a refusal, no answer…" }),
  occurredAt: z.string().datetime({ offset: true }).optional().openapi({ description: "When it happened, if not now" }),
});
