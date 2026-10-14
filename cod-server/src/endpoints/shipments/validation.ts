/**
 * Request bodies for handing orders to delivery and resolving a handoff.
 */

import { z } from "@hono/zod-openapi";

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
