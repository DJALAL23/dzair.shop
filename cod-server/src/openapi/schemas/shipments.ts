/**
 * Shipment schemas — a shipment, its history, and the results of handing
 * orders to delivery (ADR 0006).
 */

import { z } from "@hono/zod-openapi";
import { INTERPRETATION_KIND_VALUES, MILESTONES } from "../../../../cod-shared/shipments/interpretation";
import { HANDOFF_STATES, SHIPMENT_EVENT_SOURCES, SHIPMENT_KINDS } from "../../../../cod-shared/shipments/model";
import { SHIPMENT_ACTIONS } from "../../../../cod-shared/shipments/actions";

const instant = () => z.string().nullable().openapi({ description: "UTC ISO-8601, or null", example: "2026-10-14T09:30:00.000Z" });

export const ShipmentEventSchema = z
  .object({
    id: z.string(),
    source: z.enum(SHIPMENT_EVENT_SOURCES),
    vocabulary: z.string().nullable().openapi({ description: "Whose words the status is in (the carrier's field, or `codflow`)" }),
    providerStatus: z.string().nullable().openapi({ description: "The status exactly as reported" }),
    providerStatusLabel: z.string().nullable(),
    interpretation: z.enum(INTERPRETATION_KIND_VALUES).nullable(),
    milestone: z.enum(MILESTONES).nullable(),
    attention: z.boolean(),
    anomaly: z.string().nullable(),
    reason: z.string().nullable().openapi({ description: "Why, when the carrier says (a refusal, no answer…)" }),
    occurredAt: z.string(),
    recordedAt: z.string(),
    actorId: z.string().nullable(),
  })
  .openapi("ShipmentEvent");

export const ShipmentSchema = z
  .object({
    id: z.string(),
    orderId: z.string(),
    kind: z.enum(SHIPMENT_KINDS),
    companyId: z.string().nullable(),
    carrierName: z.string().nullable().openapi({ description: "The delivery company carrying it; null for the store's driver" }),
    driverId: z.string().nullable(),
    handoffState: z.enum(HANDOFF_STATES).openapi({
      description: "submitting: the carrier is being called · accepted: the carrier has the parcel · unknown: the outcome must be resolved",
    }),
    carrierParcelId: z.string().nullable(),
    trackingNumber: z.string().nullable(),
    deliveryType: z.enum(["home", "stop_desk"]),
    stationCode: z.string().nullable(),
    codAmount: z.number().openapi({ description: "Cash the courier collects (price + delivery fee)" }),
    driverFee: z.number(),
    weight: z.number().nullable(),
    isFragile: z.boolean().nullable(),
    providerStatus: z.string().nullable().openapi({ description: "The carrier's latest status, as reported" }),
    providerStatusLabel: z.string().nullable(),
    providerStatusKind: z.enum(INTERPRETATION_KIND_VALUES).nullable(),
    providerStatusAt: instant(),
    validatedAt: instant(),
    outForDeliveryAt: instant(),
    deliveredAt: instant(),
    returnStartedAt: instant(),
    returnedAt: instant(),
    cancelledAt: instant(),
    deliveryAttempts: z.number().int(),
    attentionSince: instant(),
    lastSyncedAt: instant(),
    createdBy: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
    actions: z.array(z.enum(SHIPMENT_ACTIONS)).openapi({ description: "What can be done to this shipment now" }),
    events: z.array(ShipmentEventSchema).optional(),
  })
  .openapi("Shipment");

const RefusalSchema = z.object({
  code: z.string().openapi({ example: "ORDER_NOT_READY_FOR_HANDOFF" }),
  message: z.string(),
  context: z.record(z.string(), z.unknown()).optional(),
});

export const HandoffResultSchema = z
  .object({
    orderId: z.string(),
    orderNumber: z.string().nullable(),
    outcome: z.enum(["accepted", "unknown", "refused"]).openapi({
      description:
        "accepted: the carrier has the parcel, or the driver has the order · unknown: the carrier may or may not have it — resolve it, never re-send · refused: nothing was created; the order is unchanged",
    }),
    shipment: ShipmentSchema.optional(),
    validationError: z.string().nullable().optional().openapi({ description: "Created, but the carrier refused to validate it" }),
    message: z.string().optional(),
    error: RefusalSchema.optional(),
  })
  .openapi("HandoffResult");

export const BulkHandoffDataSchema = z
  .object({
    results: z.array(HandoffResultSchema),
    summary: z.object({ accepted: z.number().int(), unknown: z.number().int(), refused: z.number().int() }),
  })
  .openapi("BulkHandoffData");

export const ResolveResultSchema = z
  .object({
    outcome: z.enum(["accepted", "unknown", "not_found", "released"]),
    shipment: ShipmentSchema.optional(),
    message: z.string().optional(),
  })
  .openapi("HandoffResolution");

export const ShipmentOperationResultSchema = z
  .object({
    shipment: ShipmentSchema,
    recorded: z.number().int().optional().openapi({ description: "Events new to the shipment" }),
    duplicates: z.number().int().optional().openapi({ description: "Events it already had" }),
    reached: z.array(z.enum(MILESTONES)).optional().openapi({ description: "Milestones reached for the first time" }),
    anomalies: z.array(z.string()).optional(),
  })
  .openapi("ShipmentOperationResult");

export const CarrierRemarkSchema = z
  .object({
    content: z.string(),
    createdAt: z.string().nullable(),
  })
  .openapi("CarrierRemark");
