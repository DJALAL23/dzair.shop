/**
 * Delivery & Logistics Schemas
 *
 * Delivery companies, drivers, stop desks, shipping rates, and payments.
 */

import { z } from "@hono/zod-openapi";
import type { CarrierCapabilities } from "@/carriers/contract";
import { CARRIER_PROVIDERS } from "../../../../cod-shared/carriers/providers";
import { ORDER_STAGES } from "../../../../cod-shared/orders/stage";

export const CarrierCapabilitiesSchema = z
  .object({
    homeDelivery: z.boolean(),
    stopDesk: z.boolean(),
    separateValidation: z.boolean().openapi({ description: "A created parcel waits for a separate validation before the carrier handles it" }),
    bulkCreate: z.number().int().openapi({ description: "Most parcels one bulk handoff sends at once; 0 = one at a time" }),
    parcelFields: z.object({ weight: z.boolean(), fragile: z.boolean(), remarks: z.boolean() }).openapi({ description: "Parcel fields the carrier takes at creation" }),
    limits: z.object({ maxAmount: z.number().nullable(), maxDescription: z.number().int().nullable() }).openapi({ description: "The carrier's own ceilings, checked before calling it" }),
    update: z.boolean(),
    cancel: z.boolean(),
    remarks: z.object({ add: z.boolean(), list: z.boolean() }),
    history: z.boolean().openapi({ description: "Its status history can be read (sync)" }),
    historyBatch: z.number().int(),
    findByReference: z.boolean().openapi({ description: "A parcel can be found by the order number — resolves an unknown handoff" }),
    updates: z.enum(["webhook", "pull"]).openapi({ description: "How its updates reach Wocart: pushed by webhook, or pulled every few minutes" }),
    label: z.boolean(),
    askReturn: z.boolean(),
    requestNewAttempt: z.boolean(),
    confirmReturn: z.boolean(),
    stopDeskList: z.boolean(),
    geoNames: z.boolean(),
    verifyConnection: z.boolean(),
  })
  .openapi("CarrierCapabilities", { description: "What a company's carrier can do — known from its provider alone, without credentials" });

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const capabilitiesDocumented: Same<z.infer<typeof CarrierCapabilitiesSchema>, CarrierCapabilities> = true;
void capabilitiesDocumented;

export const DeliveryCompanySchema = z
  .object({
    id: z.string().openapi({ example: "comp_abc123" }),
    name: z.string().openapi({ example: "Yalidine" }),
    nameAr: z.string().openapi({ example: "ياليدين" }),
    code: z.string().openapi({ example: "yalidine" }),
    website: z.string().url().nullable().openapi({ example: "https://www.yalidine.com" }),
    active: z.boolean().openapi({ example: true }),
    apiEndpoint: z.string().url().nullable().openapi({ example: "https://api.yalidine.app/v1" }),
    isConnected: z.boolean().openapi({
      description: "True when API credentials are stored. Credentials themselves are never returned.",
      example: true,
    }),
    supportsHomeDelivery: z.boolean().openapi({ example: true }),
    supportsStopDesk: z.boolean().openapi({ example: true }),
    autoValidate: z.boolean().nullable().openapi({
      description:
        "When true, the server calls `validateShipment` immediately after `createShipment` on dispatch. " +
        "The order is locked at the carrier (no edits/deletes). When false, the order stays editable and the team must manually confirm it. " +
        "If omitted/null, a provider-specific default is used.",
      example: true,
    }),
    notes: z.string().nullable().openapi({ example: "Primary carrier for Algiers region" }),
    provider: z.enum(CARRIER_PROVIDERS).nullable().openapi({ description: "The carrier adapter serving this company; null = it cannot take parcels." }),
    providerConfig: z.record(z.string(), z.unknown()).nullable().openapi({ description: "The adapter's settings; secrets masked (•••• + last 4)." }),
    webhookSecretSet: z.boolean().openapi({ description: "True when the webhook signing secret is stored. The secret itself is never returned." }),
    capabilities: CarrierCapabilitiesSchema.nullable().openapi({ description: "What its carrier can do; null when it has no provider" }),
    webhookEndpointId: z.string().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi("DeliveryCompany", {
    description: "Third-party delivery company integration",
  });

export const StopDeskSchema = z
  .object({
    id: z.string().openapi({ example: "desk_xyz789" }),
    companyId: z.string().openapi({ example: "comp_abc123" }),
    code: z.string().openapi({
      example: "16A",
      description:
        "Station code to use as `stationCode` when dispatching a stop-desk order. " +
        "Format differs by provider: Noest = alphanumeric code (e.g. \"16A\"); " +
        "Yalidine = numeric center_id (e.g. \"160101\"); " +
        "ZR Express = territory UUID; EcoTrack = postal code string.",
    }),
    name: z.string().openapi({ example: "Agence Alger Centre" }),
    commune: z.string().nullable().openapi({ example: "Bir Mourad Raïs" }),
    wilayaId: z.number().int().nullable().openapi({ example: 16 }),
    address: z.string().nullable().openapi({ example: "5 Rue Didouche Mourad, Alger" }),
    phones: z.array(z.string()).openapi({
      example: ["0555123456"],
      description: "Contact phone numbers for the stop-desk station.",
    }),
    active: z.boolean().openapi({
      example: true,
      description: "Admin toggle. When false, this stop desk is hidden from merchant UI. Survives re-sync.",
    }),
    syncedAt: z.string().datetime().openapi({
      description: "Last time this row was fetched from the carrier API (via POST .../sync-stop-desks).",
    }),
  })
  .openapi("StopDesk");

export const ShippingRuleSchema = z
  .object({
    id: z.string().openapi({ example: "rule_abc123" }),
    profileId: z.string().openapi({ example: "profile_123" }),
    wilayaId: z.number().int().min(1).max(58).openapi({ example: 16 }),
    wilayaName: z.string().openapi({
      description: "Wilaya French/name — joined from reference table",
      example: "Alger",
    }),
    wilayaNameAr: z.string().openapi({ example: "الجزائر" }),
    homePrice: z.number().openapi({ example: 400 }),
    stopDeskPrice: z.number().openapi({ example: 250 }),
    homeEnabled: z.boolean().openapi({ example: true }),
    stopDeskEnabled: z.boolean().openapi({ example: false }),
    createdAt: z.string().datetime(),
  })
  .openapi("ShippingRule", {
    description: "Per-wilaya customer delivery rate within a shipping profile",
  });

export const ShippingProfileWithRulesSchema = z
  .object({
    id: z.string().openapi({ example: "profile_123" }),
    name: z.string().openapi({ example: "Standard Rates" }),
    isDefault: z.boolean().openapi({
      description:
        "Exactly one profile is always the default; its rates auto-apply on order creation",
      example: false,
    }),
    notes: z.string().nullable().openapi({ example: null }),
    productCount: z.number().int().openapi({
      description: "How many products are assigned to this profile",
      example: 3,
    }),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    rules: z.array(ShippingRuleSchema),
  })
  .openapi("ShippingProfileWithRules", {
    description: "Shipping profile with its full list of wilaya rules",
  });

export const ShippingProfileSchema = ShippingProfileWithRulesSchema.omit({
  rules: true,
}).extend({
  ruleCount: z.number().int().openapi({
    description: "Number of wilaya rules in this profile",
    example: 58,
  }),
}).openapi("ShippingProfile", {
  description:
    "Shipping rate profile. List responses include ruleCount; detail responses include the rules array instead.",
});

export const CommuneOverrideSchema = z
  .object({
    communeId: z.string().openapi({ example: "550e8400-e29b-41d4-a716-446655440000" }),
    communeName: z.string().openapi({ example: "Bab Ezzouar" }),
    communeNameAr: z.string().openapi({ example: "باب الزوار" }),
    postalCode: z.string().nullable(),
    homeEnabled: z.boolean().nullable().openapi({
      description: "null = inherited from wilaya rule",
    }),
    stopDeskEnabled: z.boolean().nullable().openapi({
      description: "null = inherited from wilaya rule",
    }),
    homePrice: z.number().nullable().openapi({
      description: "null = inherited from wilaya rule",
    }),
    stopDeskPrice: z.number().nullable().openapi({
      description: "null = inherited from wilaya rule",
    }),
    effectiveHomeEnabled: z.boolean(),
    effectiveStopDeskEnabled: z.boolean(),
    effectiveHomePrice: z.number(),
    effectiveStopDeskPrice: z.number(),
    hasOverride: z.boolean(),
  })
  .openapi("CommuneOverride", {
    description:
      "A commune within a wilaya rule, showing both the raw override fields (null = inherited) and the effective values used at fee-resolution time.",
  });

export const DriverSchema = z
  .object({
    id: z.string().openapi({ example: "drv_123" }),
    firstName: z.string().openapi({ example: "Mohamed" }),
    lastName: z.string().openapi({ example: "Amiri" }),
    phone: z.string().openapi({
      description: "Algerian mobile number starting with 05, 06, or 07",
      example: "0551234567",
    }),
    phone2: z.string().nullable().openapi({ description: "Optional secondary phone", example: null }),
    vehicleType: z.enum(["motorcycle", "car", "van"]).nullable().openapi({
      description: "Type of vehicle; null if unknown",
      example: "van",
    }),
    status: z.enum(["available", "busy", "inactive"]).openapi({ example: "available" }),
    totalDelivered: z.number().int().openapi({
      description: "Cumulative deliveries completed (incremented on status → delivered)",
      example: 50,
    }),
    totalEarnings: z.number().openapi({
      description: "Cumulative delivery fees earned (incremented on status → delivered)",
      example: 25000,
    }),
    pendingCash: z.number().openapi({
      description: "COD cash collected by driver but not yet remitted to the business",
      example: 5000,
    }),
    totalPaid: z.number().openapi({
      description: "Total COD cash remitted to the business",
      example: 20000,
    }),
    notes: z.string().nullable().openapi({
      description: "Internal notes about the driver (not visible to customers)",
    }),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    compensationWilayaCount: z.number().int().openapi({
      description:
        "Number of wilayas with a configured per-delivery fee for this driver",
      example: 12,
    }),
    recentShipments: z
      .array(
        z.object({
          id: z.string(),
          orderId: z.string(),
          orderNumber: z.string(),
          customerName: z.string(),
          wilayaId: z.number().int().nullable(),
          deliveryType: z.enum(["home", "stop_desk"]),
          codAmount: z.number(),
          driverFee: z.number(),
          providerStatus: z.string().nullable().openapi({ description: "The last progress reported: out_for_delivery, failed_attempt, delivered or returned" }),
          outForDeliveryAt: z.string().nullable(),
          deliveredAt: z.string().nullable(),
          returnedAt: z.string().nullable(),
          deliveryAttempts: z.number().int(),
          stage: z.enum(ORDER_STAGES).openapi({ description: "Where its order stands overall (out_for_delivery, delivered, returned…)" }),
          createdAt: z.string(),
        }),
      )
      .optional()
      .openapi({ description: "The 10 most recent orders given to this driver, newest first. Detail, create and update responses only." }),
    openShipmentCount: z.number().int().optional().openapi({ description: "Orders the driver still has out (not delivered, returned or cancelled)." }),
    cashReconciliation: z
      .object({
        pendingCash: z.number(),
        pendingOrdersTotal: z.number().openapi({ description: "Cash of delivered shipments not yet handed over" }),
        pendingOrdersCount: z.number().int(),
        drift: z.number().openapi({ description: "pendingCash − pendingOrdersTotal; non-zero means the counter needs attention" }),
      })
      .optional(),
  })
  .openapi("Driver", {
    description: "Delivery driver profile with denormalized earnings statistics",
  });

export const DriverCompensationRowSchema = z
  .object({
    wilayaId: z.number().int().min(1).max(58).openapi({ example: 16 }),
    wilayaName: z.string().openapi({ example: "Alger" }),
    wilayaNameAr: z.string().openapi({ example: "الجزائر" }),
    feePerDelivery: z.number().nullable().openapi({
      description: "DZD per delivery; `null` when not configured.",
      example: 350,
    }),
  })
  .openapi("DriverCompensationRow", {
    description:
      "Per-wilaya compensation entry. GET /{id}/compensations always returns all 58 wilayas; a null fee means no row is configured.",
  });

export const DriverPaymentSchema = z
  .object({
    id: z.string().openapi({ example: "pay_abc123" }),
    driverId: z.string().openapi({ description: "UUID of the driver this payment is for" }),
    type: z.enum(["cod_remittance", "fee_payment", "net_settlement"]).openapi({
      description:
        "`cod_remittance`: driver hands COD cash to business. `fee_payment`: business pays driver fees. `net_settlement`: both at once (driver hands COD − fees net amount).",
      example: "cod_remittance",
    }),
    amount: z.number().openapi({
      description:
        "Settled amount, computed server-side from the shipments' frozen values: cash total (`cod_remittance`), fee total (`fee_payment`), or cash − fees (`net_settlement`).",
      example: 95000,
    }),
    orderCount: z.number().int().openapi({
      description: "Number of shipments (one per order) this payment settles.",
      example: 3,
    }),
    notes: z.string().nullable().openapi({
      description: "Optional internal note about this payment record.",
      example: null,
    }),
    createdBy: z.string().openapi({
      description: "User ID of the team member who recorded this payment.",
    }),
    createdByName: z.string().openapi({
      description: "Denormalised display name for audit trail.",
      example: "Ahmed Benali",
    }),
    createdAt: z.string().datetime(),
  })
  .openapi("DriverPayment");

export const PendingSettlementSchema = z
  .object({
    shipmentId: z.string(),
    orderId: z.string(),
    orderNumber: z.string(),
    customerName: z.string(),
    codAmount: z.number().openapi({ description: "Cash the driver collected (DZD)" }),
    driverFee: z.number().openapi({ description: "The driver's frozen fee (DZD)" }),
    deliveredAt: z.string().datetime(),
    codPaymentId: z.string().nullable().openapi({ description: "The payment that settled the cash; null while the driver still holds it" }),
    feePaymentId: z.string().nullable().openapi({ description: "The payment that settled the fee; null while it is owed" }),
  })
  .openapi("PendingSettlement", { description: "A delivered driver shipment with a part still to settle" });
